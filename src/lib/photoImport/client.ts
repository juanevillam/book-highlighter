/**
 * Main-thread bridge to the on-device OCR & page analysis Web Worker.
 * Sorts selected photos in natural reading order, feeds them to the worker
 * one by one so memory stays bounded on 50+ iPhone photos, and yields live
 * progress + levelled page previews for the visual line-review UI.
 */
import { type PageAnalysis } from './analyze';
import { type WorkerRequest, type WorkerResponse } from './worker';

export type PhotoImportItem = {
  file: File;
  previewUrl: string;
  page: PageAnalysis;
};

export type PhotoImportProgress = {
  phase: 'models' | 'reading' | 'done';
  modelProgress: number;
  done: number;
  total: number;
  items: PhotoImportItem[];
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Sort uploaded files in natural filename order (e.g. IMG_2375 .. IMG_2428), falling back to timestamp. */
export function sortPhotoFiles(files: File[]): File[] {
  return [...files].sort((a, b) => {
    const byName = collator.compare(a.name, b.name);
    if (byName !== 0) return byName;
    return a.lastModified - b.lastModified;
  });
}

export async function runPhotoImport(
  rawFiles: File[],
  onProgress: (state: PhotoImportProgress) => void,
  signal?: AbortSignal,
): Promise<PhotoImportItem[]> {
  const files = sortPhotoFiles(rawFiles);
  const total = files.length;
  const items: PhotoImportItem[] = [];
  if (total === 0) {
    onProgress({ phase: 'done', modelProgress: 1, done: 0, total: 0, items });
    return items;
  }

  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  });

  let modelProgress = 0;
  const emit = (phase: PhotoImportProgress['phase']) => {
    onProgress({
      phase,
      modelProgress,
      done: items.length,
      total,
      items: [...items],
    });
  };

  try {
    emit('models');
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      const handler = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (msg.type === 'progress') {
          modelProgress = msg.total > 0 ? Math.min(1, msg.loaded / msg.total) : 0;
          emit('models');
        } else if (msg.type === 'ready') {
          modelProgress = 1;
          worker.removeEventListener('message', handler);
          signal?.removeEventListener('abort', onAbort);
          resolve();
        } else if (msg.type === 'error' && msg.id === null) {
          worker.removeEventListener('message', handler);
          signal?.removeEventListener('abort', onAbort);
          reject(new Error(msg.message));
        }
      };
      worker.addEventListener('message', handler);
      const req: WorkerRequest = { type: 'init' };
      worker.postMessage(req);
    });

    for (let i = 0; i < files.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      emit('reading');
      const file = files[i];
      const bitmap = await createImageBitmap(file);
      const res = await new Promise<{ page: PageAnalysis; preview: Blob }>(
        (resolve, reject) => {
          const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
          signal?.addEventListener('abort', onAbort, { once: true });
          const handler = (event: MessageEvent<WorkerResponse>) => {
            const msg = event.data;
            if (msg.type === 'result' && msg.id === i) {
              worker.removeEventListener('message', handler);
              signal?.removeEventListener('abort', onAbort);
              resolve({ page: msg.page, preview: msg.preview });
            } else if (msg.type === 'error' && (msg.id === i || msg.id === null)) {
              worker.removeEventListener('message', handler);
              signal?.removeEventListener('abort', onAbort);
              reject(new Error(msg.message));
            }
          };
          worker.addEventListener('message', handler);
          const req: WorkerRequest = { type: 'process', id: i, bitmap };
          worker.postMessage(req, [bitmap]);
        },
      );
      const previewUrl = URL.createObjectURL(res.preview);
      items.push({ file, previewUrl, page: res.page });
      emit('reading');
    }

    emit('done');
    return items;
  } finally {
    worker.terminate();
  }
}
