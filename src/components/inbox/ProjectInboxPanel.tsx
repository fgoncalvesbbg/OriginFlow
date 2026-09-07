/**
 * Project Inbox — the right-hand drawer answering "what is open on my projects, and who
 * is it waiting on?".
 *
 * Replaces the 320px notification dropdown, which could only show rows from the
 * `notifications` table and closed on any outside click. The three lanes are the PM's
 * three questions, in the order they matter:
 *
 *   Needs your review    the supplier answered — the PM is the blocker
 *   Waiting on supplier  the PM asked — the supplier is the blocker
 *   Notifications        mail addressed to this PM
 *
 * State lives in `useProjectInbox` (owned by Layout) so the topbar badge and this list
 * come from the same read. This component is presentational plus its own local view state
 * — filter, collapse, scroll.
 *
 * Dismissal is per-user and state-scoped (see pm-inbox.service): dismissing a "waiting"
 * item cannot hide the later "submitted" one, which is what makes dismissal safe to offer
 * on rows that are still open work.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell, X, RefreshCw, Inbox, ClipboardCheck, Clock, ShieldCheck, FileText, ShoppingBag,
  MessageSquare, Table2, AlertTriangle, ChevronDown, ChevronRight, Undo2, CheckCheck,
  type LucideIcon,
} from 'lucide-react';
import type { InboxItem, InboxKind, InboxLane } from '../../types/inbox.types';
import type { ProjectInbox } from '../../hooks/useProjectInbox';

const KIND_ICON: Record<InboxKind, LucideIcon> = {
  notification: Bell,
  attribute_request: Table2,
  compliance_request: ShieldCheck,
  document: FileText,
  proposal: ShoppingBag,
  review_comment: MessageSquare,
};

const LANES: { lane: InboxLane; label: string; hint: string; Icon: LucideIcon }[] = [
  { lane: 'review', label: 'Needs your review', hint: 'Supplier has responded', Icon: ClipboardCheck },
  { lane: 'waiting', label: 'Waiting on supplier', hint: 'Sent, no response yet', Icon: Clock },
  { lane: 'info', label: 'Notifications', hint: 'Addressed to you', Icon: Bell },
];

/** Days-left → the status vocabulary from DESIGN.md: rose overdue, amber due soon, gray otherwise. */
const deadlineTone = (daysLeft: number) =>
  daysLeft < 0 ? 'text-danger font-bold' : daysLeft <= 3 ? 'text-warning font-semibold' : 'text-secondary';

const deadlineText = (daysLeft: number) =>
  daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'Due today' : `${daysLeft}d left`;

/** Coarse relative age — precise timestamps are noise in a triage list. */
const ageText = (iso: string): string => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

const statusToneClass = (item: InboxItem): string => {
  if (item.lane === 'review') return 'bg-amber-50 text-warning border-amber-200';
  if (item.lane === 'waiting') return 'bg-light text-secondary border-border';
  return item.unread ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-light text-muted border-border';
};

const InboxRow: React.FC<{
  item: InboxItem;
  onDismiss: (item: InboxItem) => void;
  onNavigate: () => void;
}> = ({ item, onDismiss, onNavigate }) => {
  const Icon = KIND_ICON[item.kind];
  const context = [item.projectName, item.supplierName].filter(Boolean).join(' · ');

  const body = (
    <div className="flex items-start gap-2.5">
      <Icon size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={`text-xs leading-snug ${item.unread ? 'font-semibold text-primary' : 'text-primary'}`}>
          {item.title}
        </p>
        {item.detail && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-secondary">{item.detail}</p>}
        {context && <p className="mt-1 truncate text-[10px] uppercase tracking-wide text-muted">{context}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${statusToneClass(item)}`}>
            {item.statusLabel}
          </span>
          {typeof item.daysLeft === 'number' && (
            <span className={`text-[10px] ${deadlineTone(item.daysLeft)}`}>{deadlineText(item.daysLeft)}</span>
          )}
          <span className="text-[10px] text-muted">{ageText(item.at)}</span>
        </div>
      </div>
    </div>
  );

  return (
    <li className="group relative border-b border-border last:border-0">
      {item.link ? (
        <Link to={item.link} onClick={onNavigate} className="block px-4 py-3 pr-9 transition-colors hover:bg-light">
          {body}
        </Link>
      ) : (
        <div className="px-4 py-3 pr-9">{body}</div>
      )}
      <button
        type="button"
        onClick={() => onDismiss(item)}
        aria-label={`Dismiss: ${item.title}`}
        title="Dismiss"
        // Always keyboard-reachable; revealed on hover/focus so the resting list stays calm.
        className="absolute right-2 top-2.5 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-border hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100"
      >
        <X size={13} />
      </button>
    </li>
  );
};

export const ProjectInboxPanel: React.FC<{
  open: boolean;
  onClose: () => void;
  inbox: ProjectInbox;
}> = ({ open, onClose, inbox }) => {
  const { items, failedSources, loading, loadedOnce, refresh, dismiss, dismissLane, undo, undoable } = inbox;
  const [projectFilter, setProjectFilter] = useState('all');
  const [collapsed, setCollapsed] = useState<Record<InboxLane, boolean>>({ review: false, waiting: false, info: false });
  const closeRef = useRef<HTMLButtonElement>(null);

  // Opening is an explicit "show me the current state" — re-read rather than trusting the
  // last poll, which may be up to a minute old.
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  // Escape closes; focus lands on the close button so the drawer is keyboard-exitable.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Only offer projects that actually have something open.
  const projectOptions = useMemo(() => {
    const names = new Set(items.map(i => i.projectName).filter(Boolean));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // A filter that no longer matches anything would strand the PM on an empty list.
  useEffect(() => {
    if (projectFilter !== 'all' && !projectOptions.includes(projectFilter)) setProjectFilter('all');
  }, [projectFilter, projectOptions]);

  const visible = useMemo(
    () => (projectFilter === 'all' ? items : items.filter(i => i.projectName === projectFilter)),
    [items, projectFilter],
  );

  return (
    <>
      {/* Backdrop below lg, where the drawer overlays the page instead of sitting beside it. */}
      {open && <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        role="dialog"
        aria-label="Project inbox"
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-[400px] flex-col border-l border-border bg-surface shadow-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full'
        }`}
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Inbox size={17} className="text-accent" aria-hidden="true" />
          <h2 className="flex-1 text-sm font-bold text-primary">Project Inbox</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh inbox"
            title="Refresh"
            className="rounded p-1.5 text-muted transition-colors hover:bg-light hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close project inbox"
            className="rounded p-1.5 text-muted transition-colors hover:bg-light hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={16} />
          </button>
        </header>

        {projectOptions.length > 1 && (
          <div className="border-b border-border px-4 py-2">
            <select
              value={projectFilter}
              onChange={e => setProjectFilter(e.target.value)}
              aria-label="Filter inbox by project"
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="all">All projects ({items.length})</option>
              {projectOptions.map(name => (
                <option key={name} value={name}>
                  {name} ({items.filter(i => i.projectName === name).length})
                </option>
              ))}
            </select>
          </div>
        )}

        {failedSources.length > 0 && (
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-[11px] leading-snug text-warning">
              This list is incomplete — {failedSources.join(', ')} could not be read. Refresh to retry.
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {!loadedOnce && loading ? (
            <div className="flex flex-col items-center gap-2 py-16 text-xs text-muted">
              <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-accent" />
              Loading your open topics…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
              <CheckCheck size={26} className="text-success opacity-60" aria-hidden="true" />
              <p className="text-xs font-medium text-primary">Nothing open</p>
              <p className="text-[11px] text-muted">
                {projectFilter === 'all'
                  ? 'No submissions, requests or notifications are waiting.'
                  : `Nothing open on ${projectFilter}.`}
              </p>
            </div>
          ) : (
            LANES.map(({ lane, label, hint, Icon }) => {
              const laneItems = visible.filter(i => i.lane === lane);
              if (laneItems.length === 0) return null;
              const isCollapsed = collapsed[lane];
              const overdue = laneItems.filter(i => typeof i.daysLeft === 'number' && (i.daysLeft as number) < 0).length;
              return (
                <section key={lane}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-light px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setCollapsed(prev => ({ ...prev, [lane]: !prev[lane] }))}
                      aria-expanded={!isCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {isCollapsed ? <ChevronRight size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
                      <Icon size={13} className="shrink-0 text-secondary" aria-hidden="true" />
                      <span className="truncate text-[11px] font-bold uppercase tracking-wide text-secondary">{label}</span>
                      <span className="rounded-full bg-border px-1.5 text-[10px] font-bold text-primary">{laneItems.length}</span>
                      {overdue > 0 && (
                        <span className="rounded-full bg-rose-100 px-1.5 text-[10px] font-bold text-danger">{overdue} overdue</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void dismissLane(lane, visible)}
                      title={`Dismiss all ${laneItems.length} — ${hint}`}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted transition-colors hover:bg-border hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Dismiss all
                    </button>
                  </div>
                  {!isCollapsed && (
                    <ul>
                      {laneItems.map(item => (
                        <InboxRow key={item.key} item={item} onDismiss={dismiss} onNavigate={onClose} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>

        {undoable && (
          <div className="flex items-center gap-3 border-t border-border bg-primary px-4 py-2.5">
            <span className="flex-1 text-[11px] text-white">
              {undoable.length === 1 ? 'Item dismissed' : `${undoable.length} items dismissed`}
            </span>
            <button
              type="button"
              onClick={() => void undo()}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold text-white underline transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <Undo2 size={12} /> Undo
            </button>
          </div>
        )}

        <footer className="border-t border-border px-4 py-2">
          <p className="text-[10px] text-muted">
            Dismissing hides an item at its current status. If the supplier acts on it, it comes back.
          </p>
        </footer>
      </aside>
    </>
  );
};

export default ProjectInboxPanel;
