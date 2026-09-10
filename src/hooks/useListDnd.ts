import { useState, useCallback } from 'react';

/**
 * Lightweight native HTML5 drag-and-drop reordering for a single list, with no
 * external dependency. Reordering is exposed as an arbitrary `from → to` move so it
 * layers on top of the existing arrow-button reorder handlers (which stay as an
 * accessible fallback).
 *
 * Dragging is driven by a dedicated HANDLE, not the whole row: the IM editors host
 * `contentEditable` surfaces, and marking a whole card `draggable` would swallow the
 * text selection the author needs. Wire `handleProps(i)` onto the grip control and
 * `dropProps(i)` onto the row container.
 *
 * `onReorder(from, to)` receives indices into the SAME list the props are wired to;
 * the caller is responsible for translating those into its own state update.
 */
export function useListDnd(onReorder: (from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const reset = useCallback(() => { setDragIndex(null); setOverIndex(null); }, []);

  // Props for the drag handle (a small grip button/icon inside the row).
  const handleProps = useCallback((index: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = 'move';
      // Firefox requires data to be set for a drag to actually start.
      try { e.dataTransfer.setData('text/plain', String(index)); } catch { /* noop */ }
    },
    onDragEnd: reset,
  }), [reset]);

  // Props for the row container (the drop target).
  const dropProps = useCallback((index: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (dragIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (overIndex !== index) setOverIndex(index);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index);
      reset();
    },
  }), [dragIndex, overIndex, onReorder, reset]);

  return { handleProps, dropProps, dragIndex, overIndex };
}
