import { estimateSkew, rotate90Ccw, rotate90Cw, rotateRgba } from '../ocr/deskew';
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
  // A book page is always portrait; a landscape frame happens when the phone was held
  // flat over a table and the accelerometer latched onto landscape orientation.
  let baseImg = img;
  let baseRec = recImg;
  if (img.width > img.height) {
    baseImg = rotate90Cw(img);
    baseRec = recImg === img ? baseImg : rotate90Cw(recImg);
  }
  // `runPaddleOcr` unwarps each individual line along its own curved centreline,
  // so only a heavily rotated photo (≥ 4°) needs a whole-frame rotation first.
  const est = estimateSkew(baseImg);
  const skew = Math.abs(est) >= 4 ? est : 0;
  let level = skew ? rotateRgba(baseImg, skew) : baseImg;
  let levelRec = skew ? (baseRec === baseImg ? level : rotateRgba(baseRec, skew)) : baseRec;
  let lines = await runPaddleOcr(level, models, levelRec);
  if (img.width > img.height && lines.length < 2) {
    baseImg = rotate90Ccw(img);
    baseRec = recImg === img ? baseImg : rotate90Ccw(recImg);
    const est2 = estimateSkew(baseImg);
    const skew2 = Math.abs(est2) >= 4 ? est2 : 0;
    level = skew2 ? rotateRgba(baseImg, skew2) : baseImg;
    levelRec = skew2 ? (baseRec === baseImg ? level : rotateRgba(baseRec, skew2)) : baseRec;
    lines = await runPaddleOcr(level, models, levelRec);
  }
  return { page: analyzePage(level, lines), skew, level };
}
