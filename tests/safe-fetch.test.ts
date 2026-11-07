import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({ default: { lookup: vi.fn() } }));

import dns from "dns/promises";
import { fetchImageSafely, isPrivateAddress, UnsafeUrlError } from "../lib/safe-fetch";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
  ])("treats %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.0.1",
    "93.184.216.34",
    "2606:4700::1111",
    "::ffff:8.8.8.8",
  ])("treats %s as public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it("treats non-IP strings as private", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

const lookup = vi.mocked(dns.lookup) as unknown as ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const img = (body: BodyInit = PNG, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "image/png", ...headers } });

beforeEach(() => {
  vi.resetAllMocks();
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("fetchImageSafely", () => {
  it("accepts a small public image", async () => {
    fetchMock.mockResolvedValueOnce(img());
    const buf = await fetchImageSafely("https://cdn.example.com/a.png");
    expect(buf.equals(Buffer.from(PNG))).toBe(true);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(fetchImageSafely("https://evil.example.com/a.png")).rejects.toThrow(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects literal private IPs", async () => {
    await expect(fetchImageSafely("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/non-public/);
    await expect(fetchImageSafely("http://[::1]/x.png")).rejects.toThrow(/non-public/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-http schemes", async () => {
    await expect(fetchImageSafely("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(fetchImageSafely("ftp://example.com/a.png")).rejects.toThrow(/http/);
  });

  it("rejects credentials in the URL", async () => {
    await expect(fetchImageSafely("https://user:pw@example.com/a.png")).rejects.toThrow(/credentials/);
  });

  it("rejects invalid URLs and unresolvable hosts", async () => {
    await expect(fetchImageSafely("not a url")).rejects.toThrow(/Invalid URL/);
    lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(fetchImageSafely("https://nope.example.com/a.png")).rejects.toThrow(/resolve/);
  });

  it("rejects a redirect to a private host", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://10.0.0.5/secret.png" } })
    );
    await expect(fetchImageSafely("https://example.com/a.png")).rejects.toThrow(/non-public/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to a public host", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/b.png" } }))
      .mockResolvedValueOnce(img());
    await expect(fetchImageSafely("https://example.com/a.png")).resolves.toHaveLength(PNG.length);
  });

  it("gives up after too many redirects", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/loop" } }));
    await expect(fetchImageSafely("https://example.com/a.png")).rejects.toThrow(/Too many redirects/);
  });

  it("rejects non-image content types", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(fetchImageSafely("https://example.com/a.png")).rejects.toThrow(/not an image/);
  });

  it("rejects oversize bodies, declared or streamed", async () => {
    fetchMock.mockResolvedValueOnce(img(PNG, { "content-length": String(50 * 1024 * 1024) }));
    await expect(fetchImageSafely("https://example.com/a.png")).rejects.toThrow(/too large/);
    fetchMock.mockResolvedValueOnce(img(new Uint8Array(9 * 1024 * 1024)));
    await expect(fetchImageSafely("https://example.com/b.png")).rejects.toThrow(/too large/);
  });

  it("rejects upstream HTTP errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 404 }));
    await expect(fetchImageSafely("https://example.com/a.png")).rejects.toThrow(/404/);
  });
});

describe("fetchImageSafely with product page URLs", () => {
  const page = (html: string) =>
    new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

  it("extracts og:image from a product page and fetches that image", async () => {
    fetchMock
      .mockResolvedValueOnce(page('<meta property="og:image" content="https://cdn.example.com/shirt.png">'))
      .mockResolvedValueOnce(img());
    const buf = await fetchImageSafely("https://shop.example.com/product/1");
    expect(buf.equals(Buffer.from(PNG))).toBe(true);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://cdn.example.com/shirt.png");
  });

  it("tries the next candidate when the first image fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        page(
          '<meta property="og:image" content="https://cdn.example.com/a.png"><meta name="twitter:image" content="https://cdn.example.com/b.png">'
        )
      )
      .mockResolvedValueOnce(new Response("nope", { status: 404 }))
      .mockResolvedValueOnce(img());
    await expect(fetchImageSafely("https://shop.example.com/p")).resolves.toBeInstanceOf(Buffer);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not follow an og:image that points at a private address", async () => {
    lookup.mockImplementation(async (host: string) =>
      host === "internal.example.com"
        ? [{ address: "169.254.169.254", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }]
    );
    fetchMock.mockResolvedValueOnce(
      page('<meta property="og:image" content="http://internal.example.com/secret.png">')
    );
    await expect(fetchImageSafely("https://shop.example.com/p")).rejects.toThrow(/not an image/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains what to do when a page has no usable image", async () => {
    fetchMock.mockResolvedValueOnce(page("<html><body>Access Denied</body></html>"));
    await expect(fetchImageSafely("https://shop.example.com/p")).rejects.toThrow(/copy its image address/i);
  });

  it("still rejects non-image, non-HTML responses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );
    await expect(fetchImageSafely("https://api.example.com/x")).rejects.toThrow(/not an image/);
  });
});
