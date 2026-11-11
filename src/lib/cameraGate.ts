/**
 * Client-side live camera frame gate (`160×120` @ ~12 fps):
 *
 * 1. Converts RGBA sample pixels to luminance (`0..255`).
 * 2. Computes `motionScore` (mean absolute pixel difference against previous frame).
 * 3. Computes `sharpnessScore` (variance of 3×3 discrete Laplacian `[0,1,0; 1,-4,1; 0,1,0]`).
 * 4. Runs a deterministic state machine that waits for:
 *    - Initial crispness on first open OR a page-turn motion (`motionScore > motionHighThreshold`)
 *    - Followed by stillness (`motionScore < motionLowThreshold`) held continuously for `settleDurationMs` (~280 ms)
 *    - AND crisp focus (`sharpnessScore >= minSharpness`)
 *    before firing a high-res (`quality: 0.86`) RAM JPEG capture!
 */

export const SAMPLE_WIDTH = 160;
export const SAMPLE_HEIGHT = 120;
export const SAMPLE_FPS = 12;
export const CAPTURE_JPEG_QUALITY = 0.86;

export type GatePhase = 'awaiting-turn' | 'turning' | 'settling' | 'cooldown';

export type CameraGateConfig = {
  motionHighThreshold: number;
  motionLowThreshold: number;
  minSharpness: number;
  settleDurationMs: number;
  cooldownMs: number;
  /** Allow the first steady focused page right after opening camera to capture without a prior turn. */
  captureInitialPage: boolean;
};

export const DEFAULT_GATE_CONFIG: CameraGateConfig = {
  motionHighThreshold: 8.5,
  motionLowThreshold: 6.2,
  minSharpness: 12,
  settleDurationMs: 260,
  cooldownMs: 750,
  captureInitialPage: true,
};

export type FrameMetrics = {
  motionScore: number;
  sharpnessScore: number;
};

export type GateStepResult = FrameMetrics & {
  phase: GatePhase;
  shouldCapture: boolean;
};

/** Convert RGBA Uint8ClampedArray (`length = width * height * 4`) to grayscale luminance (`0..255`). */
export const rgbaToGrayscale = (
  rgba: ArrayLike<number>,
  pixelCount: number,
): Uint8Array => {
  const gray = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const base = i * 4;
    // BT.601 luma integer approximation
    gray[i] =
      (77 * (rgba[base] ?? 0) +
        150 * (rgba[base + 1] ?? 0) +
        29 * (rgba[base + 2] ?? 0)) >>
      8;
  }
  return gray;
};

/** Mean absolute luminance difference between two equal-sized grayscale buffers. */
export const computeMotionScore = (
  current: Uint8Array,
  previous: Uint8Array | null,
): number => {
  if (!previous || previous.length !== current.length || current.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < current.length; i += 1) {
    sum += Math.abs(current[i] - previous[i]);
  }
  return sum / current.length;
};

/** Variance of the 3×3 Laplacian operator over interior pixels of a `width × height` grayscale frame. */
export const computeSharpnessScore = (
  gray: Uint8Array,
  width: number,
  height: number,
): number => {
  if (width < 3 || height < 3 || gray.length < width * height) return 0;

  let count = 0;
  let sum = 0;
  let sumSq = 0;

  // Exclude outer 6% border so camera vignette doesn't skew focus measurement.
  const x0 = Math.max(1, Math.floor(width * 0.06));
  const x1 = Math.min(width - 2, Math.ceil(width * 0.94));
  const y0 = Math.max(1, Math.floor(height * 0.06));
  const y1 = Math.min(height - 2, Math.ceil(height * 0.94));

  for (let y = y0; y <= y1; y += 1) {
    const row = y * width;
    for (let x = x0; x <= x1; x += 1) {
      const idx = row + x;
      const lap =
        gray[idx - width] +
        gray[idx + width] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];
      count += 1;
      sum += lap;
      sumSq += lap * lap;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
};

const monotonicNow = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export class CameraGateStateMachine {
  private readonly config: CameraGateConfig;
  private prevGray: Uint8Array | null = null;
  private lastCapturedGray: Uint8Array | null = null;
  private phase: GatePhase;
  private stillSinceMs: number | null = null;
  private cooldownUntilMs = 0;
  private busy = false;

  constructor(config: Partial<CameraGateConfig> = {}) {
    this.config = { ...DEFAULT_GATE_CONFIG, ...config };
    this.phase = this.config.captureInitialPage ? 'settling' : 'awaiting-turn';
  }

  get currentPhase(): GatePhase {
    return this.phase;
  }

  setBusy(busy: boolean, nowMs: number = monotonicNow()) {
    this.busy = busy;
    if (!busy && this.phase === 'cooldown') {
      this.cooldownUntilMs = Math.max(
        this.cooldownUntilMs,
        nowMs + this.config.cooldownMs,
      );
    }
  }

  /** Reset after manual capture so the gate waits for the next page turn. */
  notifyManualCapture(nowMs: number = monotonicNow()) {
    this.phase = 'cooldown';
    this.stillSinceMs = null;
    this.cooldownUntilMs = nowMs + this.config.cooldownMs;
  }

  stepGrayscale(
    gray: Uint8Array,
    width: number,
    height: number,
    nowMs: number = monotonicNow(),
  ): GateStepResult {
    const motionScore = computeMotionScore(gray, this.prevGray);
    const sharpnessScore = computeSharpnessScore(gray, width, height);
    const diffFromLastCapture = computeMotionScore(gray, this.lastCapturedGray);
    const hadPrev = this.prevGray !== null;
    this.prevGray = gray;

    if (this.busy) {
      return { motionScore, sharpnessScore, phase: this.phase, shouldCapture: false };
    }

    if (this.phase === 'cooldown') {
      if (nowMs >= this.cooldownUntilMs) {
        this.phase = 'awaiting-turn';
        this.stillSinceMs = null;
      } else if (motionScore >= this.config.motionHighThreshold) {
        this.phase = 'turning';
        this.stillSinceMs = null;
      }
      return { motionScore, sharpnessScore, phase: this.phase, shouldCapture: false };
    }

    if (!hadPrev) {
      if (this.phase === 'settling') {
        this.stillSinceMs = nowMs;
      }
      return { motionScore, sharpnessScore, phase: this.phase, shouldCapture: false };
    }

    if (this.phase === 'awaiting-turn') {
      if (motionScore >= this.config.motionHighThreshold) {
        this.phase = 'turning';
        this.stillSinceMs = null;
      } else if (
        this.lastCapturedGray &&
        diffFromLastCapture >= 8.5 &&
        motionScore <= this.config.motionLowThreshold
      ) {
        this.phase = 'settling';
        this.stillSinceMs = nowMs;
      }
      return { motionScore, sharpnessScore, phase: this.phase, shouldCapture: false };
    }

    if (this.phase === 'turning') {
      if (motionScore <= this.config.motionLowThreshold) {
        this.phase = 'settling';
        this.stillSinceMs = nowMs;
      }
      return { motionScore, sharpnessScore, phase: this.phase, shouldCapture: false };
    }

    // phase === 'settling'
    if (motionScore >= this.config.motionHighThreshold) {
      this.phase = 'turning';
      this.stillSinceMs = null;
      return { motionScore, sharpnessScore, phase: this.phase, shouldCapture: false };
    }

    if (motionScore > this.config.motionLowThreshold) {
      // Slight hand drift: reset stillness timer while remaining in settling.
      this.stillSinceMs = nowMs;
      return { motionScore, sharpnessScore, phase: this.phase, shouldCapture: false };
    }

    if (this.stillSinceMs === null) {
      this.stillSinceMs = nowMs;
    }

    const heldMs = nowMs - this.stillSinceMs;
    if (
      heldMs >= this.config.settleDurationMs &&
      sharpnessScore >= this.config.minSharpness
    ) {
      this.phase = 'cooldown';
      this.stillSinceMs = null;
      this.cooldownUntilMs = nowMs + this.config.cooldownMs;
      this.lastCapturedGray = gray;
      return {
        motionScore,
        sharpnessScore,
        phase: this.phase,
        shouldCapture: true,
      };
    }

    return { motionScore, sharpnessScore, phase: this.phase, shouldCapture: false };
  }
}

/** Capture one full-resolution JPEG blob (`quality: 0.86`) directly in RAM from a `<video>`. */
export const captureVideoJpegBlob = async (
  video: HTMLVideoElement,
  quality: number = CAPTURE_JPEG_QUALITY,
): Promise<{ blob: Blob; width: number; height: number } | null> => {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(b => resolve(b), 'image/jpeg', quality),
  );
  if (!blob) return null;

  return { blob, width, height };
};
