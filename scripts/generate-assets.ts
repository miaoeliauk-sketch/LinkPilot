import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const decorationDirectory = resolve("assets", "decorations");
const backgroundDirectory = resolve("assets", "backgrounds");

const decorations = {
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

const backgrounds = {
  "grid-tile.png": `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" fill="#F5F0E8"/>
      <g fill="none" stroke="#2E4057" stroke-width="2" opacity=".12">
        <path d="M0 0H128M0 64H128M0 128H128"/>
        <path d="M0 0V128M64 0V128M128 0V128"/>
      </g>
    </svg>
  `,
  "xuan-paper-tile.png": `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect width="256" height="256" fill="#F5F0E8"/>
      <g fill="none" stroke="#A0522D" stroke-linecap="round" opacity=".07">
        <path d="M12 34C58 23 91 46 142 31s72-7 104 5" stroke-width="2"/>
        <path d="M-8 112c45-21 88 16 131-5s86-6 143 4" stroke-width="1.5"/>
        <path d="M18 198c35-13 71 12 110-2s80-9 122 7" stroke-width="2"/>
        <path d="M42 0c-8 54 12 90 1 142s4 78 0 114" stroke-width="1"/>
        <path d="M176-10c-10 42 8 75-2 118s6 91 1 158" stroke-width="1.5"/>
      </g>
    </svg>
  `,
} as const;

await Promise.all([
  mkdir(decorationDirectory, { recursive: true }),
  mkdir(backgroundDirectory, { recursive: true }),
]);

for (const [filename, svg] of Object.entries(decorations)) {
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(resolve(decorationDirectory, filename));
}

for (const [filename, svg] of Object.entries(backgrounds)) {
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(resolve(backgroundDirectory, filename));
}

process.stdout.write(
  `已生成${Object.keys(decorations).length}个装饰素材和${Object.keys(backgrounds).length}个背景素材\n`,
);
