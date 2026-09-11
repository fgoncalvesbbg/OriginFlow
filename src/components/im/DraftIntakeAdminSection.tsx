/**
 * Admin control for the quality draft queue's shared access code (migration 179).
 *
 * WHY THIS SCREEN HAS TO EXIST. The QM queue at /#/im-draft/queue is the only way a quality
 * manager receives a review link — OriginFlow sends no email at all
 * (`triggerEmailNotification` is a stub that suppresses every send). The queue is gated by
 * one shared code, and migration 179 seeds NO code: `im_draft_portal_config` starts empty,
 * `im_draft_check_code` therefore returns false for every input, and the queue is closed
 * until somebody sets one here. A shipped default code is a published code.
 *
 * THE CODE IS NEVER READ BACK. It is stored as a pgcrypto hash and there is no function that
 * returns it — so this screen can set it and say when it was last set, but it cannot show it.
 * That is deliberate: an admin who has lost the code rotates it and re-distributes, which is
 * the same thing they would have to do if it had leaked.
 *
 * ROTATING REVOKES EVERYONE AT ONCE, which is the point of a single shared code. Anyone
 * holding the old one stops at the gate on their next visit; links they already opened are
 * review tokens with their own expiry and are not affected.
 */

import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Link as LinkIcon } from 'lucide-react';
import { db } from '../../data';
import { isLive } from '../../config/environment.config';

const MIN_LENGTH = 8;

export const DraftIntakeAdminSection: React.FC = () => {
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [setAt, setSetAt] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const queueUrl = `${window.location.origin}${window.location.pathname}#/im-draft/queue`;

  const loadStatus = async () => {
    if (!isLive) { setConfigured(false); return; }
    try {
      // Only whether one exists and when it was set — the hash itself is not selected, and
      // would be useless if it were.
      const rows = await db.select<{ updated_at: string }>('im_draft_portal_config', {
        columns: 'updated_at',
      });
      setConfigured(rows.length > 0);
      setSetAt(rows[0]?.updated_at ?? null);
    } catch {
      // The table is default-deny with no grant to `authenticated`, so a non-admin simply
      // sees "unknown" rather than an error they cannot act on.
      setConfigured(null);
    }
  };

  useEffect(() => { void loadStatus(); }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved(false);

    if (code.trim().length < MIN_LENGTH) {
      setError(`The access code must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (code !== confirm) {
      setError('The two codes do not match.');
      return;
    }

    setBusy(true);
    try {
      // The RPC re-checks that the caller is an ADMIN. This form being on an admin screen is
      // not the guarantee — the function is.
      await db.rpc('im_draft_set_code', { p_code: code.trim() });
      setSaved(true);
      setCode('');
      setConfirm('');
      await loadStatus();
    } catch (err: any) {
      setError(err?.message ?? 'Could not set the access code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-1">
        <KeyRound size={15} className="text-gray-400" /> Quality draft queue
      </h3>
      <p className="text-xs text-muted mb-4">
        Quality managers open one fixed link to see the supplier drafts waiting for their
        check. They do not log in — this code is what gets them in.
      </p>

      <div className="bg-light/60 border border-gray-200 rounded-lg px-3 py-2 mb-4">
        <div className="text-[11px] font-semibold text-gray-600 mb-1 flex items-center gap-1">
          <LinkIcon size={11} /> The link to give them
        </div>
        <code className="text-[11px] text-gray-800 break-all">{queueUrl}</code>
      </div>

      <div className="mb-4 text-xs">
        {configured === null && <span className="text-gray-400">Access code status unavailable.</span>}
        {configured === false && (
          <span className="text-amber-700 inline-flex items-center gap-1">
            <AlertCircle size={12} /> No access code is set — the queue is closed to everyone.
          </span>
        )}
        {configured === true && (
          <span className="text-emerald-700 inline-flex items-center gap-1">
            <CheckCircle2 size={12} /> An access code is set
            {setAt ? ` (last changed ${new Date(setAt).toLocaleDateString()})` : ''}.
          </span>
        )}
      </div>

      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-gray-600 mb-1">
            New access code
          </label>
          <input
            type="password"
            value={code}
            onChange={e => setCode(e.target.value)}
            autoComplete="new-password"
            placeholder={`At least ${MIN_LENGTH} characters`}
            className="w-full sm:max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-600 mb-1">
            Repeat it
          </label>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="w-full sm:max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {error && (
          <p className="text-xs text-rose-700 inline-flex items-start gap-1">
            <AlertCircle size={12} className="shrink-0 mt-0.5" /> {error}
          </p>
        )}
        {saved && (
          <p className="text-xs text-emerald-700 inline-flex items-center gap-1">
            <CheckCircle2 size={12} /> Saved. Anyone using the old code will be stopped at the gate.
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
        >
          {busy ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Set access code'}
        </button>
      </form>

      <p className="text-[11px] text-gray-400 mt-4">
        The code is stored hashed and is never shown again, here or anywhere else. If it is
        lost, set a new one and tell the team — there is nothing to look up.
      </p>
    </div>
  );
};

export default DraftIntakeAdminSection;
