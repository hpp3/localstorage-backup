import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svg = await readFile(resolve(root, 'icons/icon.svg'));

const sizes = [16, 32, 48, 128];
await mkdir(resolve(root, 'icons'), { recursive: true });

for (const size of sizes) {
  const out = resolve(root, `icons/icon-${size}.png`);
  await sharp(svg).resize(size, size).png().toFile(out);
  console.log(`wrote icons/icon-${size}.png`);
}
