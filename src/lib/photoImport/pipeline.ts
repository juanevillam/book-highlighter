import { estimateSkew, rotateRgba } from '../ocr/deskew';
import { runPaddleOcr, type PaddleModels, type Rgba } from '../ocr/paddle';

import { analyzePage, type PageAnalysis } from './analyze';

/** Longest side the page is analysed at (boxes, flags, overlays are in these px). */
export const PHOTO_MAX = 1600;
/** Longest side the lines are READ at — sharper crops, far fewer misreads. */
export const REC_MAX = 2800;

export type ProcessedPhoto = { page: PageAnalysis; skew: number; level: Rgba };

export async function processPhoto(
  img: Rgba,
  recImg: Rgba,
  models: PaddleModels,
): Promise<ProcessedPhoto> {
  // Small tilts read fine as they are, and resampling costs sharpness; only a
  // clearly turned page (≥ 1.5°) is levelled.
  const est = estimateSkew(img);
  const skew = Math.abs(est) >= 1.5 ? est : 0;
  const level = rotateRgba(img, skew);
  const levelRec = recImg === img ? level : rotateRgba(recImg, skew);
  const lines = await runPaddleOcr(level, models, levelRec);
  return { page: analyzePage(level, lines), skew, level };
}
