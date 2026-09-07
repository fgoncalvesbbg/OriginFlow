/**
 * Client-side blob download — build a Blob, hand it here, get a save-file prompt.
 *
 * The anchor is appended to `document.body` before `.click()` and removed right after: Firefox
 * does not reliably fire a synthetic click on a detached element, so an anchor that is never
 * attached silently does nothing there while working fine in Chromium. The object URL is always
 * revoked once the click has been dispatched, so the blob doesn't leak for the life of the tab.
 */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
