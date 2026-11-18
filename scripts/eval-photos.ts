/**
 * Runs the on-device photo pipeline in Node over a folder of book photos and
 * prints what it found — the same TypeScript the browser worker runs.
 *
 *   npx tsx scripts/eval-photos.ts ~/Downloads/libro-1 [--ocr-only] [--dump out.json]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

import { estimateSkew, rotate90Cw, rotateRgba } from '../src/lib/ocr/deskew';
import {
  runPaddleOcr,
  type OcrLine,
  type PaddleModels,
} from '../src/lib/ocr/paddle';
import { analyzePage, type PageAnalysis } from '../src/lib/photoImport/analyze';
import {
  PHOTO_MAX as PM,
  REC_MAX as RM,
} from '../src/lib/photoImport/pipeline';
import { assembleBook } from '../src/lib/photoImport/assemble';

const PHOTO_MAX = PM;
const REC_MAX = RM;

type CachedOcr = { file: string; skew: number; lines: OcrLine[] };

const main = async () => {
  const dir = process.argv[2];
  const ocrOnly = process.argv.includes('--ocr-only');
  const dumpIdx = process.argv.indexOf('--dump');
  const cacheIdx = process.argv.indexOf('--ocr-cache');
  const cachePath = cacheIdx > 0 ? process.argv[cacheIdx + 1] : null;
  const only = process.argv
    .find(a => a.startsWith('--only='))
    ?.slice(7)
    .split(',');

  const cachedMap = new Map<string, CachedOcr>();
  if (cachePath && existsSync(cachePath)) {
    const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as CachedOcr[];
    for (const item of raw) cachedMap.set(item.file, item);
  }

  let models: PaddleModels | null = null;
  const ensureModels = async (): Promise<PaddleModels> => {
    if (models) return models;
    models = {
      ort: ort as unknown as PaddleModels['ort'],
      det: (await ort.InferenceSession.create(
        'public/models/det.onnx',
      )) as unknown as PaddleModels['det'],
      rec: (await ort.InferenceSession.create(
        'public/models/rec-latin.onnx',
      )) as unknown as PaddleModels['rec'],
      dict: readFileSync('public/models/rec-latin.txt', 'utf8')
        .split('\n')
        .filter(l => l.length),
    };
    return models;
  };

  const files = readdirSync(dir)
    .filter(f => /\.(jpe?g|png|heic)$/i.test(f))
    .filter(f => !only || only.some(o => f.includes(o)))
    .sort();
  const pages: PageAnalysis[] = [];
  const outCache: CachedOcr[] = [];
  let cacheDirty = false;

  for (const f of files) {
    const t0 = Date.now();
    const { data, info } = await sharp(join(dir, f))
      .rotate()
      .resize({ width: PHOTO_MAX, height: PHOTO_MAX, fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rawImg = {
      data: new Uint8ClampedArray(data),
      width: info.width,
      height: info.height,
    };
    const img = rawImg.width > rawImg.height ? rotate90Cw(rawImg) : rawImg;

    const hit = cachedMap.get(f);
    let skew: number;
    let lines: OcrLine[];
    let level = img;

    if (hit && hit.lines.length > 0 && !ocrOnly) {
      skew = hit.skew;
      lines = hit.lines;
      level = skew ? rotateRgba(img, skew) : img;
      outCache.push(hit);
    } else {
      const m = await ensureModels();
      const sharp2 = await sharp(join(dir, f))
        .rotate()
        .resize({ width: REC_MAX, height: REC_MAX, fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const rawRec = {
        data: new Uint8ClampedArray(sharp2.data),
        width: sharp2.info.width,
        height: sharp2.info.height,
      };
      const recImg = rawRec.width > rawRec.height ? rotate90Cw(rawRec) : rawRec;
      if (ocrOnly) {
        const ocrLines = await runPaddleOcr(img, m, recImg);
        console.log(`== ${f} ${Date.now() - t0}ms ${ocrLines.length} lines`);
        for (const l of ocrLines)
          console.log(
            `  [${l.x1 | 0},${l.y1 | 0} ${(l.x2 - l.x1) | 0}x${(l.y2 - l.y1) | 0} ${l.score.toFixed(2)}] ${l.text}`,
          );
        continue;
      }
      const est = estimateSkew(img);
      skew = Math.abs(est) >= 4 ? est : 0;
      level = skew ? rotateRgba(img, skew) : img;
      const levelRec = skew
        ? recImg === img
          ? level
          : rotateRgba(recImg, skew)
        : recImg;
      lines = await runPaddleOcr(level, m, levelRec);
      outCache.push({ file: f, skew, lines });
      cacheDirty = true;
    }

    const page = analyzePage(level, lines);
    pages.push(page);
    console.log(
      `${f} ${Date.now() - t0}ms skew=${skew} kind=${page.kind} p=${page.pageNumber ?? '-'} flags=${page.flags
        .map(
          fl =>
            `${fl.side}(${fl.shape ?? 'bar'})@${fl.lineIndex}${fl.endLineIndex !== undefined && fl.endLineIndex !== fl.lineIndex ? `..${fl.endLineIndex}` : ''}[h${fl.stats?.h.toFixed(0)} s${fl.stats?.s.toFixed(0)} v${fl.stats?.v.toFixed(0)} ht${((fl.stats?.height ?? 0) * 100).toFixed(1)}]:"${page.lines[fl.lineIndex]?.text.slice(0, 25)}"`,
        )
        .join(' | ')}`,
    );
  }
  if (ocrOnly) return;
  if (cachePath && cacheDirty && !only)
    writeFileSync(cachePath, JSON.stringify(outCache));
  if (dumpIdx > 0)
    writeFileSync(process.argv[dumpIdx + 1], JSON.stringify(pages));
  const book = assembleBook(pages);
  console.log('\nTITLE', book.title, '| AUTHOR', book.author);
  for (const ch of book.chapters) {
    console.log(`\n# ${ch.name} (${ch.pages})`);
    for (const h of ch.highlights) {
      console.log(
        `  - p.${h.page}: ${h.text.slice(0, 90)} … ${h.text.slice(-70)}`,
      );
    }
  }
};

void main();
