import "./style.css";
import {
  defaultBands,
  PRESETS,
  applyEq,
  decodeAudioFile,
  createLiveFilterChain,
  type EqBand,
  type LiveFilterChain,
} from "./eq";
import { extractAudio, muxAudioIntoVideo } from "./ffmpeg";

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <main class="app">
    <h1>Audio Fine Tuning</h1>
    <p class="subtitle">Chỉnh EQ âm thanh trong video, xử lý ngay trên trình duyệt</p>

    <section class="card">
      <label class="file-label" for="video-input">
        <span id="file-name">Chọn video…</span>
        <input id="video-input" type="file" accept="video/*" />
      </label>
      <div id="prep-status" class="status"></div>
    </section>

    <section class="card hidden" id="tune-card">
      <h2>Nghe thử &amp; chỉnh EQ</h2>
      <audio id="audio-preview" controls loop class="audio-preview"></audio>

      <h3>Preset</h3>
      <div id="presets" class="presets"></div>

      <h3>Equalizer</h3>
      <div id="bands" class="bands"></div>
    </section>

    <section class="card hidden" id="export-card">
      <button id="export-btn" class="primary-btn">Xuất video</button>
      <div id="export-status" class="status"></div>
      <div id="progress-wrap" class="progress-wrap hidden">
        <div id="progress-bar" class="progress-bar"></div>
      </div>
    </section>

    <section class="card hidden" id="result-card">
      <h2>Kết quả</h2>
      <video id="result-preview" controls playsinline class="preview"></video>
      <a id="download-link" class="primary-btn" download>Tải về</a>
    </section>
  </main>
`;

const videoInput = document.querySelector<HTMLInputElement>("#video-input")!;
const fileNameEl = document.querySelector<HTMLSpanElement>("#file-name")!;
const prepStatusEl = document.querySelector<HTMLDivElement>("#prep-status")!;
const tuneCard = document.querySelector<HTMLDivElement>("#tune-card")!;
const audioPreview = document.querySelector<HTMLAudioElement>("#audio-preview")!;
const presetsEl = document.querySelector<HTMLDivElement>("#presets")!;
const bandsEl = document.querySelector<HTMLDivElement>("#bands")!;
const exportCard = document.querySelector<HTMLDivElement>("#export-card")!;
const exportBtn = document.querySelector<HTMLButtonElement>("#export-btn")!;
const exportStatusEl = document.querySelector<HTMLDivElement>("#export-status")!;
const progressWrap = document.querySelector<HTMLDivElement>("#progress-wrap")!;
const progressBar = document.querySelector<HTMLDivElement>("#progress-bar")!;
const resultCard = document.querySelector<HTMLDivElement>("#result-card")!;
const resultPreview = document.querySelector<HTMLVideoElement>("#result-preview")!;
const downloadLink = document.querySelector<HTMLAnchorElement>("#download-link")!;

let currentFile: File | null = null;
let bands: EqBand[] = defaultBands();
let cachedAudioBuffer: AudioBuffer | null = null;
let liveChain: LiveFilterChain | null = null;
let previewObjectUrl: string | null = null;
let resultObjectUrl: string | null = null;

function renderPresets() {
  presetsEl.innerHTML = "";
  for (const preset of PRESETS) {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.textContent = preset.name;
    btn.addEventListener("click", () => {
      bands = bands.map((band, i) => ({ ...band, gain: preset.gains[i] }));
      applyBandsToUiAndLiveChain();
    });
    presetsEl.appendChild(btn);
  }
}

function applyBandsToUiAndLiveChain() {
  const rows = bandsEl.querySelectorAll<HTMLDivElement>(".band-row");
  rows.forEach((row, i) => {
    const input = row.querySelector<HTMLInputElement>("input")!;
    const valueEl = row.querySelector(".gain-value")!;
    input.value = String(bands[i].gain);
    valueEl.textContent = `${bands[i].gain.toFixed(1)} dB`;
  });
  if (liveChain) {
    liveChain.filters.forEach((filter, i) => {
      filter.gain.value = bands[i].gain;
    });
  }
}

function renderBands() {
  bandsEl.innerHTML = "";
  bands.forEach((band, i) => {
    const row = document.createElement("div");
    row.className = "band-row";
    row.innerHTML = `
      <label>${band.label}</label>
      <input type="range" min="-12" max="12" step="0.5" value="${band.gain}" />
      <span class="gain-value">${band.gain.toFixed(1)} dB</span>
    `;
    const input = row.querySelector("input")!;
    const valueEl = row.querySelector(".gain-value")!;
    input.addEventListener("input", () => {
      const gain = parseFloat(input.value);
      bands[i] = { ...band, gain };
      valueEl.textContent = `${gain.toFixed(1)} dB`;
      if (liveChain) {
        liveChain.filters[i].gain.value = gain;
      }
    });
    bandsEl.appendChild(row);
  });
}

// Connecting MediaElementSource requires a user gesture on iOS Safari/WebKit,
// so the Web Audio graph is built lazily on first play rather than on file load.
function ensureLiveChainConnected() {
  if (liveChain) return;
  const context = new AudioContext();
  const source = context.createMediaElementSource(audioPreview);
  liveChain = createLiveFilterChain(context, bands);
  source.connect(liveChain.input);
}

function resetForNewFile() {
  liveChain = null;
  cachedAudioBuffer = null;
  bands = defaultBands();
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
  if (resultObjectUrl) {
    URL.revokeObjectURL(resultObjectUrl);
    resultObjectUrl = null;
  }
  tuneCard.classList.add("hidden");
  exportCard.classList.add("hidden");
  resultCard.classList.add("hidden");
}

videoInput.addEventListener("change", async () => {
  const file = videoInput.files?.[0] ?? null;
  if (!file) return;
  currentFile = file;
  resetForNewFile();

  fileNameEl.textContent = file.name;

  try {
    prepStatusEl.textContent = "Đang tách âm thanh để nghe thử…";
    const audioBlob = await extractAudio(file);

    prepStatusEl.textContent = "Đang giải mã âm thanh…";
    cachedAudioBuffer = await decodeAudioFile(audioBlob);

    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(audioBlob);
    audioPreview.src = previewObjectUrl;
    audioPreview.addEventListener("play", ensureLiveChainConnected, { once: true });

    prepStatusEl.textContent = "";
    tuneCard.classList.remove("hidden");
    exportCard.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    prepStatusEl.textContent = `Lỗi: ${err instanceof Error ? err.message : String(err)}`;
  }
});

function setProgress(ratio: number) {
  progressWrap.classList.remove("hidden");
  progressBar.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
}

exportBtn.addEventListener("click", async () => {
  if (!currentFile || !cachedAudioBuffer) return;
  exportBtn.disabled = true;
  resultCard.classList.add("hidden");
  progressBar.style.width = "0%";

  try {
    exportStatusEl.textContent = "Đang áp dụng EQ…";
    const processedWav = await applyEq(cachedAudioBuffer, bands);

    exportStatusEl.textContent = "Đang ghép âm thanh vào video…";
    const outputBlob = await muxAudioIntoVideo(currentFile, processedWav, setProgress);

    exportStatusEl.textContent = "Hoàn tất!";
    if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);
    resultObjectUrl = URL.createObjectURL(outputBlob);
    resultPreview.src = resultObjectUrl;
    downloadLink.href = resultObjectUrl;
    downloadLink.download = `eq_${currentFile.name}`;
    resultCard.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    exportStatusEl.textContent = `Lỗi: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    exportBtn.disabled = false;
    progressWrap.classList.add("hidden");
  }
});

renderPresets();
renderBands();
