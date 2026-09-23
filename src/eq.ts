import { audioBufferToWav } from "./wav";

export interface EqBand {
  freq: number;
  label: string;
  gain: number; // dB
}

export function defaultBands(): EqBand[] {
  return [
    { freq: 60, label: "60Hz", gain: 0 },
    { freq: 250, label: "250Hz", gain: 0 },
    { freq: 1000, label: "1kHz", gain: 0 },
    { freq: 4000, label: "4kHz", gain: 0 },
    { freq: 12000, label: "12kHz", gain: 0 },
  ];
}

export interface Preset {
  name: string;
  gains: number[]; // one per band, same order as defaultBands()
}

export const PRESETS: Preset[] = [
  { name: "Mặc định", gains: [0, 0, 0, 0, 0] },
  { name: "Ấm hơn", gains: [4, 3, 0, -2, -3] },
  { name: "Sáng hơn", gains: [-2, -1, 0, 3, 5] },
  { name: "Trầm mạnh", gains: [6, 3, -1, -1, -2] },
  { name: "Giọng rõ (vocal)", gains: [-2, 0, 3, 4, 1] },
];

export interface LiveFilterChain {
  filters: BiquadFilterNode[];
  input: AudioNode;
}

// Builds a persistent chain of one filter per band, wired source -> f0 -> f1 -> ... -> destination.
// Kept alive across slider moves so tweaking a gain is a cheap `.value` write, not a rebuild.
export function createLiveFilterChain(context: AudioContext, bands: EqBand[]): LiveFilterChain {
  const filters = bands.map((band) => {
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = band.freq;
    filter.Q.value = 1;
    filter.gain.value = band.gain;
    return filter;
  });

  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1]);
  }
  filters[filters.length - 1].connect(context.destination);

  return { filters, input: filters[0] };
}

export async function decodeAudioFile(file: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    await ctx.close();
  }
}

export async function applyEq(buffer: AudioBuffer, bands: EqBand[]): Promise<Blob> {
  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;

  let lastNode: AudioNode = source;
  for (const band of bands) {
    if (band.gain === 0) continue;
    const filter = offlineCtx.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = band.freq;
    filter.Q.value = 1;
    filter.gain.value = band.gain;
    lastNode.connect(filter);
    lastNode = filter;
  }
  lastNode.connect(offlineCtx.destination);

  source.start();
  const rendered = await offlineCtx.startRendering();
  return audioBufferToWav(rendered);
}
