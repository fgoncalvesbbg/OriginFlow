/**
 * useClickOutside hook
 * Detects clicks outside of a specified element
 * Useful for closing dropdowns, modals, etc.
 */

import { useEffect, useRef, RefObject } from 'react';

export const useClickOutside = <T extends HTMLElement>(
  callback: () => void
): RefObject<T> => {
  const ref = useRef<T>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callback();
      }
    };

    // Bind the event listener
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      // Unbind the event listener on clean up
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [callback]);

  return ref;
};
