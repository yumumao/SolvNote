// Reuse the existing project mark; run with the project's installed sharp.
// Generated PNGs are committed, so production needs no image generation step.
/* eslint-disable @typescript-eslint/no-require-imports -- Node.js CommonJS maintenance script. */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const dir = path.join(__dirname, '../public/icons');
const source = fs.readFileSync(path.join(dir, 'icon.svg'));
const background = '#38bdf8';

(async () => {
  for (const [name, size] of [['install-192.png', 192], ['install-512.png', 512], ['apple-touch-icon.png', 180]]) {
    await sharp(source).resize(size, size).flatten({ background }).png().toFile(path.join(dir, name));
  }
  // Place all meaningful parts inside the central 80%-diameter safe circle.
  const mark = await sharp(source).resize(320, 320).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 3, background } })
    .composite([{ input: mark, left: 96, top: 96 }]).png()
    .toFile(path.join(dir, 'install-maskable-512.png'));
})().catch(() => { console.error('Could not generate install icons'); process.exitCode = 1; });
