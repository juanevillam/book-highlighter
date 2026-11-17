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
  phase: 'queued' | 'models' | 'reading' | 'done';
  modelProgress: number;
  done: number;
  total: number;
  /** Unified 0..100 percentage across model init and page reading. */
  percent: number;
  items: PhotoImportItem[];
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Sort uploaded files in natural filename order (e.g. IMG_2459 .. IMG_2475), falling back to timestamp. */
export function sortPhotoFiles(files: File[]): File[] {
  return [...files].sort((a, b) => {
    const byName = collator.compare(a.name, b.name);
    if (byName !== 0) return byName;
    return a.lastModified - b.lastModified;
  });
}

let sharedWorker: Worker | null = null;
let workerReady = false;
let jobQueue: Promise<unknown> = Promise.resolve();
let nextReqId = 1;

const getWorker = (): Worker => {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    workerReady = false;
  }
  return sharedWorker;
};

const resetWorker = () => {
  if (sharedWorker) {
    sharedWorker.terminate();
    sharedWorker = null;
    workerReady = false;
  }
};

export function runPhotoImport(
  rawFiles: File[],
  onProgress: (state: PhotoImportProgress) => void,
  signal?: AbortSignal,
): Promise<PhotoImportItem[]> {
  const files = sortPhotoFiles(rawFiles);
  const total = files.length;
  const items: PhotoImportItem[] = [];
  if (total === 0) {
    onProgress({
      phase: 'done',
      modelProgress: 1,
      done: 0,
      total: 0,
      percent: 100,
      items,
    });
    return Promise.resolve(items);
  }

  const hadModels = workerReady;
  let modelProgress = workerReady ? 1 : 0;
  let activePageFrac = 0;

  const computePercent = (phase: PhotoImportProgress['phase']): number => {
    if (phase === 'done') return 100;
    if (phase === 'queued') return 0;
    const modelWeight = hadModels ? 0 : 0.14;
    const pageWeight = 1 - modelWeight;
    if (phase === 'models') {
      return Math.max(0, Math.min(14, Math.round(modelProgress * 14)));
    }
    const pageProgress =
      total > 0 ? Math.min(1, (items.length + activePageFrac) / total) : 0;
    const raw = (modelWeight + pageWeight * pageProgress) * 100;
    return Math.max(0, Math.min(98, Math.round(raw)));
  };

  const emit = (phase: PhotoImportProgress['phase']) => {
    onProgress({
      phase,
      modelProgress,
      done: items.length,
      total,
      percent: computePercent(phase),
      items: [...items],
    });
  };

  emit('queued');

  const task = async (): Promise<PhotoImportItem[]> => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const worker = getWorker();

    if (!workerReady) {
      emit('models');
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          resetWorker();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const handler = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data;
          if (msg.type === 'progress') {
            modelProgress = msg.total > 0 ? Math.min(1, msg.loaded / msg.total) : 0;
            emit('models');
          } else if (msg.type === 'ready') {
            modelProgress = 1;
            workerReady = true;
            worker.removeEventListener('message', handler);
            signal?.removeEventListener('abort', onAbort);
            resolve();
          } else if (msg.type === 'error' && msg.id === null) {
            worker.removeEventListener('message', handler);
            signal?.removeEventListener('abort', onAbort);
            resetWorker();
            reject(new Error(msg.message));
          }
        };
        worker.addEventListener('message', handler);
        const req: WorkerRequest = { type: 'init' };
        worker.postMessage(req);
      });
    }

    for (let i = 0; i < files.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      activePageFrac = 0;
      emit('reading');
      const tickTimer = setInterval(() => {
        activePageFrac = Math.min(
          0.86,
          activePageFrac + (0.9 - activePageFrac) * 0.18,
        );
        emit('reading');
      }, 160);
      const file = files[i];
      try {
        const bitmap = await createImageBitmap(file);
        const reqId = (nextReqId += 1);
        const res = await new Promise<{ page: PageAnalysis; preview: Blob }>(
          (resolve, reject) => {
            const onAbort = () => {
              resetWorker();
              reject(new DOMException('Aborted', 'AbortError'));
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            const handler = (event: MessageEvent<WorkerResponse>) => {
              const msg = event.data;
              if (msg.type === 'result' && msg.id === reqId) {
                worker.removeEventListener('message', handler);
                signal?.removeEventListener('abort', onAbort);
                resolve({ page: msg.page, preview: msg.preview });
              } else if (
                msg.type === 'error' &&
                (msg.id === reqId || msg.id === null)
              ) {
                worker.removeEventListener('message', handler);
                signal?.removeEventListener('abort', onAbort);
                reject(new Error(msg.message));
              }
            };
            worker.addEventListener('message', handler);
            const req: WorkerRequest = { type: 'process', id: reqId, bitmap };
            worker.postMessage(req, [bitmap]);
          },
        );
        const previewUrl = URL.createObjectURL(res.preview);
        items.push({ file, previewUrl, page: res.page });
        activePageFrac = 0;
        emit('reading');
      } finally {
        clearInterval(tickTimer);
      }
    }

    emit('done');
    return items;
  };

  const queued = jobQueue.then(task, task);
  jobQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}
