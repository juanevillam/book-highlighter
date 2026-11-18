/// <reference lib="webworker" />
/**
 * The photo reader, off the main thread. Loads the two PaddleOCR models once
 * (cached by the browser afterwards), then turns each photo into a
 * `PageAnalysis` plus a levelled preview the review screen draws its line
 * boxes on. Nothing leaves the device.
 */
import * as ort from 'onnxruntime-web/wasm';

import { type PaddleModels, type Rgba } from '../ocr/paddle';

import { PHOTO_MAX, processPhoto, REC_MAX } from './pipeline';

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'process'; id: number; bitmap: ImageBitmap };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'progress'; loaded: number; total: number }
  | {
      type: 'result';
      id: number;
      page: import('./analyze').PageAnalysis;
      preview: Blob;
    }
  | { type: 'error'; id: number | null; message: string };

ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 2)
  : 1;

let models: PaddleModels | null = null;
let loading: Promise<PaddleModels> | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

const fetchBytes = async (url: string, onBytes: (n: number) => void) => {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not load ${url}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
};

const load = () => {
  loading ??= (async () => {
    const total = 4_745_517 + 8_980_573;
    let loaded = 0;
    const tick = (n: number) => {
      loaded += n;
      post({ type: 'progress', loaded, total });
    };
    const [detBytes, recBytes, dictText] = await Promise.all([
      fetchBytes('/models/det.onnx', tick),
      fetchBytes('/models/rec-latin.onnx', tick),
      fetch('/models/rec-latin.txt').then(r => r.text()),
    ]);
    const opts: ort.InferenceSession.SessionOptions = {
      executionProviders: ['wasm'],
    };
    const [det, rec] = await Promise.all([
      ort.InferenceSession.create(detBytes, opts),
      ort.InferenceSession.create(recBytes, opts),
    ]);
    models = {
      ort: ort as unknown as PaddleModels['ort'],
      det: det as unknown as PaddleModels['det'],
      rec: rec as unknown as PaddleModels['rec'],
      dict: dictText.split('\n').filter(l => l.length),
    };
    return models;
  })();
  return loading;
};

const draw = (
  bitmap: ImageBitmap,
  max: number,
): { canvas: OffscreenCanvas; img: Rgba } => {
  const s = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * s);
  const h = Math.round(bitmap.height * s);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  return { canvas, img: { data: data.data, width: w, height: h } };
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    try {
      await load();
      post({ type: 'ready' });
    } catch (error) {
      post({ type: 'error', id: null, message: String(error) });
    }
    return;
  }
  try {
    const m = models ?? (await load());
    const { img } = draw(msg.bitmap, PHOTO_MAX);
    const { img: recImg } = draw(msg.bitmap, REC_MAX);
    msg.bitmap.close();
    const { page, level } = await processPhoto(img, recImg, m);
    const out = new OffscreenCanvas(level.width, level.height);
    out
      .getContext('2d')!
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(level.data),
          level.width,
          level.height,
        ),
        0,
        0,
      );
    const preview = await out.convertToBlob({
      type: 'image/jpeg',
      quality: 0.82,
    });
    post({ type: 'result', id: msg.id, page, preview });
  } catch (error) {
    post({ type: 'error', id: msg.id, message: String(error) });
  }
};
