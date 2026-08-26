/** Floating bottom-right widget: collapsed by default, lets any signed-in user file a bug or feature request. */
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageSquarePlus, X, Bug, Lightbulb, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../hooks/useToast';
import { createFeedbackReport } from '../../services';
import { FeedbackReportType } from '../../types';

export const FeedbackWidget: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackReportType>('bug');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const close = () => {
    setOpen(false);
    setType('bug');
    setMessage('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    try {
      await createFeedbackReport({ type, message: message.trim(), pagePath: location.pathname }, user.id);
      toast.success(type === 'bug' ? 'Bug report sent — thanks!' : 'Feature request sent — thanks!');
      close();
    } catch (err: any) {
      toast.error(`Could not send report: ${err?.message ?? err}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    // Icon-only and small on purpose: a wider pill with a text label was overlapping other
    // pages' own bottom-right controls (action bars, dialog buttons). A compact circle in
    // the very corner leaves those alone.
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Report a bug or request a feature"
        title="Report a bug or request a feature"
        className="fixed bottom-4 right-4 z-40 flex items-center justify-center w-10 h-10 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <MessageSquarePlus size={16} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden animate-scaleIn">
      <div className="flex items-center justify-between px-4 py-3 bg-light border-b border-gray-200">
        <h3 className="text-sm font-bold text-primary">Report a bug or idea</h3>
        <button onClick={close} aria-label="Close" className="p-1 text-gray-400 hover:text-gray-700 rounded">
          <X size={16} />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType('bug')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${type === 'bug' ? 'bg-rose-50 border-rose-300 text-rose-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
          >
            <Bug size={14} /> Bug
          </button>
          <button
            type="button"
            onClick={() => setType('feature')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${type === 'feature' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
          >
            <Lightbulb size={14} /> Idea
          </button>
        </div>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={type === 'bug' ? "What went wrong? What did you expect instead?" : "What would you like to see?"}
          rows={4}
          autoFocus
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          type="submit"
          disabled={!message.trim() || submitting}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />} Send
        </button>
      </form>
    </div>
  );
};
