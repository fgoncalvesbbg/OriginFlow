import { useEffect } from 'react';
import { Download, X } from 'lucide-react';

/**
 * Slide-over preview of the plain-text change summary.
 *
 * It previews rather than downloading straight away so the "Summary" toolbar button reads as part
 * of the tool, not as a button that silently drops a file in your Downloads folder — and so you
 * can check what is in the report before it leaves the room.
 */

export interface SummaryPreviewPanelProps {
  open: boolean;
  text: string;
  category?: string;
  onClose: () => void;
  onDownload: () => void;
}

export default function SummaryPreviewPanel({
  open,
  text,
  category,
  onClose,
  onDownload,
}: SummaryPreviewPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open) return null;

  return (
    <>
      <div className="rdmp-backdrop" onClick={onClose} />
      <aside className="rdmp-panel" role="dialog" aria-label="Summary preview">
        <header className="rdmp-panel-head">
          <h2>Summary preview{category ? ` — ${category}` : ''}</h2>
          <div className="rdmp-panel-actions">
            <button type="button" className="rdmp-btn is-primary" onClick={onDownload}>
              <Download size={13} /> Download .txt
            </button>
            <button type="button" className="rdmp-btn" onClick={onClose}>
              <X size={13} /> Close
            </button>
          </div>
        </header>
        <div className="rdmp-panel-body">
          <pre className="rdmp-summary-pre">{text}</pre>
        </div>
      </aside>
    </>
  );
}
