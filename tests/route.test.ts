import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent", () => ({ runStylist: vi.fn() }));

import { runStylist } from "@/lib/agent";
import { YoucamTaskError } from "@/lib/youcam";
import { POST } from "../app/api/analyze/route";

let n = 0;
const uniqueIp = () => `203.0.113.${++n}`;

function req(fields: Record<string, string>, ip = uniqueIp()) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://localhost/api/analyze", { method: "POST", body: fd, headers: { "x-forwarded-for": ip } });
}

const sse = async (res: Response) => {
  const text = await res.text();
  return [...text.matchAll(/event: (\w+)\ndata: (.*)\n\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) }));
};

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
    vi.mocked(runStylist).mockResolvedValue({} as never);
    const ip = uniqueIp();
    for (let i = 0; i < 6; i++) {
      const res = await POST(req({ sampleSelfie: "bad name", sampleGarment: "bad name" }, ip));
      expect(res.status).toBe(200);
      await res.text();
    }
    const res = await POST(req({}, ip));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    // a different IP is unaffected
    expect((await POST(req({}))).status).toBe(200);
  });

  it.each([
    [{}, /Missing selfie/],
    [{ sampleSelfie: "../../etc/passwd", sampleGarment: "olive-tee.jpg" }, /Missing selfie/],
    [{ sampleSelfie: "olive-tee.jpg" }, /Missing garment/],
    [{ sampleSelfie: "olive-tee.jpg", sampleGarment: "nonexistent.jpg" }, /not available/],
  ])("emits an SSE fail event for bad sample fields %#", async (fields, msg) => {
    const res = await POST(req(fields));
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const events = await sse(res);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("fail");
    expect(events[0].data.message).toMatch(msg);
    expect(runStylist).not.toHaveBeenCalled();
  });

  it("streams step and result events for valid samples (runStylist mocked)", async () => {
    vi.mocked(runStylist).mockImplementation(async (_s, _g, emit) => {
      emit({ step: "perceive", status: "done" });
      return { verdict: "buy" } as never;
    });
    const events = await sse(await POST(req({ sampleSelfie: "olive-tee.jpg", sampleGarment: "navy-shirt.jpg" })));
    expect(events.map((e) => e.event)).toEqual(["step", "result"]);
    expect(events[1].data.verdict).toBe("buy");
    const [selfie, garment] = vi.mocked(runStylist).mock.calls[0];
    expect(Buffer.isBuffer(selfie) && Buffer.isBuffer(garment)).toBe(true);
  });

  it("reports unexpected agent failures with a generic message", async () => {
    vi.mocked(runStylist).mockRejectedValue(new Error("secret internal detail"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await sse(await POST(req({ sampleSelfie: "olive-tee.jpg", sampleGarment: "navy-shirt.jpg" })));
    expect(events[0].event).toBe("fail");
    expect(events[0].data.message).not.toContain("secret");
    spy.mockRestore();
  });

  it("passes YouCam user-actionable errors (e.g. face too small) through to the user", async () => {
    vi.mocked(runStylist).mockRejectedValue(
      new YoucamTaskError("skin-analysis", "The face in the input image is too small.")
    );
    const events = await sse(await POST(req({ sampleSelfie: "olive-tee.jpg", sampleGarment: "navy-shirt.jpg" })));
    expect(events[0].event).toBe("fail");
    expect(events[0].data.message).toBe("The face in the input image is too small.");
  });
});
