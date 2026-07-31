/**
 * Owns the file queue and the single long-lived parsing worker.
 *
 * Files are processed strictly one at a time: only one 'process' request is
 * ever in flight, and the next queued file is only dispatched once the
 * worker reports 'result' or 'error' for the current one. A failed file is
 * marked 'error' in place and the queue moves on — one bad PDF never aborts
 * the batch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileEntry, ProcessFileRequest, WorkerResponse } from './types';

let idCounter = 0;
const makeId = () => `pdf-${Date.now()}-${idCounter++}`;

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export interface AddFilesResult {
  accepted: number;
  rejected: string[];
}

export function usePdfToMarkdownConverter() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [detectColumns, setDetectColumns] = useState(true);

  const workerRef = useRef<Worker | null>(null);
  const processingIdRef = useRef<string | null>(null);

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      const worker = new Worker(new URL('./workers/pdf-parse.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (msg.type === 'progress') {
          setEntries((prev) =>
            prev.map((e) => (e.id === msg.fileId ? { ...e, currentPage: msg.page, totalPages: msg.totalPages } : e)),
          );
          return;
        }

        processingIdRef.current = null;
        if (msg.type === 'result') {
          setEntries((prev) =>
            prev.map((e) =>
              e.id === msg.fileId ? { ...e, status: 'done', result: msg.result, currentPage: e.totalPages } : e,
            ),
          );
        } else {
          setEntries((prev) =>
            prev.map((e) =>
              e.id === msg.fileId ? { ...e, status: 'error', error: msg.message, result: undefined } : e,
            ),
          );
        }
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  // Advances the queue: whenever nothing is in flight, dispatch the next
  // queued file. Re-runs on every entries change (including progress ticks)
  // but bails immediately once something is processing, so it stays cheap.
  useEffect(() => {
    if (processingIdRef.current) return;
    const next = entries.find((e) => e.status === 'queued');
    if (!next) return;

    processingIdRef.current = next.id;
    setEntries((prev) => prev.map((e) => (e.id === next.id ? { ...e, status: 'processing' } : e)));

    next.file
      .arrayBuffer()
      .then((buffer) => {
        const request: ProcessFileRequest = {
          type: 'process',
          fileId: next.id,
          fileName: next.file.name,
          buffer,
          detectColumns,
        };
        getWorker().postMessage(request, [buffer]);
      })
      .catch(() => {
        processingIdRef.current = null;
        setEntries((prev) =>
          prev.map((e) => (e.id === next.id ? { ...e, status: 'error', error: 'Could not read this file.' } : e)),
        );
      });
  }, [entries, detectColumns, getWorker]);

  const addFiles = useCallback((files: File[]): AddFilesResult => {
    const accepted: FileEntry[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      if (!isPdfFile(file)) {
        rejected.push(file.name);
        continue;
      }
      accepted.push({ id: makeId(), file, status: 'queued', currentPage: 0, totalPages: 0 });
    }

    if (accepted.length > 0) {
      setEntries((prev) => [...prev, ...accepted]);
    }
    return { accepted: accepted.length, rejected };
  }, []);

  const removeFile = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setEntries([]);
  }, []);

  return { entries, detectColumns, setDetectColumns, addFiles, removeFile, clearAll };
}
