/**
 * Zero-dependency image lightbox: overlay with wheel/button zoom, drag-to-pan, prev/next across
 * the manual's full image list, and ESC/backdrop close. Exposed through a context so any node
 * renderer can call `open(url)`.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { CollectedImage } from './types';

interface LightboxApi {
  open: (url: string) => void;
}

const LightboxContext = createContext<LightboxApi>({ open: () => {} });

export const useLightbox = () => useContext(LightboxContext);

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const LightboxProvider: React.FC<{ images: CollectedImage[]; children: React.ReactNode }> = ({
  images,
  children,
}) => {
  const [index, setIndex] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Map a url to its position in the collected list so prev/next works from any entry point.
  const urlToIndex = useMemo(() => {
    const map = new Map<string, number>();
    images.forEach((img, i) => {
      if (!map.has(img.url)) map.set(img.url, i);
    });
    return map;
  }, [images]);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const open = useCallback(
    (url: string) => {
      const i = urlToIndex.get(url);
      setIndex(i ?? 0);
      reset();
    },
    [urlToIndex, reset],
  );

  const close = useCallback(() => setIndex(null), []);
  const step = useCallback(
    (dir: number) => {
      setIndex((cur) => {
        if (cur === null || images.length === 0) return cur;
        return (cur + dir + images.length) % images.length;
      });
      reset();
    },
    [images.length, reset],
  );

  const zoom = useCallback((delta: number) => {
    setScale((s) => clamp(+(s + delta).toFixed(2), MIN_SCALE, MAX_SCALE));
  }, []);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === '+' || e.key === '=') zoom(0.5);
      else if (e.key === '-') zoom(-0.5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, close, step, zoom]);

  const api = useMemo<LightboxApi>(() => ({ open }), [open]);

  const current = index !== null ? images[index] : null;

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? -0.3 : 0.3);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    });
  };
  const onPointerUp = () => {
    setDragging(false);
    dragStart.current = null;
  };

  return (
    <LightboxContext.Provider value={api}>
      {children}
      {current && (
        <div className="imv-lightbox" onClick={close} onWheel={onWheel} role="dialog" aria-modal="true">
          <button className="imv-lightbox-btn imv-lightbox-close" onClick={close} aria-label="Close">
            <X size={20} />
          </button>

          {images.length > 1 && (
            <>
              <button
                className="imv-lightbox-btn imv-lightbox-prev"
                onClick={(e) => { e.stopPropagation(); step(-1); }}
                aria-label="Previous image"
              >
                <ChevronLeft size={22} />
              </button>
              <button
                className="imv-lightbox-btn imv-lightbox-next"
                onClick={(e) => { e.stopPropagation(); step(1); }}
                aria-label="Next image"
              >
                <ChevronRight size={22} />
              </button>
            </>
          )}

          <img
            className={`imv-lightbox-img${dragging ? ' imv-dragging' : ''}`}
            src={current.url}
            alt={current.alt ?? ''}
            draggable={false}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />

          <div className="imv-lightbox-zoom" onClick={(e) => e.stopPropagation()}>
            <button className="imv-lightbox-btn" onClick={() => zoom(-0.5)} aria-label="Zoom out">
              <ZoomOut size={18} />
            </button>
            <button className="imv-lightbox-btn" onClick={() => zoom(0.5)} aria-label="Zoom in">
              <ZoomIn size={18} />
            </button>
          </div>

          {current.caption && scale === 1 && (
            <div className="imv-lightbox-caption">{current.caption}</div>
          )}
        </div>
      )}
    </LightboxContext.Provider>
  );
};
