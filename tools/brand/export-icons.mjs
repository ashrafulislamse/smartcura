// SmartCura brand raster exporter.
//
// Reads the hand-built SVG sources in design/brand and writes every raster the
// platform projects consume: Android launcher mipmaps + splash glyph, iOS app
// icon set + LaunchImage splash set, web PWA icons + favicon, macOS app icon,
// and the Windows runner .ico (a 256px PNG embedded in an ICO container).
//
// Usage (from anywhere):  node tools/brand/export-icons.mjs
// Requires:              npm install --prefix tools/brand   (sharp)
//
// The SVGs remain the source of truth; rerun this after any brand change.

import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const brand = (...p) => path.join(root, 'design', 'brand', ...p);
const app = (a, ...p) => path.join(root, 'apps', a, ...p);

const APPS = ['patient-app', 'doctor-app', 'driver-app'];
const iconFor = (a) => brand('icons', `${a}.svg`);
const SPLASH_GLYPH = brand('logos', 'smartcura-mark-white.svg');

// Rasterize a vector once at 1024; every target downscales from this buffer.
async function master(svg) {
  return sharp(svg, { density: 192 }).resize(1024, 1024).png().toBuffer();
}

async function emit(buf, size, out) {
  mkdirSync(path.dirname(out), { recursive: true });
  await sharp(buf).resize(size, size, { kernel: 'lanczos3' }).png().toFile(out);
}

// Minimal ICO container: one 256px PNG entry (width/height byte 0 == 256).
function packIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256px
  entry[1] = 0; // 256px
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset after 6+16 byte headers
  return Buffer.concat([header, entry, png]);
}

let count = 0;
for (const a of APPS) {
  const icon = await master(iconFor(a));
  const glyph = await master(SPLASH_GLYPH);
  const put = (buf, size, rel) => { count++; return emit(buf, size, app(a, rel)); };

  const jobs = [
    // Android launcher
    put(icon, 48, 'android/app/src/main/res/mipmap-mdpi/ic_launcher.png'),
    put(icon, 72, 'android/app/src/main/res/mipmap-hdpi/ic_launcher.png'),
    put(icon, 96, 'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png'),
    put(icon, 144, 'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png'),
    put(icon, 192, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'),
    // Android splash glyph (layered over the gradient in launch_background.xml)
    put(glyph, 512, 'android/app/src/main/res/drawable/launch_logo.png'),
  ];

  // iOS launcher
  const ios = 'ios/Runner/Assets.xcassets/AppIcon.appiconset/';
  for (const [size, file] of [
    [20, 'Icon-App-20x20@1x.png'], [40, 'Icon-App-20x20@2x.png'], [60, 'Icon-App-20x20@3x.png'],
    [29, 'Icon-App-29x29@1x.png'], [58, 'Icon-App-29x29@2x.png'], [87, 'Icon-App-29x29@3x.png'],
    [40, 'Icon-App-40x40@1x.png'], [80, 'Icon-App-40x40@2x.png'], [120, 'Icon-App-40x40@3x.png'],
    [120, 'Icon-App-60x60@2x.png'], [180, 'Icon-App-60x60@3x.png'],
    [76, 'Icon-App-76x76@1x.png'], [152, 'Icon-App-76x76@2x.png'],
    [167, 'Icon-App-83.5x83.5@2x.png'], [1024, 'Icon-App-1024x1024@1x.png'],
  ]) jobs.push(put(icon, size, ios + file));

  // iOS splash (centered by LaunchScreen.storyboard on the brand color)
  const li = 'ios/Runner/Assets.xcassets/LaunchImage.imageset/';
  jobs.push(put(glyph, 320, li + 'LaunchImage.png'));
  jobs.push(put(glyph, 640, li + 'LaunchImage@2x.png'));
  jobs.push(put(glyph, 960, li + 'LaunchImage@3x.png'));

  // Web PWA
  jobs.push(put(icon, 96, 'web/favicon.png'));
  jobs.push(put(icon, 192, 'web/icons/Icon-192.png'));
  jobs.push(put(icon, 512, 'web/icons/Icon-512.png'));
  jobs.push(put(icon, 192, 'web/icons/Icon-maskable-192.png'));
  jobs.push(put(icon, 512, 'web/icons/Icon-maskable-512.png'));

  // macOS launcher
  const mac = 'macos/Runner/Assets.xcassets/AppIcon.appiconset/';
  for (const n of [16, 32, 64, 128, 256, 512, 1024]) jobs.push(put(icon, n, `${mac}app_icon_${n}.png`));

  await Promise.all(jobs);

  // Windows launcher (single 256px PNG inside an ICO)
  const icoBuf = await sharp(icon).resize(256, 256).png().toBuffer();
  mkdirSync(app(a, 'windows/runner/resources'), { recursive: true });
  writeFileSync(app(a, 'windows/runner/resources/app_icon.ico'), packIco(icoBuf));
  count++;
}

console.log(`exported ${count} brand rasters across ${APPS.length} apps`);
