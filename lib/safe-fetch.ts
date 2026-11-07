import dns from "dns/promises";
import net from "net";
import { extractImageCandidates } from "./product-image";

export class UnsafeUrlError extends Error {}

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** True for loopback, private, link-local, CGNAT, multicast, reserved and cloud-metadata ranges. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return (
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe8") ||
      v.startsWith("fe9") ||
      v.startsWith("fea") ||
      v.startsWith("feb") ||
      v.startsWith("ff")
    );
  }
  return true;
}

async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("Only http(s) URLs are allowed");
  if (u.username || u.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new UnsafeUrlError("Could not resolve host");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError("URL points to a non-public address");
  return u;
}

interface Fetched {
  buf: Buffer;
  type: string;
  url: string;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const NOT_AN_IMAGE =
  "That link is not an image, and no product image could be read from the page (some shops block automated access). " +
  "Open the product photo, copy its image address (right-click, Copy image address) or save the photo and upload it.";

/**
 * One safe GET: public hosts only (re-checked on every redirect), time capped, content-type gated.
 * Images are capped at 8 MB (error); HTML pages are read up to 2 MB (truncated, since metadata lives in <head>).
 */
async function fetchSafe(raw: string, accept: string, allowHtml: boolean): Promise<Fetched> {
  let url = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicHttpUrl(url);
    const res = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: accept, "User-Agent": BROWSER_UA, "Accept-Language": "en-IN,en;q=0.9" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new UnsafeUrlError("Redirect without location");
      url = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) throw new UnsafeUrlError(`Image URL returned ${res.status}`);
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    const isImage = type.startsWith("image/");
    const isHtml = type.startsWith("text/html") || type.startsWith("application/xhtml");
    if (!isImage && !(allowHtml && isHtml)) throw new UnsafeUrlError(allowHtml ? NOT_AN_IMAGE : "URL is not an image");
    const cap = isImage ? MAX_BYTES : MAX_HTML_BYTES;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (isImage && declared > cap) throw new UnsafeUrlError("Image is too large (max 8 MB)");
    const reader = res.body?.getReader();
    if (!reader) throw new UnsafeUrlError("Empty response");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        await reader.cancel();
        if (isImage) throw new UnsafeUrlError("Image is too large (max 8 MB)");
        break;
      }
      chunks.push(value);
    }
    return { buf: Buffer.concat(chunks), type, url: u.toString() };
  }
  throw new UnsafeUrlError("Too many redirects");
}

/**
 * Fetch an image from a URL. Accepts a direct image URL, or a product page URL from which the product image
 * (og:image, Twitter card, JSON-LD) is extracted and then fetched. Every hop and every candidate image URL is
 * checked against private/loopback/metadata ranges. Note: a DNS-rebinding race between check and connect remains
 * theoretically possible; for stricter isolation run behind an egress proxy.
 */
export async function fetchImageSafely(raw: string): Promise<Buffer> {
  const first = await fetchSafe(raw, "image/*,text/html;q=0.9", true);
  if (first.type.startsWith("image/")) return first.buf;

  const candidates = extractImageCandidates(first.buf.toString("utf8"), first.url);
  for (const c of candidates) {
    try {
      return (await fetchSafe(c, "image/*", false)).buf;
    } catch {
      /* try the next candidate */
    }
  }
  throw new UnsafeUrlError(NOT_AN_IMAGE);
}
