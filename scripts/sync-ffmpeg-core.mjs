// Copies @ffmpeg/core's single-thread build into public/ so it's served
// same-origin — avoids CORS/CDN failures loading ffmpeg-core.js at runtime.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// ffmpeg.wasm always spins up a module-type Worker, which cannot use the
// UMD build (classic-script-only) — it must be the ESM build.
const srcDir = join(root, "node_modules/@ffmpeg/core/dist/esm");
const destDir = join(root, "public/ffmpeg");

mkdirSync(destDir, { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  copyFileSync(join(srcDir, file), join(destDir, file));
}
console.log("ffmpeg-core synced to public/ffmpeg");
