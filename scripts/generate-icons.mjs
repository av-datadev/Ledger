// Generates the PWA icon set from an inline SVG (dark navy + stacked coins).
// Run once after `npm install`: npm run icons
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const OUT = "public/icons";
mkdirSync(OUT, { recursive: true });

// glyph: three stacked coins, top coin in crimson.
const glyph = `
  <g stroke="#F2F3EF" stroke-width="20" fill="none" stroke-linecap="round">
    <path d="M140 342 v-56 M372 342 v-56" />
    <ellipse cx="256" cy="342" rx="116" ry="42" fill="#182B3A" />
    <path d="M140 286 v-56 M372 286 v-56" />
    <ellipse cx="256" cy="286" rx="116" ry="42" fill="#182B3A" />
    <ellipse cx="256" cy="230" rx="116" ry="42" fill="#A63A2B" />
  </g>`;

const appIcon = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 100}" fill="#182B3A"/>
  ${pad ? `<g transform="translate(256 256) scale(0.72) translate(-256 -256)">${glyph}</g>` : glyph}
</svg>`;

const standard = Buffer.from(appIcon(false));
const maskable = Buffer.from(appIcon(true)); // full-bleed bg, smaller glyph

await sharp(standard).resize(192, 192).png().toFile(`${OUT}/icon-192.png`);
await sharp(standard).resize(512, 512).png().toFile(`${OUT}/icon-512.png`);
await sharp(maskable).resize(512, 512).png().toFile(`${OUT}/maskable-512.png`);
await sharp(standard).resize(180, 180).png().toFile(`${OUT}/apple-touch-icon.png`);

console.log("Icons written to", OUT);
