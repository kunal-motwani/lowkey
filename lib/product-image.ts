/**
 * Find candidate product images in a retailer page's HTML: Open Graph / Twitter card tags,
 * `<link rel="image_src">` and JSON-LD `Product` objects. Pure and synchronous so it is easy to test;
 * network access and SSRF checks happen in safe-fetch.ts.
 */

const MAX_CANDIDATES = 4;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function collectImages(node: unknown, out: string[], depth = 0): void {
  if (depth > 6 || node == null) return;
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const n of node) collectImages(n, out, depth + 1);
  } else if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.url === "string") out.push(o.url);
    else if (typeof o.contentUrl === "string") out.push(o.contentUrl);
  }
}

function jsonLdImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const n = stack.pop();
      if (Array.isArray(n)) stack.push(...n);
      else if (n && typeof n === "object") {
        const o = n as Record<string, unknown>;
        if (o["@graph"]) stack.push(o["@graph"]);
        const type = o["@type"];
        const isProduct = Array.isArray(type) ? type.includes("Product") : type === "Product";
        if (isProduct) collectImages(o.image, out);
      }
    }
  }
  return out;
}

export function extractImageCandidates(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/<(meta|link)\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? "").toLowerCase();
    if (m[1].toLowerCase() === "meta" && a.content) {
      if (["og:image", "og:image:secure_url", "og:image:url", "twitter:image", "twitter:image:src"].includes(key))
        found.push(a.content);
      else if (key === "image") found.push(a.content);
    } else if (m[1].toLowerCase() === "link" && a.rel?.toLowerCase() === "image_src" && a.href) {
      found.push(a.href);
    }
  }
  found.push(...jsonLdImages(html));

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of found) {
    let abs: string;
    try {
      abs = new URL(raw.trim(), baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs) || seen.has(abs)) continue;
    seen.add(abs);
    result.push(abs);
    if (result.length >= MAX_CANDIDATES) break;
  }
  return result;
}
