/**
 * Roadmap Creator — file downloads.
 *
 * The one place that touches Blob/URL/anchor, so every other module stays pure and testable.
 */

export function downloadText(
  filename: string,
  text: string,
  mime = 'text/plain;charset=utf-8',
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; give it a beat.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
