/**
 * Add a regulation to the Regulation library from inside the TCF requirement editor.
 *
 * THE RULE THIS SERVES: the Regulation library is the central register, and a TCF requirement
 * is derived from it — "what a supplier must hand over to prove compliance with THIS". So a
 * requirement has to cite one. That rule is only tolerable if citing a regulation the library
 * does not have yet is a ten-second detour rather than "abandon this form, go to another
 * screen, create it, come back and retype everything". Hence this.
 *
 * DELIBERATELY MINIMAL. Reference code and title only — the two fields `regulations` declares
 * NOT NULL — plus jurisdiction, which is one word and useless to add later because nobody
 * revisits it. Everything else the library holds (summary, version, clauses, obligations,
 * expiry, CELEX) is real work that belongs on the regulation's own page, and asking for it
 * here would just push people back to leaving the requirement unlinked. The created entry is
 * a stub on purpose, and the caller says so.
 */

import React, { useState } from 'react';
import { Loader2, Plus, Scale, X } from 'lucide-react';
import { createRegulation } from '../../services';
import type { Regulation } from '../../types';

interface Props {
  /** Prefills the reference code — usually whatever the operator typed while searching. */
  initialReferenceCode?: string;
  /** Who to record as the author. */
  actor?: string;
  onCancel: () => void;
  /** The new regulation, already persisted. The caller selects it and reloads. */
  onCreated: (regulation: Regulation) => void | Promise<void>;
}

const InlineRegulationCreator: React.FC<Props> = ({
  initialReferenceCode, actor, onCancel, onCreated,
}) => {
  const [referenceCode, setReferenceCode] = useState(initialReferenceCode ?? '');
  const [title, setTitle] = useState('');
  const [jurisdiction, setJurisdiction] = useState('EU');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = referenceCode.trim().length > 0 && title.trim().length > 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createRegulation({
        referenceCode: referenceCode.trim(),
        title: title.trim(),
        jurisdiction: jurisdiction.trim() || undefined,
        notes: 'Added from the TCF requirement editor as a stub — summary, version and clauses still to be filled in.',
      }, actor);
      await onCreated(created);
    } catch (err: any) {
      // `createRegulation` already translates a duplicate reference code into a sentence.
      setError(err?.message ?? 'Could not add the regulation.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-2 border-sky-200 bg-sky-50/50 rounded-lg p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-sky-900 flex items-center gap-1.5">
          <Scale size={13} /> Add to the Regulation library
        </span>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-700" title="Cancel">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
        <div>
          <label className="block text-[10px] font-bold text-muted uppercase mb-1">
            Reference code <span className="text-rose-600">*</span>
          </label>
          <input
            autoFocus
            value={referenceCode}
            onChange={e => setReferenceCode(e.target.value)}
            placeholder="Directive 2011/65/EU"
            className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-muted uppercase mb-1">Jurisdiction</label>
          <input
            value={jurisdiction}
            onChange={e => setJurisdiction(e.target.value)}
            placeholder="EU"
            className="w-24 border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-bold text-muted uppercase mb-1">
          Title <span className="text-rose-600">*</span>
        </label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Restriction of Hazardous Substances (RoHS)"
          className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-sky-400"
        />
      </div>

      <p className="text-[10px] text-muted leading-relaxed">
        This creates a stub. Its summary, version, clauses and obligations are filled in on the
        regulation's own page — the requirement only needs the citation to exist.
      </p>

      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-white rounded-md font-medium">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!valid || saving}
          className="px-3 py-1.5 bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-40 rounded-md text-xs font-medium shadow flex items-center gap-1.5"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {saving ? 'Adding…' : 'Add regulation'}
        </button>
      </div>
    </div>
  );
};

export default InlineRegulationCreator;
