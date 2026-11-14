/**
 * Copy contract sample bundles from the repo samples/ folder into public/
 * so Vite can serve them at /samples/... in dev and production.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rootSamples = join(here, "..", "..", "samples");
const publicSamples = join(here, "..", "public", "samples");

mkdirSync(publicSamples, { recursive: true });

if (!existsSync(rootSamples)) {
  console.warn("No samples/ folder at repo root; skipping copy.");
  process.exit(0);
}

for (const name of readdirSync(rootSamples)) {
  if (!name.endsWith(".json")) continue;
  const from = join(rootSamples, name);
  const to = join(publicSamples, name);
  copyFileSync(from, to);
  console.log(`copied ${name}`);
}
