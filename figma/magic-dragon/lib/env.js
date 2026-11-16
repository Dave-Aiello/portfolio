/* Finds Playwright and sharp, and launches Chromium.
   Uses the normal require() first (npm install --no-save playwright sharp at the
   repo root), then PLAYWRIGHT_PATH / SHARP_PATH, then a few known local installs. */
const fs = require("fs");
const path = require("path");
const os = require("os");

const FALLBACK_DIRS = [
  path.join(os.homedir(), "code/uproot-website/node_modules"),
  path.join(os.homedir(), "claude-scratch/consumer-app/splash-draw/tools/node_modules")
];

function load(names, envVar) {
  const tries = [];
  if (process.env[envVar]) tries.push(process.env[envVar]);
  for (const n of names) tries.push(n);
  for (const dir of FALLBACK_DIRS) for (const n of names) tries.push(path.join(dir, n));
  for (const t of tries) {
    try { return require(t); } catch (e) { /* next */ }
  }
  throw new Error("Could not load " + names.join(" or ") + ". Run: npm install --no-save playwright sharp");
}

function playwright() { return load(["playwright", "playwright-core"], "PLAYWRIGHT_PATH"); }
function sharp() { return load(["sharp"], "SHARP_PATH"); }

async function launch() {
  const { chromium } = playwright();
  try {
    return await chromium.launch();
  } catch (e) {
    const cache = path.join(os.homedir(), ".cache/ms-playwright");
    const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
    for (const d of dirs) {
      const exe = path.join(cache, d, "chrome-linux64/chrome");
      if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe });
    }
    throw e;
  }
}

module.exports = { playwright, sharp, launch };
