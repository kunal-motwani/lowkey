// Generates ORIGINAL sample shoe and jewellery images (simple SVG shapes) - no third-party or brand imagery.
import sharp from "sharp";
import fs from "fs";

const out = "public/samples";
fs.mkdirSync(out, { recursive: true });
const W = 768;
const H = 768;
const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="#f4f4f4"/>${body}</svg>`;

const sneaker = (upper, sole, lace) =>
  wrap(`<ellipse cx="384" cy="560" rx="290" ry="18" fill="#000" fill-opacity=".1"/>
<path d="M90 470 Q90 330 190 320 L270 330 Q330 400 420 410 Q560 420 640 470 Q690 495 680 540 L90 540 Z" fill="${upper}"/>
<path d="M90 470 Q90 330 190 320 L270 330 Q330 400 420 410 Q560 420 640 470 Q690 495 680 540 L90 540 Z" fill="url(#g)"/>
<path d="M80 535 L690 535 Q700 575 660 585 L110 585 Q74 575 80 535 Z" fill="${sole}"/>
<path d="M330 372 L360 345 M370 392 L400 365 M410 405 L440 378" stroke="${lace}" stroke-width="12" stroke-linecap="round"/>
<path d="M190 320 Q230 300 270 330" fill="none" stroke="${lace}" stroke-width="8" stroke-linecap="round"/>`);

const necklace = (c) =>
  wrap(`<path d="M170 200 Q384 640 598 200" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round" stroke-dasharray="1 0"/>
<path d="M170 200 Q384 640 598 200" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-dasharray="10 14"/>
<circle cx="384" cy="470" r="34" fill="${c}"/><circle cx="384" cy="470" r="34" fill="url(#g)"/>`);

const earrings = (c) => {
  const hoop = (x) =>
    `<circle cx="${x}" cy="420" r="85" fill="none" stroke="${c}" stroke-width="20"/><circle cx="${x}" cy="420" r="85" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="5" stroke-dasharray="40 300" transform="rotate(-40 ${x} 420)"/><rect x="${x - 6}" y="320" width="12" height="26" rx="6" fill="${c}"/>`;
  return wrap(hoop(250) + hoop(518));
};

const ring = (c) =>
  wrap(`<ellipse cx="384" cy="460" rx="150" ry="170" fill="none" stroke="${c}" stroke-width="42"/>
<ellipse cx="384" cy="460" rx="150" ry="170" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="8" stroke-dasharray="80 900" transform="rotate(-50 384 460)"/>
<polygon points="384,225 430,285 384,335 338,285" fill="#e8f4ff" stroke="${c}" stroke-width="12"/>`);

const bracelet = (c) =>
  wrap(`<ellipse cx="384" cy="400" rx="250" ry="150" fill="none" stroke="${c}" stroke-width="34"/>
<ellipse cx="384" cy="400" rx="250" ry="150" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="7" stroke-dasharray="120 1600" transform="rotate(-20 384 400)"/>`);

const METALS = { gold: "#d4a935", silver: "#b9bec6", "rose-gold": "#d99a8a" };
const items = {
  "shoes-white": sneaker("#f7f7f5", "#d9d9d6", "#9a9a98"),
  "shoes-black": sneaker("#2b2b2e", "#ececec", "#6b6b6e"),
  "shoes-tan": sneaker("#b98a5b", "#f1ead9", "#7c5834"),
};
for (const [m, c] of Object.entries(METALS)) {
  items[`necklace-${m}`] = necklace(c);
  items[`earrings-${m}`] = earrings(c);
  items[`bracelet-${m}`] = bracelet(c);
  items[`ring-${m}`] = ring(c);
}
for (const [n, svg] of Object.entries(items))
  await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(`${out}/${n}.jpg`);
console.log("ok", Object.keys(items).length);
