import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

// Single-thread core, served same-origin from public/ffmpeg (synced from
// node_modules by scripts/sync-ffmpeg-core.mjs) — avoids CORS/CDN failures
// and needs no SharedArrayBuffer / COOP+COEP headers, so it runs on plain
// static hosting like GitHub Pages.
const CORE_BASE_URL = `${import.meta.env.BASE_URL}ffmpeg`;
const CORE_CACHE_NAME = "ffmpeg-core-v1";
// ffmpeg-core.wasm alone is ~30MB; weight progress so the much larger wasm
// download dominates the reported percentage instead of the ~100KB core.js.
const JS_WEIGHT = 0.03;

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

// Fetches into the Cache Storage API (persists across reloads, unlike a
// plain blob fetch) and reports byte progress — the wasm download is large
// enough on mobile networks that a silent multi-minute wait reads as "stuck".
async function cachedFetchBlobURL(
  url: string,
  mimeType: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<string> {
  const absoluteUrl = new URL(url, location.href).toString();
  const cache = await caches.open(CORE_CACHE_NAME);
  let response = await cache.match(absoluteUrl);

  if (!response) {
    let networkResponse: Response;
    try {
      networkResponse = await fetch(absoluteUrl);
    } catch (err) {
      throw new Error(
        `Không tải được ${url.split("/").pop()} — kiểm tra kết nối mạng rồi thử lại. (${
          err instanceof Error ? err.message : String(err)
        })`
      );
    }
    if (!networkResponse.ok || !networkResponse.body) {
      throw new Error(`Tải ${url.split("/").pop()} thất bại: HTTP ${networkResponse.status}`);
    }

    const total = Number(networkResponse.headers.get("content-length")) || 0;
    const reader = networkResponse.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }

    response = new Response(new Blob(chunks as BlobPart[]), {
      headers: { "Content-Type": mimeType },
    });
    await cache.put(absoluteUrl, response.clone());
  } else {
    onProgress?.(1, 1);
  }

  return URL.createObjectURL(await response.blob());
}

export async function getFFmpeg(
  onLog?: (message: string) => void,
  onLoadProgress?: (ratio: number) => void
): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const instance = new FFmpeg();
    if (onLog) {
      instance.on("log", ({ message }) => onLog(message));
    }
    try {
      const coreURL = await cachedFetchBlobURL(
        `${CORE_BASE_URL}/ffmpeg-core.js`,
        "text/javascript",
        (loaded, total) => onLoadProgress?.(total ? (loaded / total) * JS_WEIGHT : 0)
      );
      const wasmURL = await cachedFetchBlobURL(
        `${CORE_BASE_URL}/ffmpeg-core.wasm`,
        "application/wasm",
        (loaded, total) => onLoadProgress?.(total ? JS_WEIGHT + (loaded / total) * (1 - JS_WEIGHT) : JS_WEIGHT)
      );
      await instance.load({ coreURL, wasmURL });
    } catch (err) {
      loadPromise = null;
      throw err;
    }
    ffmpeg = instance;
    return instance;
  })();

  return loadPromise;
}

export async function extractAudio(
  videoFile: File,
  onProgress?: (ratio: number) => void,
  onLoadProgress?: (ratio: number) => void
): Promise<Blob> {
  const ff = await getFFmpeg(undefined, onLoadProgress);
  const inputName = "input" + extOf(videoFile.name);
  const outputName = "audio.wav";

  if (onProgress) ff.on("progress", ({ progress }) => onProgress(progress));
  await ff.writeFile(inputName, await fetchFile(videoFile));
  await ff.exec(["-i", inputName, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", outputName]);
  const data = (await ff.readFile(outputName)) as Uint8Array;
  await ff.deleteFile(inputName);
  await ff.deleteFile(outputName);

  return new Blob([data.buffer as ArrayBuffer], { type: "audio/wav" });
}

export async function muxAudioIntoVideo(
  videoFile: File,
  audioBlob: Blob,
  onProgress?: (ratio: number) => void,
  onLoadProgress?: (ratio: number) => void
): Promise<Blob> {
  const ff = await getFFmpeg(undefined, onLoadProgress);
  const inputVideoName = "input" + extOf(videoFile.name);
  const inputAudioName = "processed.wav";
  const outputName = "output" + extOf(videoFile.name);

  if (onProgress) ff.on("progress", ({ progress }) => onProgress(progress));
  await ff.writeFile(inputVideoName, await fetchFile(videoFile));
  await ff.writeFile(inputAudioName, await fetchFile(audioBlob));
  await ff.exec([
    "-i", inputVideoName,
    "-i", inputAudioName,
    "-c:v", "copy",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-shortest",
    outputName,
  ]);
  const data = (await ff.readFile(outputName)) as Uint8Array;
  await ff.deleteFile(inputVideoName);
  await ff.deleteFile(inputAudioName);
  await ff.deleteFile(outputName);

  return new Blob([data.buffer as ArrayBuffer], { type: videoFile.type || "video/mp4" });
}

function extOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? ".mp4" : filename.slice(idx);
}
