/**
 * The PDF review surface: pages rendered to canvases, with numbered pins the reviewer drops
 * by clicking.
 *
 * This is the half of the review portal that could NOT be shared with the Instruction
 * Manual. An IM note anchors to a chapter plus the wording the reviewer selected, because
 * the reviewer is reading HTML this app rendered. A design spec is a PDF: there are no
 * chapters and no text we control, so a note anchors to a page and a position on it.
 *
 * COORDINATES ARE FRACTIONS, NOT PIXELS. A pin is stored as x/y in 0..1 of the page box, so
 * it lands in the same place at any zoom, at any device pixel ratio, and on any page size —
 * and it survives the page being re-rendered at a different scale when the window resizes.
 * Storing pixels would drift on all three. The database enforces the range
 * (`review_comments_anchor_bounds`).
 *
 * PAGES RENDER LAZILY. A 40-page spec rendered eagerly is 40 full-page rasters in memory
 * before the reviewer has scrolled anywhere. An IntersectionObserver renders each page as it
 * approaches the viewport and each canvas keeps its bitmap once drawn, so scrolling back is
 * instant.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a hashed, bundled asset URL at build time — pdf.js spawns its own
// worker from it to do the binary parsing off the main thread. Same import the
// pdf-to-markdown module uses; sharing it keeps one copy of the worker in the bundle.
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { Loader2, AlertTriangle, ZoomIn, ZoomOut } from 'lucide-react';
import type { PdfReviewAnchor, ReviewComment } from '../../types/review.types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

/** Zoom steps, as a multiplier on the width-fitted base scale. */
const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 2] as const;
const DEFAULT_ZOOM_INDEX = 1;

/** How far outside the viewport a page starts rendering. One screen of lead time. */
const RENDER_MARGIN_PX = 800;

export interface PdfReviewCanvasProps {
  /** A short-lived signed URL. See netlify/functions/design-spec-file.ts. */
  fileUrl: string;
  /** Existing notes, so their pins are drawn on the pages. */
  comments: readonly ReviewComment[];
  /** True while the composer is open — suppresses new pin drops. */
  composing: boolean;
  /** The anchor being composed, drawn as a provisional pin. */
  draftAnchor: PdfReviewAnchor | null;
  onDropPin: (anchor: PdfReviewAnchor) => void;
  focusedCommentId: string | null;
  onFocusComment: (id: string | null) => void;
  /** Read-only mode: pins are shown, none can be dropped. */
  readOnly?: boolean;
}

interface PageState {
  pageNumber: number;
  /** Intrinsic size at scale 1, for the aspect-ratio box before the raster exists. */
  width: number;
  height: number;
}

/** A pin's display number: its position in reading order, matching the rail's list. */
const pinNumbers = (comments: readonly ReviewComment[]): Map<string, number> => {
  const pdfNotes = comments
    .filter(c => c.anchor?.kind === 'pdf')
    .sort((a, b) => {
      const aa = a.anchor as PdfReviewAnchor;
      const bb = b.anchor as PdfReviewAnchor;
      if (aa.page !== bb.page) return aa.page - bb.page;
      if (aa.y !== bb.y) return aa.y - bb.y;
      return a.createdAt.localeCompare(b.createdAt);
    });
  return new Map(pdfNotes.map((c, i) => [c.id, i + 1]));
};

const PdfReviewCanvas: React.FC<PdfReviewCanvasProps> = ({
  fileUrl, comments, composing, draftAnchor, onDropPin,
  focusedCommentId, onFocusComment, readOnly = false,
}) => {
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageState[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  /** Width of the scroll container, so pages can be fitted to it. */
  const [containerWidth, setContainerWidth] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  /** Pages already rastered, so a re-render at the same scale is skipped. */
  const renderedAt = useRef(new Map<number, number>());

  const numbers = useMemo(() => pinNumbers(comments), [comments]);

  // ---- load the document ----
  useEffect(() => {
    let cancelled = false;
    // Destruction lives on the loading task, not the resolved document — the same lesson the
    // pdf-to-markdown worker records.
    const task = pdfjsLib.getDocument({ url: fileUrl });

    task.promise.then(async loaded => {
      // Bailing out needs no destroy() call of its own: pdf.js v6 puts destruction on the
      // LOADING TASK, not on the resolved document, and the cleanup below has already run
      // task.destroy() by the time `cancelled` is true.
      if (cancelled) return;
      const next: PageState[] = [];
      for (let n = 1; n <= loaded.numPages; n++) {
        const page = await loaded.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        next.push({ pageNumber: n, width: viewport.width, height: viewport.height });
      }
      if (cancelled) return;
      setDoc(loaded);
      setPages(next);
      setLoading(false);
    }).catch(e => {
      if (cancelled) return;
      // A signed URL that has expired lands here too, which is why the message points at
      // reloading rather than at the file being broken.
      console.error('[PdfReviewCanvas] could not load the PDF:', e);
      setError('This document could not be opened. Reload the page to try again.');
      setLoading(false);
    });

    return () => {
      cancelled = true;
      void task.destroy();
      renderedAt.current.clear();
    };
  }, [fileUrl]);

  // ---- track the container width, so pages fit it ----
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Scale that fits the widest page to the container, times the zoom step.
   *
   * Derived from the WIDEST page rather than per page, so a spec mixing portrait and
   * landscape pages renders them at one consistent scale instead of blowing the landscape
   * ones up to the same width as the portrait ones.
   */
  const scale = useMemo(() => {
    if (containerWidth === 0 || pages.length === 0) return 1;
    const widest = Math.max(...pages.map(p => p.width));
    // 48px of breathing room for the page shadow and the scrollbar.
    const fit = (containerWidth - 48) / widest;
    return Math.max(0.2, fit) * ZOOM_STEPS[zoomIndex];
  }, [containerWidth, pages, zoomIndex]);

  const renderPage = useCallback(async (pageNumber: number) => {
    if (!doc) return;
    const canvas = canvasRefs.current.get(pageNumber);
    if (!canvas) return;
    if (renderedAt.current.get(pageNumber) === scale) return;

    const page = await doc.getPage(pageNumber);
    // Rasterise at the device's pixel density, then let CSS scale it back down, or the page
    // is visibly soft on a retina screen — at which point a reviewer cannot read the
    // tolerances they are being asked to check.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * dpr });
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

    renderedAt.current.set(pageNumber, scale);
    try {
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    } catch (e) {
      // A render cancelled by a scale change is normal and must not blank the page.
      renderedAt.current.delete(pageNumber);
      if ((e as { name?: string })?.name !== 'RenderingCancelledException') {
        console.error(`[PdfReviewCanvas] page ${pageNumber} failed to render:`, e);
      }
    }
  }, [doc, scale]);

  // ---- render pages as they approach the viewport ----
  useEffect(() => {
    if (!doc || pages.length === 0) return;
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const n = Number((entry.target as HTMLElement).dataset.page);
        if (n) void renderPage(n);
      }
    }, { root, rootMargin: `${RENDER_MARGIN_PX}px 0px` });

    for (const el of root.querySelectorAll('[data-page]')) observer.observe(el);
    return () => observer.disconnect();
  }, [doc, pages, renderPage]);

  // A zoom change invalidates every raster; clear and let the observer redraw what is visible.
  useEffect(() => {
    renderedAt.current.clear();
    const root = scrollRef.current;
    if (!root || !doc) return;
    for (const el of root.querySelectorAll('[data-page]')) {
      const rect = el.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const near = rect.bottom > rootRect.top - RENDER_MARGIN_PX
        && rect.top < rootRect.bottom + RENDER_MARGIN_PX;
      if (near) void renderPage(Number((el as HTMLElement).dataset.page));
    }
  }, [scale, doc, renderPage]);

  /**
   * Turn a click into a normalised anchor.
   *
   * Measured against the page WRAPPER's box rather than the canvas bitmap, because the
   * bitmap is oversampled by the device pixel ratio — dividing by its width would put every
   * pin at a fraction of where it was clicked on a retina screen.
   */
  const handlePageClick = (pageNumber: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly || composing) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    // Clamp rather than drop: a click one pixel outside the box after a sub-pixel layout
    // rounding is a click the reviewer meant to make.
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    onDropPin({
      kind: 'pdf',
      page: pageNumber,
      x: Number(clamp(x).toFixed(5)),
      y: Number(clamp(y).toFixed(5)),
      w: null,
      h: null,
    });
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100 text-gray-400 gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading document…
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-100 text-gray-500 gap-3 px-4 text-center">
        <AlertTriangle size={28} className="text-amber-400" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-100">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 bg-white shrink-0">
        <span className="text-[11px] text-gray-500">
          {pages.length} page{pages.length === 1 ? '' : 's'}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setZoomIndex(i => Math.max(0, i - 1))}
          disabled={zoomIndex === 0}
          title="Zoom out"
          className="p-1 text-gray-500 hover:text-gray-800 disabled:opacity-30"
        >
          <ZoomOut size={14} />
        </button>
        <span className="text-[11px] text-gray-500 w-10 text-center">
          {Math.round(ZOOM_STEPS[zoomIndex] * 100)}%
        </span>
        <button
          onClick={() => setZoomIndex(i => Math.min(ZOOM_STEPS.length - 1, i + 1))}
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          title="Zoom in"
          className="p-1 text-gray-500 hover:text-gray-800 disabled:opacity-30"
        >
          <ZoomIn size={14} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-6 space-y-6">
        {pages.map(p => {
          const displayWidth = p.width * scale;
          const displayHeight = p.height * scale;
          const pagePins = comments.filter(
            c => c.anchor?.kind === 'pdf' && c.anchor.page === p.pageNumber,
          );
          const draftOnThisPage = draftAnchor?.page === p.pageNumber ? draftAnchor : null;

          return (
            <div
              key={p.pageNumber}
              data-page={p.pageNumber}
              className="mx-auto relative bg-white shadow-md"
              style={{ width: displayWidth, height: displayHeight }}
              onClick={handlePageClick(p.pageNumber)}
              // A pointer that says "you can mark here" is the only affordance telling a
              // reviewer the page is clickable at all.
              role={readOnly || composing ? undefined : 'button'}
              title={readOnly || composing ? undefined : 'Click the page to leave a note'}
            >
              <canvas
                ref={el => {
                  if (el) canvasRefs.current.set(p.pageNumber, el);
                  else canvasRefs.current.delete(p.pageNumber);
                }}
                className="block"
                style={{ width: displayWidth, height: displayHeight }}
              />

              {pagePins.map(c => {
                const a = c.anchor as PdfReviewAnchor;
                const focused = focusedCommentId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={ev => { ev.stopPropagation(); onFocusComment(focused ? null : c.id); }}
                    title={c.body}
                    style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center border-2 transition-transform ${
                      focused
                        ? 'bg-indigo-600 text-white border-white scale-125 z-20'
                        : c.status === 'open'
                          ? 'bg-amber-400 text-amber-950 border-white hover:scale-110 z-10'
                          : 'bg-emerald-500 text-white border-white hover:scale-110 z-10'
                    }`}
                  >
                    {numbers.get(c.id) ?? '•'}
                  </button>
                );
              })}

              {draftOnThisPage && (
                <span
                  style={{ left: `${draftOnThisPage.x * 100}%`, top: `${draftOnThisPage.y * 100}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-indigo-600 border-2 border-white z-30 animate-pulse"
                />
              )}

              <span className="absolute -bottom-5 right-0 text-[10px] text-gray-400">
                {p.pageNumber}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PdfReviewCanvas;
