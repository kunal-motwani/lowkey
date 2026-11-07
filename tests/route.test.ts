import { beforeEach, describe, expect, it, vi } from "vitest";
import { solid } from "./helpers";

vi.mock("@/lib/agent", () => {
  class InputError extends Error {}
  return { runStylist: vi.fn(), InputError };
});

import { InputError, runStylist } from "@/lib/agent";
import { YoucamTaskError } from "@/lib/youcam";
import { POST } from "../app/api/analyze/route";

let n = 0;
const uniqueIp = () => `203.0.113.${++n}`;

function req(fields: Record<string, string | Blob>, ip = uniqueIp()) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://localhost/api/analyze", { method: "POST", body: fd, headers: { "x-forwarded-for": ip } });
}

const sse = async (res: Response) => {
  const text = await res.text();
  return [...text.matchAll(/event: (\w+)\ndata: (.*)\n\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) }));
};

const OK = { sampleFace: "olive-tee.jpg", sampleTop: "navy-shirt.jpg" };
const bodyFile = async () => new File([new Uint8Array(await solid("#336699"))], "body.png", { type: "image/png" });

beforeEach(() => {
  vi.mocked(runStylist).mockReset();
});

describe("POST /api/analyze", () => {
  it("returns 400 for a body that is not a valid form", async () => {
    const r = new Request("http://localhost/api/analyze", {
      method: "POST",
      body: "not a form",
      headers: { "x-forwarded-for": uniqueIp(), "content-type": "text/plain" },
    });
    const res = await POST(r);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/multipart/);
  });

  it("returns 429 with Retry-After on the 7th request in a minute from one IP", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 6; i++) {
      const res = await POST(req({ sampleFace: "bad name" }, ip));
      expect(res.status).toBe(200);
      await res.text();
    }
    const res = await POST(req({}, ip));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await POST(req({}))).status).toBe(200); // a different IP is unaffected
  });

  it.each([
    [{}, /Missing face/],
    [{ sampleTop: "navy-shirt.jpg" }, /Missing face/],
    [{ sampleFace: "olive-tee.jpg" }, /at least one piece/],
    [{ sampleFace: "../../etc/passwd", sampleTop: "navy-shirt.jpg" }, /not valid/],
    [{ sampleFace: "olive-tee.jpg", sampleTop: "nonexistent.jpg" }, /not available/],
    [{ sampleFace: "olive-tee.jpg", sampleBottom: "navy-shirt.jpg" }, /full-body photo \(head to feet\)/],
    [{ sampleFace: "olive-tee.jpg", sampleShoes: "navy-shirt.jpg" }, /bottoms and shoes/],
    [{ ...OK, sampleBracelet: "navy-shirt.jpg" }, /back of your hand/],
    [{ ...OK, sampleRing: "navy-shirt.jpg" }, /back of your hand/],
  ])("emits an SSE fail event for bad input %#", async (fields, msg) => {
    const res = await POST(req(fields));
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const events = await sse(res);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("fail");
    expect(events[0].data.message).toMatch(msg);
    expect(runStylist).not.toHaveBeenCalled();
  });

  it("rejects an oversized body upload", async () => {
    const big = new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]);
    const events = await sse(await POST(req({ ...OK, body: big })));
    expect(events[0].event).toBe("fail");
    expect(events[0].data.message).toMatch(/too large/);
  });

  it("streams step and result events and passes face, body and pieces to the agent", async () => {
    vi.mocked(runStylist).mockImplementation(async (_input, emit) => {
      emit({ step: "perceive", status: "done" });
      return { outfit: { verdict: "buy" } } as never;
    });
    const events = await sse(await POST(req({ ...OK, sampleJacket: "coral-top.jpg", body: await bodyFile() })));
    expect(events.map((e) => e.event)).toEqual(["step", "result"]);
    expect(events[1].data.outfit.verdict).toBe("buy");
    const input = vi.mocked(runStylist).mock.calls[0][0];
    expect(Buffer.isBuffer(input.face)).toBe(true);
    expect(Buffer.isBuffer(input.body)).toBe(true);
    expect(input.pieces.map((p) => p.role)).toEqual(["top", "jacket"]);
  });

  it("allows a bottom when a body photo is supplied", async () => {
    vi.mocked(runStylist).mockResolvedValue({} as never);
    const events = await sse(
      await POST(req({ sampleFace: "olive-tee.jpg", sampleBottom: "navy-shirt.jpg", body: await bodyFile() }))
    );
    expect(events.map((e) => e.event)).toEqual(["result"]);
    expect(vi.mocked(runStylist).mock.calls[0][0].pieces.map((p) => p.role)).toEqual(["bottom"]);
  });

  it("accepts a hand photo and the new roles", async () => {
    vi.mocked(runStylist).mockResolvedValue({} as never);
    const events = await sse(
      await POST(
        req({
          ...OK,
          hand: await bodyFile(),
          body: await bodyFile(),
          sampleShoes: "coral-top.jpg",
          sampleNecklace: "navy-shirt.jpg",
          sampleEarrings: "navy-shirt.jpg",
          sampleBracelet: "navy-shirt.jpg",
          sampleRing: "olive-tee.jpg",
        })
      )
    );
    expect(events.map((e) => e.event)).toEqual(["result"]);
    const input = vi.mocked(runStylist).mock.calls[0][0];
    expect(Buffer.isBuffer(input.hand)).toBe(true);
    expect(input.pieces.map((p) => p.role)).toEqual(["top", "shoes", "necklace", "earrings", "bracelet", "ring"]);
  });

  it("only takes the hand photo as a file (no sample)", async () => {
    const events = await sse(await POST(req({ ...OK, sampleBracelet: "navy-shirt.jpg", sampleHand: "olive-tee.jpg" })));
    expect(events[0].data.message).toMatch(/back of your hand/);
    expect(runStylist).not.toHaveBeenCalled();
  });

  it("reports unexpected agent failures with a generic message", async () => {
    vi.mocked(runStylist).mockRejectedValue(new Error("secret internal detail"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await sse(await POST(req(OK)));
    expect(events[0].event).toBe("fail");
    expect(events[0].data.message).not.toContain("secret");
    spy.mockRestore();
  });

  it("passes InputError messages through", async () => {
    vi.mocked(runStylist).mockRejectedValue(new InputError("Add a full-body photo to try on bottoms"));
    const events = await sse(await POST(req(OK)));
    expect(events[0].data.message).toBe("Add a full-body photo to try on bottoms");
  });

  it("passes YouCam user-actionable errors (e.g. face too small) through to the user", async () => {
    vi.mocked(runStylist).mockRejectedValue(
      new YoucamTaskError("skin-analysis", "The face in the input image is too small.")
    );
    const events = await sse(await POST(req(OK)));
    expect(events[0].event).toBe("fail");
    expect(events[0].data.message).toBe("The face in the input image is too small.");
  });
});
