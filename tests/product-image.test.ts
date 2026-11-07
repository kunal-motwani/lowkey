import { describe, expect, it } from "vitest";
import { extractImageCandidates } from "@/lib/product-image";

const BASE = "https://shop.example.com/p/123";

describe("extractImageCandidates", () => {
  it("reads og:image in either attribute order, with entities decoded", () => {
    const html = `<head>
      <meta property="og:image" content="https://cdn.example.com/a.jpg?x=1&amp;y=2">
      <meta content="https://cdn.example.com/b.jpg" property='og:image:secure_url'>
    </head>`;
    expect(extractImageCandidates(html, BASE)).toEqual([
      "https://cdn.example.com/a.jpg?x=1&y=2",
      "https://cdn.example.com/b.jpg",
    ]);
  });

  it("reads twitter:image and link rel=image_src, resolving relative URLs", () => {
    const html = `<meta name="twitter:image" content="/img/t.jpg"><link rel="image_src" href="//cdn.example.com/l.jpg">`;
    expect(extractImageCandidates(html, BASE)).toEqual([
      "https://shop.example.com/img/t.jpg",
      "https://cdn.example.com/l.jpg",
    ]);
  });

  it("reads JSON-LD Product images (string, array, ImageObject, @graph)", () => {
    const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
    expect(extractImageCandidates(ld({ "@type": "Product", image: "https://c.example.com/1.jpg" }), BASE)).toEqual([
      "https://c.example.com/1.jpg",
    ]);
    expect(
      extractImageCandidates(
        ld({ "@type": "Product", image: ["https://c.example.com/2.jpg", "https://c.example.com/3.jpg"] }),
        BASE
      )
    ).toEqual(["https://c.example.com/2.jpg", "https://c.example.com/3.jpg"]);
    expect(
      extractImageCandidates(ld({ "@graph": [{ "@type": ["Thing", "Product"], image: { url: "/g.jpg" } }] }), BASE)
    ).toEqual(["https://shop.example.com/g.jpg"]);
  });

  it("ignores non-Product JSON-LD, invalid JSON, non-http schemes, and dedupes", () => {
    const html = `
      <script type="application/ld+json">{"@type":"Organization","image":"https://c.example.com/logo.jpg"}</script>
      <script type="application/ld+json">{not json</script>
      <meta property="og:image" content="javascript:alert(1)">
      <meta property="og:image" content="data:image/png;base64,AAAA">
      <meta property="og:image" content="https://c.example.com/x.jpg">
      <meta name="twitter:image" content="https://c.example.com/x.jpg">`;
    expect(extractImageCandidates(html, BASE)).toEqual(["https://c.example.com/x.jpg"]);
  });

  it("caps the number of candidates and returns [] for pages with none", () => {
    const many = Array.from(
      { length: 10 },
      (_, i) => `<meta property="og:image" content="https://c.example.com/${i}.jpg">`
    ).join("");
    expect(extractImageCandidates(many, BASE)).toHaveLength(4);
    expect(extractImageCandidates("<html><body>hi</body></html>", BASE)).toEqual([]);
  });
});
