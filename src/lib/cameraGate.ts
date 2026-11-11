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
  settleDurationMs: 520,
  cooldownMs: 650,
  captureInitialPage: true,
};

export type FrameMetrics = {
  motionScore: number;
  sharpnessScore: number;
  pagePresent: boolean;
  settleProgress: number;
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

/**
 * Verify that the central framing zone contains a flat, bright neutral paper page with
 * multiple horizontal rows of printed character transitions (rejecting faces, hands, walls, and desks).
 */
export const computePagePresence = (
  gray: Uint8Array,
  width: number,
  height: number,
  rgba?: ArrayLike<number>,
): boolean => {
  if (width < 8 || height < 8 || gray.length < width * height) return false;

  const x0 = Math.max(1, Math.floor(width * 0.14));
  const x1 = Math.min(width - 2, Math.ceil(width * 0.86));
  const y0 = Math.max(1, Math.floor(height * 0.14));
  const y1 = Math.min(height - 2, Math.ceil(height * 0.86));
  const rowWidth = Math.max(1, x1 - x0 + 1);
  const totalRows = Math.max(1, y1 - y0 + 1);

  let brightCount = 0;
  let neutralBrightCount = 0;
  let darkInkCount = 0;
  let textLikeRows = 0;
  let total = 0;
  let minVal = 255;
  let maxVal = 0;
  const hasRgba = Boolean(rgba && rgba.length >= width * height * 4);
  const minTransitionsPerRow = Math.max(4, Math.floor(rowWidth * 0.12));

  for (let y = y0; y <= y1; y += 1) {
    const row = y * width;
    let rowBright = 0;
    let rowTransitions = 0;
    for (let x = x0; x <= x1; x += 1) {
      const idx = row + x;
      const v = gray[idx];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
      if (v >= 125) {
        brightCount += 1;
        rowBright += 1;
        if (hasRgba && rgba) {
          const base = idx * 4;
          const r = rgba[base] ?? 0;
          const g = rgba[base + 1] ?? 0;
          const b = rgba[base + 2] ?? 0;
          const spread = Math.max(r, g, b) - Math.min(r, g, b);
          if (spread <= 40) {
            neutralBrightCount += 1;
          }
        }
      }
      if (v <= 95) darkInkCount += 1;
      if (x > x0 && Math.abs(v - gray[idx - 1]) >= 22) {
        rowTransitions += 1;
      }
      total += 1;
    }

    if (rowBright / rowWidth >= 0.42 && rowTransitions >= minTransitionsPerRow) {
      textLikeRows += 1;
    }
  }

  if (total === 0) return false;
  const brightRatio = brightCount / total;
  const inkRatio = darkInkCount / total;
  const contrast = maxVal - minVal;
  const textRowRatio = textLikeRows / totalRows;

  if (hasRgba) {
    const neutralPaperRatio = neutralBrightCount / total;
    if (neutralPaperRatio < 0.46) return false;
  }

  return (
    brightRatio >= 0.46 &&
    inkRatio >= 0.015 &&
    contrast >= 45 &&
    textRowRatio >= 0.16
  );
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

  /** Re-arm immediately when a frame had no highlights so continuous scanning keeps searching. */
  rearmForContinuousScan(nowMs: number = monotonicNow()) {
    this.cooldownUntilMs = Math.min(this.cooldownUntilMs, nowMs + 220);
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
    rgba?: ArrayLike<number>,
  ): GateStepResult {
    const motionScore = computeMotionScore(gray, this.prevGray);
    const sharpnessScore = computeSharpnessScore(gray, width, height);
    const pagePresent =
      computePagePresence(gray, width, height, rgba) &&
      sharpnessScore >= this.config.minSharpness * 0.75;
    const diffFromLastCapture = computeMotionScore(gray, this.lastCapturedGray);
    const hadPrev = this.prevGray !== null;
    this.prevGray = gray;

    if (this.busy) {
      return {
        motionScore,
        sharpnessScore,
        pagePresent,
        settleProgress: 1,
        phase: this.phase,
        shouldCapture: false,
      };
    }

    if (this.phase === 'cooldown') {
      if (nowMs >= this.cooldownUntilMs) {
        this.phase = 'awaiting-turn';
        this.stillSinceMs = null;
      } else if (motionScore >= this.config.motionHighThreshold) {
        this.phase = 'turning';
        this.stillSinceMs = null;
      }
      return {
        motionScore,
        sharpnessScore,
        pagePresent,
        settleProgress: 0,
        phase: this.phase,
        shouldCapture: false,
      };
    }

    if (!hadPrev) {
      if (this.phase === 'settling' && pagePresent) {
        this.stillSinceMs = nowMs;
      }
      return {
        motionScore,
        sharpnessScore,
        pagePresent,
        settleProgress: pagePresent ? 0.08 : 0,
        phase: this.phase,
        shouldCapture: false,
      };
    }

    if (this.phase === 'awaiting-turn') {
      if (motionScore >= this.config.motionHighThreshold) {
        this.phase = 'turning';
        this.stillSinceMs = null;
      } else if (
        pagePresent &&
        (!this.lastCapturedGray || diffFromLastCapture >= 5.2) &&
        motionScore <= this.config.motionLowThreshold
      ) {
        this.phase = 'settling';
        this.stillSinceMs = nowMs;
      }
      return {
        motionScore,
        sharpnessScore,
        pagePresent,
        settleProgress: 0,
        phase: this.phase,
        shouldCapture: false,
      };
    }

    if (this.phase === 'turning') {
      if (motionScore <= this.config.motionLowThreshold && pagePresent) {
        this.phase = 'settling';
        this.stillSinceMs = nowMs;
      }
      return {
        motionScore,
        sharpnessScore,
        pagePresent,
        settleProgress: 0,
        phase: this.phase,
        shouldCapture: false,
      };
    }

    // phase === 'settling'
    if (motionScore >= this.config.motionHighThreshold) {
      this.phase = 'turning';
      this.stillSinceMs = null;
      return {
        motionScore,
        sharpnessScore,
        pagePresent,
        settleProgress: 0,
        phase: this.phase,
        shouldCapture: false,
      };
    }

    if (!pagePresent || motionScore > this.config.motionLowThreshold) {
      // Slight hand drift or no page framed: reset stillness timer while remaining in settling.
      this.stillSinceMs = pagePresent ? nowMs : null;
      return {
        motionScore,
        sharpnessScore,
        pagePresent,
        settleProgress: 0,
        phase: this.phase,
        shouldCapture: false,
      };
    }

    if (this.stillSinceMs === null) {
      this.stillSinceMs = nowMs;
    }

    const heldMs = Math.max(0, nowMs - this.stillSinceMs);
    const settleProgress = Math.min(
      1,
      Math.max(0.08, heldMs / Math.max(1, this.config.settleDurationMs)),
    );

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
        pagePresent: true,
        settleProgress: 1,
        phase: this.phase,
        shouldCapture: true,
      };
    }

    return {
      motionScore,
      sharpnessScore,
      pagePresent,
      settleProgress,
      phase: this.phase,
      shouldCapture: false,
    };
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
