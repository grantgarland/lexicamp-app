#!/usr/bin/env node

/**
 * Sync app store / publication assets from the design system (the source of truth).
 *
 * Source of truth: ../lexicamp-design-system/project/assets
 *
 * Most assets are copied verbatim. The splash mark is *derived* from the
 * monochrome launcher art via a flat recolour (preserving alpha). It must be
 * derived from the MONOCHROME art (transparent interior), NOT the adaptive
 * foreground: the foreground's white circle fill is opaque, so recolouring it
 * would flood the whole disc into a solid blob.
 *   - splash-icon.png      -> brand ink (#1F3D52)  (light splash, cream bg)
 *   - splash-icon-dark.png -> white     (#FFFFFF)  (dark splash, night-slate bg)
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
  ["icons/android/ic_launcher_monochrome.png", "android-icon-monochrome.png"],
  ["favicons/favicon-48.png", "favicon.png"],
];

// Derived from the (just-copied) monochrome art via a flat recolour.
const DERIVED = [
  { out: "splash-icon.png", hex: "1F3D52" },
  { out: "splash-icon-dark.png", hex: "FFFFFF" },
];

const DERIVE_SOURCE = "android-icon-monochrome.png";

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

  const fgSrc = path.join(images, DERIVE_SOURCE);
  for (const { out, hex } of DERIVED) {
    await recolour(fgSrc, path.join(images, out), hex);
    console.log(`derived ${out}  (#${hex})`);
  }

  console.log("\n✔ Brand assets synced from design system.");
}

main().catch((e) => fail(e.stack || String(e)));
