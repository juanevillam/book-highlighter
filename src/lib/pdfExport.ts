import { jsPDF } from 'jspdf';

import { type Book, type BookBody } from '../books';
import { formatYear } from './bookFields';
import { genreLabel } from './genres';
import { parseHighlightSegments } from './paginator';
import {
  COVER_FETCH_WIDTH,
  readerSections,
  type ReaderSection,
} from './readerSections';
import {
  PDF_FORMATS,
  type PdfFormatId,
  type ReaderPalette,
} from './readerThemes';
import { thumbUrl } from './thumbUrl';

export { PDF_FORMAT_IDS, PDF_FORMATS, type PdfFormatId } from './readerThemes';

const BLEED = 8;
const MARGIN_SIDE = 48;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 64;

const CJK_RE = /[\u3000-\u9fff\uff00-\uffef]/;

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map(ch => ch + ch)
          .join('')
      : clean;
  const num = Number.parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
};

const safePdfFileName = (rawTitle: string, used: Set<string>): string => {
  const base =
    rawTitle
      .replace(/[/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'Book';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return `${candidate}.pdf`;
};

const normalizeWinAnsi = (text: string): string =>
  text.replace(/\u202f|\u00a0/g, ' ').replace(/[\u2010\u2011\u2012]/g, '-');

type LoadedCover = {
  dataUrl: string;
  format: 'JPEG' | 'PNG';
  width: number;
  height: number;
};

const loadCoverDataUrl = async (url: string): Promise<LoadedCover | null> => {
  if (!url || typeof document === 'undefined') return null;
  try {
    const sized = thumbUrl(url, COVER_FETCH_WIDTH);
    const response = await fetch(sized, { mode: 'cors' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return {
      dataUrl,
      format: 'JPEG',
      width: bitmap.width,
      height: bitmap.height,
    };
  } catch {
    return null;
  }
};

/**
 * Render a single line containing CJK glyphs via high-DPI Canvas so Chinese
 * text never garbles under built-in PDF WinAnsi fonts, while all Latin/Spanish/English
 * text uses native selectable & searchable PDF vector glyphs.
 */
const drawCjkLineAsImage = (
  doc: jsPDF,
  line: string,
  x: number,
  baselineY: number,
  fontSizePt: number,
  colorHex: string,
  bold: boolean,
  align: 'left' | 'center' | 'right',
) => {
  if (typeof document === 'undefined') return;
  const dpr = 3;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const fontSpec = `${bold ? '700' : '400'} ${fontSizePt * dpr}px system-ui, -apple-system, sans-serif`;
  ctx.font = fontSpec;
  const widthPx = Math.ceil(ctx.measureText(line).width) + 8 * dpr;
  const heightPx = Math.ceil(fontSizePt * 1.45 * dpr);
  canvas.width = Math.max(16, widthPx);
  canvas.height = Math.max(16, heightPx);

  ctx.font = fontSpec;
  ctx.fillStyle = colorHex;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(line, 2 * dpr, fontSizePt * 1.05 * dpr);

  const wPt = canvas.width / dpr;
  const hPt = canvas.height / dpr;
  let drawX = x;
  if (align === 'center') drawX = x - wPt / 2;
  else if (align === 'right') drawX = x - wPt;

  doc.addImage(
    canvas.toDataURL('image/png'),
    'PNG',
    drawX,
    baselineY - fontSizePt * 1.05,
    wPt,
    hPt,
  );
};

const drawTextLine = (
  doc: jsPDF,
  rawLine: string,
  x: number,
  y: number,
  options: {
    font: 'times' | 'helvetica';
    style: 'normal' | 'bold' | 'italic';
    size: number;
    rgb: [number, number, number];
    hex: string;
    align?: 'left' | 'center' | 'right';
  },
) => {
  const line = normalizeWinAnsi(rawLine);
  const align = options.align ?? 'left';

  if (CJK_RE.test(line)) {
    drawCjkLineAsImage(
      doc,
      line,
      x,
      y,
      options.size,
      options.hex,
      options.style === 'bold',
      align,
    );
    return;
  }

  doc.setFont(options.font, options.style);
  doc.setFontSize(options.size);
  doc.setTextColor(options.rgb[0], options.rgb[1], options.rgb[2]);
  doc.text(line, x, y, { align });
};

const splitPdfLines = (
  doc: jsPDF,
  text: string,
  maxWidth: number,
  font: 'times' | 'helvetica',
  style: 'normal' | 'bold' | 'italic',
  size: number,
): string[] => {
  const clean = normalizeWinAnsi(text.trim());
  if (!clean) return [];
  if (CJK_RE.test(clean)) {
    const approxChars = Math.max(8, Math.floor(maxWidth / (size * 1.02)));
    const chunks: string[] = [];
    let current = '';
    for (const ch of clean) {
      current += ch;
      if (current.length >= approxChars) {
        chunks.push(current);
        current = '';
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  doc.setFont(font, style);
  doc.setFontSize(size);
  return doc.splitTextToSize(clean, maxWidth) as string[];
};

export type PdfStrings = {
  by: (author: string) => string;
  page: (page: string | number) => string;
  pageOf: (page: number, total: number) => string;
  summary: string;
  untitledChapter: string;
  contents?: string;
  translate: (key: string) => string;
  bcYear: (year: number) => string;
};

export type GeneratedPdfFile = {
  fileName: string;
  blob: Blob;
};

const drawPdfOrnament = (
  doc: jsPDF,
  cx: number,
  cy: number,
  rgb1: [number, number, number],
  rgb2: [number, number, number],
) => {
  doc.setDrawColor(rgb1[0], rgb1[1], rgb1[2]);
  doc.setLineWidth(0.75);
  doc.line(cx - 42, cy, cx - 14, cy);
  doc.line(cx + 14, cy, cx + 42, cy);
  doc.setFillColor(rgb1[0], rgb1[1], rgb1[2]);
  doc.circle(cx, cy, 2.2, 'F');
  doc.setFillColor(rgb2[0], rgb2[1], rgb2[2]);
  doc.circle(cx - 8, cy, 1.2, 'F');
  doc.circle(cx + 8, cy, 1.2, 'F');
};

const buildSingleBookPdf = async (
  book: Book,
  body: BookBody,
  palette: ReaderPalette,
  fontScale: number,
  strings: PdfStrings,
  usedNames: Set<string>,
  format: PdfFormatId = 'a5',
): Promise<GeneratedPdfFile> => {
  const { widthPt: PAGE_W, heightPt: PAGE_H } = PDF_FORMATS[format];
  const FOOTER_Y = PAGE_H - 30;
  const CONTENT_W = PAGE_W - MARGIN_SIDE * 2;
  const CONTENT_BOTTOM = PAGE_H - MARGIN_BOTTOM;

  const coverAsset = book.artUrl ? await loadCoverDataUrl(book.artUrl) : null;

  const sections: ReaderSection[] = readerSections(
    book,
    body,
    {
      by: strings.by,
      page: strings.page,
      summary: strings.summary,
      untitledChapter: strings.untitledChapter,
      contents: strings.contents,
      genre: g => genreLabel(strings.translate, g),
      year: y => formatYear(y, strings.bcYear),
    },
    coverAsset ? book.artUrl : null,
  );

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: [PAGE_W, PAGE_H],
    compress: true,
  });

  doc.setProperties({
    title: book.name,
    author: book.author || 'Book Highlighter',
    creator: 'Book Highlighter',
  });

  const pageRgb = hexToRgb(palette.page);
  const textRgb = hexToRgb(palette.text);
  const mutedRgb = hexToRgb(palette.muted);
  const accentRgb = palette.accent ? hexToRgb(palette.accent) : mutedRgb;
  const accent2Rgb = palette.accentSecondary
    ? hexToRgb(palette.accentSecondary)
    : accentRgb;

  const paintPageGround = () => {
    doc.setFillColor(pageRgb[0], pageRgb[1], pageRgb[2]);
    doc.rect(-BLEED, -BLEED, PAGE_W + BLEED * 2, PAGE_H + BLEED * 2, 'F');
    if (palette.ornament) {
      doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.setLineWidth(0.5);
      doc.rect(18, 18, PAGE_W - 36, PAGE_H - 36, 'S');
    }
  };

  let firstPageUsed = false;
  const footedPageNumbers: number[] = [];

  const startFreshPage = (withFooter: boolean): number => {
    if (!firstPageUsed) {
      firstPageUsed = true;
    } else {
      doc.addPage([PAGE_W, PAGE_H], 'portrait');
    }
    paintPageGround();
    const pageNumber = doc.getNumberOfPages();
    if (withFooter) footedPageNumbers.push(pageNumber);
    return pageNumber;
  };

  for (const section of sections) {
    if (section.kind === 'cover' && coverAsset) {
      startFreshPage(false);
      const maxW = PAGE_W - MARGIN_SIDE * 2;
      const maxH = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;
      const ratio = Math.min(
        maxW / Math.max(1, coverAsset.width),
        maxH / Math.max(1, coverAsset.height),
      );
      const drawW = coverAsset.width * ratio;
      const drawH = coverAsset.height * ratio;
      const x = (PAGE_W - drawW) / 2;
      const y = (PAGE_H - drawH) / 2;
      doc.addImage(coverAsset.dataUrl, coverAsset.format, x, y, drawW, drawH);
      continue;
    }

    if (section.kind === 'title') {
      const pageNum = startFreshPage(false);
      const titleSize = Math.round(28 * fontScale * 10) / 10;
      const authorSize = Math.round(16 * fontScale * 10) / 10;
      const metaSize = 11;

      const titleLines = splitPdfLines(
        doc,
        section.heading ?? book.name,
        CONTENT_W - 16,
        'times',
        'bold',
        titleSize,
      );
      const authorLines = section.subheading
        ? splitPdfLines(
            doc,
            section.subheading,
            CONTENT_W - 24,
            'times',
            'normal',
            authorSize,
          )
        : [];
      const metaLines = section.paragraphs?.[0]
        ? splitPdfLines(
            doc,
            section.paragraphs[0],
            CONTENT_W - 24,
            'helvetica',
            'normal',
            metaSize,
          )
        : [];

      if (doc.outline && section.heading) {
        doc.outline.add(null, section.heading, { pageNumber: pageNum });
      }

      const coverMaxH = coverAsset ? Math.min(200, PAGE_H * 0.32) : 0;
      const coverMaxW = coverAsset ? Math.min(136, CONTENT_W * 0.45) : 0;
      const coverRatio = coverAsset
        ? Math.min(
            coverMaxW / Math.max(1, coverAsset.width),
            coverMaxH / Math.max(1, coverAsset.height),
          )
        : 0;
      const coverDrawW = coverAsset ? coverAsset.width * coverRatio : 0;
      const coverDrawH = coverAsset ? coverAsset.height * coverRatio : 0;

      const titleStep = titleSize * 1.24;
      const authorStep = authorSize * 1.35;
      const metaStep = metaSize * 1.4;
      const blockH =
        (coverDrawH > 0 ? coverDrawH + 22 : 0) +
        titleLines.length * titleStep +
        (authorLines.length > 0 ? 14 + authorLines.length * authorStep : 0) +
        (palette.ornament ? 22 : 0) +
        (metaLines.length > 0 ? 16 + metaLines.length * metaStep : 0);

      let cursorY = Math.max(MARGIN_TOP, (PAGE_H - blockH) * 0.44);
      if (coverAsset && coverDrawH > 0) {
        doc.addImage(
          coverAsset.dataUrl,
          coverAsset.format,
          (PAGE_W - coverDrawW) / 2,
          cursorY,
          coverDrawW,
          coverDrawH,
        );
        cursorY += coverDrawH + 22 + titleSize * 0.8;
      } else {
        cursorY += titleSize;
      }

      for (const line of titleLines) {
        drawTextLine(doc, line, PAGE_W / 2, cursorY, {
          font: 'times',
          style: 'bold',
          size: titleSize,
          rgb: textRgb,
          hex: palette.text,
          align: 'center',
        });
        cursorY += titleStep;
      }

      if (authorLines.length > 0) {
        cursorY += 10;
        for (const line of authorLines) {
          drawTextLine(doc, line, PAGE_W / 2, cursorY, {
            font: 'times',
            style: 'normal',
            size: authorSize,
            rgb: mutedRgb,
            hex: palette.muted,
            align: 'center',
          });
          cursorY += authorStep;
        }
      }

      if (palette.ornament) {
        cursorY += 6;
        drawPdfOrnament(doc, PAGE_W / 2, cursorY, accentRgb, accent2Rgb);
        cursorY += 16;
      }

      if (metaLines.length > 0) {
        cursorY += 8;
        for (const line of metaLines) {
          drawTextLine(doc, line, PAGE_W / 2, cursorY, {
            font: 'helvetica',
            style: 'normal',
            size: metaSize,
            rgb: mutedRgb,
            hex: palette.muted,
            align: 'center',
          });
          cursorY += metaStep;
        }
      }
      continue;
    }

    if (section.kind === 'bookIndex' && section.indexEntries) {
      const startPage = startFreshPage(true);
      if (doc.outline && section.heading) {
        doc.outline.add(null, section.heading, { pageNumber: startPage });
      }
      const headingSize = Math.round(20 * fontScale * 10) / 10;
      const rowSize = Math.round(12 * fontScale * 10) / 10;
      const rowStep = rowSize * 1.85;
      let cursorY = MARGIN_TOP;

      if (palette.ornament) {
        drawPdfOrnament(doc, PAGE_W / 2, cursorY, accentRgb, accent2Rgb);
        cursorY += 20;
      }
      cursorY += headingSize;
      drawTextLine(doc, section.heading ?? 'Contents', PAGE_W / 2, cursorY, {
        font: 'times',
        style: 'bold',
        size: headingSize,
        rgb: textRgb,
        hex: palette.text,
        align: 'center',
      });
      cursorY += headingSize * 1.4;

      for (const entry of section.indexEntries) {
        if (cursorY + rowStep > CONTENT_BOTTOM) {
          startFreshPage(true);
          cursorY = MARGIN_TOP + rowSize;
        }
        drawTextLine(doc, entry.title, MARGIN_SIDE, cursorY, {
          font: 'times',
          style: 'normal',
          size: rowSize,
          rgb: textRgb,
          hex: palette.text,
        });
        if (entry.pages) {
          drawTextLine(doc, entry.pages, PAGE_W - MARGIN_SIDE, cursorY, {
            font: 'helvetica',
            style: 'normal',
            size: 10,
            rgb: mutedRgb,
            hex: palette.muted,
            align: 'right',
          });
        }
        cursorY += rowStep;
      }
      continue;
    }

    // Prose (Summary) or Highlights (Chapter)
    const startPage = startFreshPage(true);
    if (doc.outline && section.heading) {
      doc.outline.add(null, section.heading, { pageNumber: startPage });
    }

    const headingSize = Math.round(20 * fontScale * 10) / 10;
    const bodySize = Math.round(12.5 * fontScale * 10) / 10;
    const metaSize = 9.5;
    const headingStep = headingSize * 1.26;
    const bodyStep = bodySize * 1.52;
    const metaStep = metaSize * 1.4;

    let cursorY = MARGIN_TOP;
    if (palette.ornament) {
      drawPdfOrnament(doc, PAGE_W / 2, cursorY, accentRgb, accent2Rgb);
      cursorY += 18;
    }
    cursorY += headingSize;

    const ensureSpace = (neededPt: number) => {
      if (cursorY + neededPt > CONTENT_BOTTOM) {
        startFreshPage(true);
        cursorY = MARGIN_TOP + bodySize;
      }
    };

    if (section.heading) {
      const hLines = splitPdfLines(
        doc,
        section.heading,
        CONTENT_W,
        'times',
        'bold',
        headingSize,
      );
      for (const line of hLines) {
        ensureSpace(headingStep);
        drawTextLine(doc, line, MARGIN_SIDE, cursorY, {
          font: 'times',
          style: 'bold',
          size: headingSize,
          rgb: textRgb,
          hex: palette.text,
        });
        cursorY += headingStep;
      }
    }

    if (section.subheading) {
      cursorY += 2;
      const subLines = splitPdfLines(
        doc,
        section.subheading,
        CONTENT_W,
        'helvetica',
        'normal',
        metaSize,
      );
      for (const line of subLines) {
        ensureSpace(metaStep);
        drawTextLine(doc, line, MARGIN_SIDE, cursorY, {
          font: 'helvetica',
          style: 'normal',
          size: metaSize,
          rgb: mutedRgb,
          hex: palette.muted,
        });
        cursorY += metaStep;
      }
    }

    cursorY += 12 * fontScale;

    if (section.kind === 'prose' && section.paragraphs) {
      for (const para of section.paragraphs) {
        const lines = splitPdfLines(
          doc,
          para,
          CONTENT_W,
          'times',
          'normal',
          bodySize,
        );
        for (const line of lines) {
          ensureSpace(bodyStep);
          drawTextLine(doc, line, MARGIN_SIDE, cursorY, {
            font: 'times',
            style: 'normal',
            size: bodySize,
            rgb: textRgb,
            hex: palette.text,
          });
          cursorY += bodyStep;
        }
        cursorY += 10 * fontScale;
      }
    }

    if (section.kind === 'highlights' && section.highlights) {
      for (const hl of section.highlights) {
        const segments = parseHighlightSegments(hl.text);
        for (let segIdx = 0; segIdx < segments.length; segIdx++) {
          const seg = segments[segIdx];
          if (segIdx > 0) {
            cursorY += seg.tightWithPrev ? 2 * fontScale : 7 * fontScale;
          }
          const pdfStyle = seg.italic ? 'italic' : 'normal';
          const lines = splitPdfLines(
            doc,
            seg.text,
            CONTENT_W,
            'times',
            pdfStyle,
            bodySize,
          );
          for (const line of lines) {
            ensureSpace(bodyStep);
            const drawX =
              seg.align === 'right' ? PAGE_W - MARGIN_SIDE : MARGIN_SIDE;
            drawTextLine(doc, line, drawX, cursorY, {
              font: 'times',
              style: pdfStyle,
              size: bodySize,
              rgb: textRgb,
              hex: palette.text,
              align: seg.align,
            });
            cursorY += bodyStep;
          }
        }

        if (hl.page) {
          ensureSpace(metaStep);
          drawTextLine(doc, hl.page, PAGE_W - MARGIN_SIDE, cursorY + 2, {
            font: 'helvetica',
            style: 'normal',
            size: metaSize,
            rgb: mutedRgb,
            hex: palette.muted,
            align: 'right',
          });
          cursorY += metaStep;
        }

        cursorY += 12 * fontScale;
      }
    }
  }

  // Stamp "{page} of {total}" footers across all content pages.
  const totalPages = doc.getNumberOfPages();
  for (const pNum of footedPageNumbers) {
    doc.setPage(pNum);
    drawTextLine(doc, strings.pageOf(pNum, totalPages), PAGE_W / 2, FOOTER_Y, {
      font: 'helvetica',
      style: 'normal',
      size: 9,
      rgb: mutedRgb,
      hex: palette.muted,
      align: 'center',
    });
  }

  const blob = doc.output('blob');
  return {
    fileName: safePdfFileName(book.name, usedNames),
    blob,
  };
};

export const generateBookPdfs = async (
  items: Array<{ book: Book; body: BookBody; palette?: ReaderPalette }>,
  palette: ReaderPalette,
  fontScale: number,
  strings: PdfStrings,
  format: PdfFormatId = 'a5',
): Promise<GeneratedPdfFile[]> => {
  const usedNames = new Set<string>();
  const results: GeneratedPdfFile[] = [];

  for (const { book, body, palette: bookPalette } of items) {
    results.push(
      await buildSingleBookPdf(
        book,
        body,
        bookPalette ?? palette,
        fontScale,
        strings,
        usedNames,
        format,
      ),
    );
  }

  return results;
};

export const shareOrDownloadPdfs = async (
  files: GeneratedPdfFile[],
): Promise<boolean> => {
  if (files.length === 0) return false;

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      const shareFiles = files.map(
        f => new File([f.blob], f.fileName, { type: 'application/pdf' }),
      );
      if (navigator.canShare({ files: shareFiles })) {
        await navigator.share({ files: shareFiles });
        return true;
      }
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        return false;
      }
      // Fall through to browser download.
    }
  }

  for (const file of files) {
    const url = URL.createObjectURL(file.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }

  return true;
};
