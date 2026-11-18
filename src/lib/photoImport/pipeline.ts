import { analyzePage, type PageAnalysis } from './analyze';
import {
  estimateSkew,
  rotate180,
  rotate90Ccw,
  rotate90Cw,
  rotateRgba,
} from '../ocr/deskew';
import {
  runPaddleOcr,
  type OcrLine,
  type PaddleModels,
  type Rgba,
} from '../ocr/paddle';

/** Longest side the page is analysed at (boxes, flags, overlays are in these px). */
export const PHOTO_MAX = 1600;
/** Longest side the lines are READ at — sharper crops, far fewer misreads. */
export const REC_MAX = 2800;

export type ProcessedPhoto = { page: PageAnalysis; skew: number; level: Rgba };

const orientationQuality = (lines: OcrLine[]) => {
  let validWords = 0;
  let weightedChars = 0;
  let scoreSum = 0;
  let scoredLines = 0;
  for (const line of lines) {
    const words = line.text.match(/[A-Za-zÀ-ÿ]{2,}/g);
    const wordCount = words ? words.length : 0;
    validWords += wordCount;
    const alphaLen = (line.text.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
    if (alphaLen >= 3) {
      scoreSum += line.score;
      scoredLines += 1;
      weightedChars += alphaLen * line.score;
    }
  }
  const meanScore = scoredLines > 0 ? scoreSum / scoredLines : 0;
  return {
    validWords,
    meanScore,
    totalScore: weightedChars + validWords * 2.5,
  };
};

export async function processPhoto(
  img: Rgba,
  recImg: Rgba,
  models: PaddleModels,
): Promise<ProcessedPhoto> {
  // A book page is always portrait; a landscape frame happens when the phone was held
  // flat over a table and the accelerometer latched onto landscape orientation.
  const isLandscape = img.width > img.height;
  let baseImg = isLandscape ? rotate90Cw(img) : img;
  let baseRec = isLandscape
    ? recImg === img
      ? baseImg
      : rotate90Cw(recImg)
    : recImg;

  // `runPaddleOcr` unwarps each individual line along its own curved centreline,
  // so only a heavily rotated photo (≥ 4°) needs a whole-frame rotation first.
  const est = estimateSkew(baseImg);
  let skew = Math.abs(est) >= 4 ? est : 0;
  let level = skew ? rotateRgba(baseImg, skew) : baseImg;
  let levelRec = skew
    ? baseRec === baseImg
      ? level
      : rotateRgba(baseRec, skew)
    : baseRec;
  let lines = await runPaddleOcr(level, models, levelRec);

  // `det.onnx` boxes horizontal rows of ink even when a page is 180° upside-down,
  // while `rec-latin.onnx` produces low-confidence gibberish on upside-down letters.
  // If the first pass is sparse or low-confidence, test the 180°-flipped orientation
  // (`rotate90Ccw` for landscape, `rotate180` for upside-down portrait) and keep the winner.
  const q1 = orientationQuality(lines);
  if (lines.length < 3 || q1.meanScore < 0.79 || q1.validWords < 4) {
    const altBase = isLandscape ? rotate90Ccw(img) : rotate180(img);
    const altRec =
      recImg === img
        ? altBase
        : isLandscape
          ? rotate90Ccw(recImg)
          : rotate180(recImg);
    const est2 = estimateSkew(altBase);
    const skew2 = Math.abs(est2) >= 4 ? est2 : 0;
    const level2 = skew2 ? rotateRgba(altBase, skew2) : altBase;
    const levelRec2 = skew2
      ? altRec === altBase
        ? level2
        : rotateRgba(altRec, skew2)
      : altRec;
    const lines2 = await runPaddleOcr(level2, models, levelRec2);
    const q2 = orientationQuality(lines2);
    if (q2.totalScore > q1.totalScore) {
      skew = skew2;
      level = level2;
      lines = lines2;
    }
  }
  return { page: analyzePage(level, lines), skew, level };
}
