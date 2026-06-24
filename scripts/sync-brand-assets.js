#!/usr/bin/env node

/**
 * Sync app store / publication assets from the design system (the source of truth).
 *
 * Source of truth: ../lexicamp-design-system/project/assets
 *
 * Most assets are copied verbatim. Two are *derived* from the Android adaptive
 * foreground via a flat recolour (preserving alpha), because the design system
 * has no native source for them:
 *   - android-icon-monochrome.png -> brand ink (#1F3D52)  (Android themed icon)
 *   - splash-icon.png             -> white     (#FFFFFF)   (splash logo mark)
 *
 * Run after the design system changes:   npm run sync:assets
 * CI drift guard: run this, then `git diff --exit-code -- assets/images`.
 */

const fs = require("fs");
const path = require("path");
const Jimp = require("jimp-compact");

const appRoot = path.resolve(__dirname, "..");
const ds = path.resolve(appRoot, "../lexicamp-design-system/project/assets");
const images = path.join(appRoot, "assets", "images");

// [from design system] -> [app asset], copied verbatim.
const COPIES = [
  ["icons/app-icon-1024.png", "icon.png"],
  ["icons/android/ic_launcher_foreground.png", "android-icon-foreground.png"],
  ["icons/android/ic_launcher_background.png", "android-icon-background.png"],
  ["favicons/favicon-48.png", "favicon.png"],
];

// Derived from the (just-copied) adaptive foreground via a flat recolour.
const DERIVED = [
  { out: "android-icon-monochrome.png", hex: "1F3D52" },
  { out: "splash-icon.png", hex: "FFFFFF" },
];

const FOREGROUND = "android-icon-foreground.png";

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function recolour(src, out, hex) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const img = await Jimp.read(src);
  const { data, width, height } = img.bitmap;
  img.scan(0, 0, width, height, (x, y, idx) => {
    if (data[idx + 3] > 0) {
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
    }
  });
  await img.writeAsync(out);
}

async function main() {
  if (!fs.existsSync(ds)) {
    fail(
      `Design system assets not found at:\n    ${ds}\n` +
        `  Expected lexicamp-design-system as a sibling of lexicamp-app.`
    );
  }

  for (const [from, to] of COPIES) {
    const src = path.join(ds, from);
    if (!fs.existsSync(src)) fail(`Missing source asset: ${src}`);
    fs.copyFileSync(src, path.join(images, to));
    console.log(`copied  ${to}`);
  }

  const fgSrc = path.join(images, FOREGROUND);
  for (const { out, hex } of DERIVED) {
    await recolour(fgSrc, path.join(images, out), hex);
    console.log(`derived ${out}  (#${hex})`);
  }

  console.log("\n✔ Brand assets synced from design system.");
}

main().catch((e) => fail(e.stack || String(e)));
