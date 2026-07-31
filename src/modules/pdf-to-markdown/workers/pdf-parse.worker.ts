/// <reference lib="webworker" />
/**
 * Everything PDF-related runs in here, off the main thread: loading the
 * document, walking every page, reconstructing reading order, and
 * inventorying images. Files are processed one at a time — the main thread
 * enforces that by waiting for a 'result'/'error' before posting the next
 * 'process' request.
 *
 * Nothing here talks to the network or to any storage API. Each file's
 * ArrayBuffer is transferred in (so the main thread's copy is neutered
 * immediately) and dropped once its document is destroyed.
 */

import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a hashed, bundled asset URL at build time — pdf.js
// spawns its own nested worker from it to do the actual binary parsing.
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { assembleMarkdown, reconstructPageText } from '../pdf-to-markdown.utils';
import { ProcessFileRequest, TextItemLike, WorkerRequest, WorkerResponse } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// pdf.js (v6) folds JPEG painting into paintImageXObject rather than a
// separate op, so this is the current equivalent of "any image was painted".
const IMAGE_OPS: ReadonlySet<number> = new Set([
  pdfjsLib.OPS.paintImageXObject,
  pdfjsLib.OPS.paintInlineImageXObject,
  pdfjsLib.OPS.paintImageXObjectRepeat,
]);

function post(message: WorkerResponse): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
}

async function countImageOps(page: pdfjsLib.PDFPageProxy): Promise<number> {
  const opList = await page.getOperatorList();
  let count = 0;
  for (const fn of opList.fnArray) {
    if (IMAGE_OPS.has(fn)) count++;
  }
  return count;
}

async function processFile(req: ProcessFileRequest): Promise<void> {
  // Destruction lives on the loading task, not the resolved PDFDocumentProxy.
  const loadingTask = pdfjsLib.getDocument({ data: req.buffer });
  const doc = await loadingTask.promise;

  try {
    const totalPages = doc.numPages;
    const pageBodies: { pageNumber: number; text: string; imageCount: number }[] = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const [textContent, imageCount] = await Promise.all([
          page.getTextContent(),
          countImageOps(page),
        ]);
        const viewport = page.getViewport({ scale: 1 });
        const items: TextItemLike[] = textContent.items
          .filter((it: any): boolean => typeof it.str === 'string')
          .map((it: any) => ({
            str: it.str,
            x: it.transform[4],
            y: it.transform[5],
            width: it.width,
            height: it.height,
          }));

        const text = reconstructPageText(items, viewport.width, req.detectColumns);
        pageBodies.push({ pageNumber, text, imageCount });
      } finally {
        page.cleanup();
      }

      post({ type: 'progress', fileId: req.fileId, page: pageNumber, totalPages });
    }

    const result = assembleMarkdown(req.fileName, pageBodies);
    post({ type: 'result', fileId: req.fileId, result });
  } finally {
    await loadingTask.destroy();
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.type !== 'process') return;

  try {
    await processFile(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error while parsing this PDF.';
    post({ type: 'error', fileId: req.fileId, message });
  }
};
