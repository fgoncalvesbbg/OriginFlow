/**
 * Shared types for the PDF → Markdown tool, including the worker message
 * protocol. Everything here stays plain data (no DOM/File objects) so it can
 * cross the worker boundary via structured clone.
 */

/** A single text run as pdf.js reports it, reduced to the fields our reading-order logic needs. */
export interface TextItemLike {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageMeta {
  pageNumber: number;
  charCount: number;
  isImageOnly: boolean;
  imageCount: number;
}

export interface ConversionMeta {
  fileName: string;
  pageCount: number;
  /** Character count of the page-content body (excludes the front-matter block itself). */
  charCount: number;
  estimatedTokens: number;
  imageOnlyPageCount: number;
  pagesWithImagesCount: number;
  pages: PageMeta[];
}

export interface ConversionResult {
  meta: ConversionMeta;
  markdown: string;
}

/** Below this many characters of extracted text, a page is treated as scanned/image-only. */
export const IMAGE_ONLY_CHAR_THRESHOLD = 20;

// --- Worker protocol -------------------------------------------------------

export interface ProcessFileRequest {
  type: 'process';
  fileId: string;
  fileName: string;
  buffer: ArrayBuffer;
  detectColumns: boolean;
}

export type WorkerRequest = ProcessFileRequest;

export interface ProgressResponse {
  type: 'progress';
  fileId: string;
  page: number;
  totalPages: number;
}

export interface ResultResponse {
  type: 'result';
  fileId: string;
  result: ConversionResult;
}

export interface ErrorResponse {
  type: 'error';
  fileId: string;
  message: string;
}

export type WorkerResponse = ProgressResponse | ResultResponse | ErrorResponse;

// --- UI state ---------------------------------------------------------------

export type FileStatus = 'queued' | 'processing' | 'done' | 'error';

export interface FileEntry {
  id: string;
  file: File;
  status: FileStatus;
  currentPage: number;
  totalPages: number;
  result?: ConversionResult;
  error?: string;
}
