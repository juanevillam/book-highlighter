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
  // `runPaddleOcr` unwarps each individual line along its own curved centreline,
  // so only a heavily rotated photo (≥ 4°) needs a whole-frame rotation first.
  const est = estimateSkew(img);
  const skew = Math.abs(est) >= 4 ? est : 0;
  const level = skew ? rotateRgba(img, skew) : img;
  const levelRec = skew ? (recImg === img ? level : rotateRgba(recImg, skew)) : recImg;
  const lines = await runPaddleOcr(level, models, levelRec);
  return { page: analyzePage(level, lines), skew, level };
}
