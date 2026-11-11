import { auth } from './auth';
import { scannerBaseUrl } from './firebaseConfig';

export type OcrBackendKind = 'gemini' | 'rapidocr' | 'hybrid';
export type SpreadMode = 'auto' | 'single' | 'double';
export type PageSide = 'single' | 'left' | 'right';
export type MarkerKind = 'L' | 'bar';
export type HighlightKind = 'L' | 'range';
export type PageAction =
  | 'skipped'
  | 'toc'
  | 'chapter-start'
  | 'highlight-L'
  | 'range-open'
  | 'range-continue'
  | 'range-close';

export type HealthResponse = {
  ok: boolean;
  ocrBackend: OcrBackendKind;
};

export type ScannedHighlightItem = {
  id: string;
  page: string | null;
  text: string;
  kind: HighlightKind;
};

export type ScannedChapterSnapshot = {
  id: string;
  name: string;
  pages: string;
  highlights: ScannedHighlightItem[];
};

export type OpenRangeState = {
  active: boolean;
  startPage: number | null;
  lastPage: number | null;
  previewText: string;
};

export type ScanSessionSnapshot = {
  sessionId: string;
  pagesScanned: number;
  pagesSkipped: number;
  currentChapter: string;
  openRange: OpenRangeState;
  warnings: string[];
  chapters: ScannedChapterSnapshot[];
};

export type DetectedMarker = {
  kind: MarkerKind;
  yNorm: number;
  xNorm: number;
  /** Normalized `[x, y, width, height]` in `0..1` relative to the cropped page side. */
  bbox: [number, number, number, number];
};

export type DetectedPageResult = {
  pageNumber: number | null;
  side: PageSide;
  action: PageAction;
  markers: DetectedMarker[];
  extractedCount: number;
};

export type FrameScanResult = {
  accepted: boolean;
  reason: string | null;
  detectedPages: DetectedPageResult[];
  snapshot: ScanSessionSnapshot;
};

const authHeaders = async (): Promise<Record<string, string>> => {
  const user = auth?.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
};

const checkResponse = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Scanner HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
};

export const checkScannerHealth = async (
  signal?: AbortSignal,
): Promise<HealthResponse> => {
  const res = await fetch(`${scannerBaseUrl}/health`, { signal });
  return checkResponse<HealthResponse>(res);
};

export const createScanSession = async (
  bookTitle?: string,
): Promise<ScanSessionSnapshot> => {
  const headers = await authHeaders();
  const res = await fetch(`${scannerBaseUrl}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(bookTitle ? { bookTitle } : {}),
  });
  return checkResponse<ScanSessionSnapshot>(res);
};

export const submitScanFrame = async ({
  sessionId,
  frame,
  spreadMode = 'auto',
  force = false,
}: {
  sessionId: string;
  frame: Blob;
  spreadMode?: SpreadMode;
  force?: boolean;
}): Promise<FrameScanResult> => {
  const headers = await authHeaders();
  const form = new FormData();
  form.append('frame', frame, 'frame.jpg');
  form.append('spreadMode', spreadMode);
  form.append('force', force ? 'true' : 'false');

  const res = await fetch(
    `${scannerBaseUrl}/sessions/${encodeURIComponent(sessionId)}/frame`,
    {
      method: 'POST',
      headers,
      body: form,
    },
  );
  return checkResponse<FrameScanResult>(res);
};

export const finishScanSession = async (
  sessionId: string,
): Promise<ScanSessionSnapshot> => {
  const headers = await authHeaders();
  const res = await fetch(
    `${scannerBaseUrl}/sessions/${encodeURIComponent(sessionId)}/finish`,
    {
      method: 'POST',
      headers,
    },
  );
  const data = await checkResponse<{ snapshot: ScanSessionSnapshot }>(res);
  return data.snapshot;
};

export const deleteScanSession = async (sessionId: string): Promise<void> => {
  const headers = await authHeaders();
  await fetch(
    `${scannerBaseUrl}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
      headers,
    },
  ).catch(() => {});
};
