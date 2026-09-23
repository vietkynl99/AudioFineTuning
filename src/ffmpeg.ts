import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// Single-thread core, served same-origin from public/ffmpeg (synced from
// node_modules by scripts/sync-ffmpeg-core.mjs) — avoids CORS/CDN failures
// and needs no SharedArrayBuffer / COOP+COEP headers, so it runs on plain
// static hosting like GitHub Pages.
const CORE_BASE_URL = `${import.meta.env.BASE_URL}ffmpeg`;

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(onLog?: (message: string) => void): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const instance = new FFmpeg();
    if (onLog) {
      instance.on("log", ({ message }) => onLog(message));
    }
    await instance.load({
      coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpeg = instance;
    return instance;
  })();

  return loadPromise;
}

export async function extractAudio(
  videoFile: File,
  onProgress?: (ratio: number) => void
): Promise<Blob> {
  const ff = await getFFmpeg();
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
  onProgress?: (ratio: number) => void
): Promise<Blob> {
  const ff = await getFFmpeg();
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
