/**
 * Runs the on-device photo pipeline in Node over a folder of book photos and
 * prints what it found — the same TypeScript the browser worker runs.
 *
 *   npx tsx scripts/eval-photos.ts ~/Downloads/libro-1 [--ocr-only] [--dump out.json]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

import { runPaddleOcr, type PaddleModels } from '../src/lib/ocr/paddle';
import { type PageAnalysis } from '../src/lib/photoImport/analyze';
import { processPhoto, PHOTO_MAX as PM, REC_MAX as RM } from '../src/lib/photoImport/pipeline';
import { assembleBook } from '../src/lib/photoImport/assemble';

const PHOTO_MAX = PM;
const REC_MAX = RM;

const main = async () => {
  const dir = process.argv[2];
  const ocrOnly = process.argv.includes('--ocr-only');
  const dumpIdx = process.argv.indexOf('--dump');
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
  const models: PaddleModels = {
    ort: ort as unknown as PaddleModels['ort'],
    det: (await ort.InferenceSession.create('public/models/det.onnx')) as unknown as PaddleModels['det'],
    rec: (await ort.InferenceSession.create('public/models/rec-latin.onnx')) as unknown as PaddleModels['rec'],
    dict: readFileSync('public/models/rec-latin.txt', 'utf8').split('\n').filter(l => l.length),
  };

  const files = readdirSync(dir)
    .filter(f => /\.(jpe?g|png|heic)$/i.test(f))
    .filter(f => !only || only.some(o => f.includes(o)))
    .sort();
  const pages: PageAnalysis[] = [];
  for (const f of files) {
    const t0 = Date.now();
    const { data, info } = await sharp(join(dir, f))
      .rotate()
      .resize({ width: PHOTO_MAX, height: PHOTO_MAX, fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const img = { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
    const sharp2 = await sharp(join(dir, f))
      .rotate()
      .resize({ width: REC_MAX, height: REC_MAX, fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const recImg = {
      data: new Uint8ClampedArray(sharp2.data),
      width: sharp2.info.width,
      height: sharp2.info.height,
    };
    if (ocrOnly) {
      const lines = await runPaddleOcr(img, models, recImg);
      console.log(`== ${f} ${Date.now() - t0}ms ${lines.length} lines`);
      for (const l of lines) console.log(`  [${l.x1 | 0},${l.y1 | 0} ${(l.x2-l.x1)|0}x${(l.y2-l.y1)|0} ${l.score.toFixed(2)}] ${l.text}`);
      continue;
    }
    const { page, skew } = await processPhoto(img, recImg, models);
    pages.push(page);
    console.log(
      `${f} ${Date.now() - t0}ms skew=${skew} kind=${page.kind} p=${page.pageNumber ?? '-'} flags=${page.flags
        .map(fl => `${fl.side}@${fl.lineIndex}[h${fl.stats?.h.toFixed(0)} s${fl.stats?.s.toFixed(0)} v${fl.stats?.v.toFixed(0)} ht${((fl.stats?.height ?? 0) * 100).toFixed(1)}]:"${page.lines[fl.lineIndex]?.text.slice(0, 25)}"`)
        .join(' | ')}`,
    );
  }
  if (ocrOnly) return;
  if (dumpIdx > 0) writeFileSync(process.argv[dumpIdx + 1], JSON.stringify(pages));
  const book = assembleBook(pages);
  console.log('\nTITLE', book.title, '| AUTHOR', book.author);
  for (const ch of book.chapters) {
    console.log(`\n# ${ch.name} (${ch.pages})`);
    for (const h of ch.highlights) {
      console.log(`  - p.${h.page}: ${h.text.slice(0, 90)} … ${h.text.slice(-70)}`);
    }
  }
};

void main();
