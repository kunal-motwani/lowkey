// Generates 3 original sample garment images (flat-lay tees) - no third-party assets.
import sharp from "sharp";
import fs from "fs";

const out = "public/samples";
fs.mkdirSync(out, { recursive: true });
const tee = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024">
<rect width="768" height="1024" fill="#f4f4f4"/>
<defs><linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".25" stop-color="#000" stop-opacity="0"/><stop offset=".75" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs>
<path d="M270 110 Q384 190 498 110 L650 190 L720 400 L610 430 L590 360 L590 900 Q384 930 178 900 L178 360 L158 430 L48 400 L118 190 Z" fill="${c}"/>
<path d="M270 110 Q384 190 498 110 L650 190 L720 400 L610 430 L590 360 L590 900 Q384 930 178 900 L178 360 L158 430 L48 400 L118 190 Z" fill="url(#s)"/>
<path d="M270 110 Q384 200 498 110 Q384 160 270 110Z" fill="#000" fill-opacity=".25"/>
</svg>`;
const items = { "olive-tee": "#7d8239", "coral-top": "#f0705a", "navy-shirt": "#1f2f5c" };
for (const [n, c] of Object.entries(items)) await sharp(Buffer.from(tee(c))).jpeg({ quality: 92 }).toFile(`${out}/${n}.jpg`);
console.log("ok");
