import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const outputDirectory = resolve("assets", "decorations");

const assets = {
  "seal.png": `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <g fill="none" stroke="#C23531" stroke-linecap="square" stroke-linejoin="miter">
        <rect x="18" y="18" width="220" height="220" rx="10" stroke-width="18"/>
        <path d="M64 62h52v52H64zM140 62h52v22h-30v30h-22zM64 140h22v52H64zM108 140h84v52h-22v-30h-40v30h-22z" stroke-width="14"/>
      </g>
    </svg>
  `,
  "cloud.png": `
    <svg xmlns="http://www.w3.org/2000/svg" width="384" height="192" viewBox="0 0 384 192">
      <g fill="none" stroke="#2E4057" stroke-linecap="round" stroke-linejoin="round">
        <path d="M32 132h248c40 0 58-42 30-68-20-18-50-12-62 10-8-38-42-62-80-52-28 8-46 32-48 60-34-20-74 4-74 42 0 3 0 5 1 8" stroke-width="14"/>
        <path d="M88 154h212M132 174h118" stroke-width="9"/>
        <path d="M284 102c22-18 56-2 56 26 0 15-12 26-28 26h-12" stroke-width="10"/>
      </g>
    </svg>
  `,
  "tape.png": `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="128" viewBox="0 0 320 128">
      <path d="M18 24L302 12l-8 96L12 116z" fill="#F5F0E8" stroke="#E8B004" stroke-width="8" stroke-linejoin="round"/>
      <g stroke="#E8B004" stroke-width="10" opacity=".72">
        <path d="M44 25L20 59M92 23L30 108M142 21L82 113M194 19L134 111M246 17L186 109M296 15L238 107"/>
      </g>
    </svg>
  `,
} as const;

await mkdir(outputDirectory, { recursive: true });

for (const [filename, svg] of Object.entries(assets)) {
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(resolve(outputDirectory, filename));
}

process.stdout.write(`已生成${Object.keys(assets).length}个装饰素材：${outputDirectory}\n`);
