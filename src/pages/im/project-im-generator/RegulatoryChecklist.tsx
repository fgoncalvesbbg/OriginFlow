/**
 * The regulatory checklist — the obligations a PERSON has to confirm by hand, grouped BY
 * REGULATION, because an obligation only means something next to the regulation imposing it.
 *
 * Lives in its own module because it now has two homes: the pre-publish review panel shows it
 * inline at the publish gate (where the whole point is to see it before committing), and the
 * editor's side rail opens it on its own, so it can be worked through while editing rather
 * than only at the end.
 *
 * It never blocks a publish — see services/regulatory/regulation-checklist.ts: a checklist
 * that blocks only teaches people to tick everything.
 */

import React, { useState } from 'react';
import { CheckSquare, ChevronDown, ChevronRight, ChevronsRight, Loader2, Scale, Square } from 'lucide-react';
import type {
  ChecklistItemState,
  ChecklistItemStatus,
  ChecklistRegulationGroup,
  ChecklistSummary,
} from '../../../services';

export interface RegulatoryChecklistProps {
  /** Checklist items grouped by the regulation that states them. */
  regulationGroups: ChecklistRegulationGroup[];
  /** This manual's confirmations, keyed by item key. */
  checklistState: Record<string, ChecklistItemState>;
  /** The TEMPLATE author's decisions — shown as context, never applied. */
  templateChecklistState: Record<string, ChecklistItemState>;
  checklistSummary: ChecklistSummary;
  /** Item currently being written, if any. */
  checklistBusyKey: string | null;
  checklistError?: string;
  onDecide: (key: string, status: ChecklistItemStatus | null) => void;
}

/**
 * The whole "Regulatory checklist" block — collapsible for the same reason the issue groups
 * above are: with several regulations each listing several obligations, a fully-decided
 * checklist would otherwise sit expanded at the bottom of the panel forever. Starts open
 * while anything is still outstanding, collapsed once everything is confirmed/n-a — nothing
 * left to review is exactly the state that doesn't need to stay in view.
 */
export const RegulatoryChecklistSection: React.FC<RegulatoryChecklistProps> = ({
  regulationGroups, checklistState, templateChecklistState, checklistSummary,
  checklistBusyKey, checklistError, onDecide,
}) => {
  const [expanded, setExpanded] = useState(checklistSummary.open > 0);

  return (
    <div className="border border-emerald-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-emerald-50 border-b border-emerald-200 text-left hover:bg-emerald-100/60"
      >
        <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-800 flex items-center gap-1.5">
          {expanded
            ? <ChevronDown size={13} className="shrink-0" />
            : <ChevronRight size={13} className="shrink-0" />}
          <Scale size={13} /> Regulatory checklist
        </div>
        <div className="text-[10px] font-semibold text-emerald-700 whitespace-nowrap">
          {checklistSummary.done} confirmed
          {checklistSummary.na > 0 && <> · {checklistSummary.na} n/a</>}
          {checklistSummary.open > 0
            ? <> · {checklistSummary.open} to review</>
            : <> · all {checklistSummary.total} decided</>}
        </div>
      </button>
      {expanded && (
        <>
          <p className="text-[11px] text-muted px-3 pt-2 leading-relaxed">
            What the regulations applying to this template oblige a person to verify by hand.
            Optional — an unticked item just records that nobody confirmed it, and never blocks
            a publish.
          </p>
          <div className="divide-y divide-gray-100 mt-1">
            {regulationGroups.map(group => (
              <RegulationChecklistGroup
                key={group.regulationId}
                group={group}
                state={checklistState}
                templateState={templateChecklistState}
                busyKey={checklistBusyKey}
                onDecide={onDecide}
              />
            ))}
          </div>
          {checklistError && (
            <p className="text-[11px] text-rose-700 bg-rose-50 border-t border-rose-200 px-3 py-1.5">
              {checklistError}
            </p>
          )}
        </>
      )}
    </div>
  );
};

/**
 * One regulation's items. Collapsible, and collapsed by default once every item under it is
 * decided: a settled regulation is exactly the thing a reviewer should not have to scroll past
 * to reach the one that still needs work.
 */
const RegulationChecklistGroup: React.FC<{
  group: ChecklistRegulationGroup;
  state: Record<string, ChecklistItemState>;
  templateState: Record<string, ChecklistItemState>;
  busyKey: string | null;
  onDecide: (key: string, status: ChecklistItemStatus | null) => void;
}> = ({ group, state, templateState, busyKey, onDecide }) => {
  const open = group.items.filter(i => !state[i.key]).length;
  const [expanded, setExpanded] = useState(open > 0);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-1.5 px-3 py-2 text-left hover:bg-light"
      >
        {expanded
          ? <ChevronDown size={13} className="mt-0.5 shrink-0 text-gray-400" />
          : <ChevronRight size={13} className="mt-0.5 shrink-0 text-gray-400" />}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-gray-800 font-mono truncate">{group.referenceCode}</div>
          <div className="text-[11px] text-gray-500 truncate" title={group.title}>{group.title}</div>
        </div>
        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
          open === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {open === 0 ? `${group.items.length} decided` : `${open} of ${group.items.length}`}
        </span>
      </button>
      {expanded && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-light/40">
          {group.items.map(item => {
            const decided = state[item.key];
            const busy = busyKey === item.key;
            const done = decided?.status === 'done';
            const na = decided?.status === 'na';
            // An obligation two regulations both state is ONE item with ONE confirmation —
            // say so, or the same row looks unconfirmed under the other citation.
            const shared = item.regulationReferences.filter(r => r !== group.referenceCode);
            const fromTemplate = templateState[item.key];
            return (
              <li key={item.key} className="flex items-start gap-2 px-3 py-2">
                <button
                  onClick={() => onDecide(item.key, done ? null : 'done')}
                  disabled={busy}
                  title={done ? 'Clear this confirmation' : 'Mark as taken into account'}
                  className="shrink-0 mt-0.5 disabled:opacity-40"
                >
                  {busy
                    ? <Loader2 size={15} className="animate-spin text-gray-400" />
                    : done
                      ? <CheckSquare size={15} className="text-emerald-600" />
                      : <Square size={15} className={na ? 'text-gray-300' : 'text-gray-400'} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs leading-snug ${na ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {item.text}
                  </p>
                  {(decided || shared.length > 0) && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {decided && (
                        <>
                          {done ? 'Confirmed' : 'Not applicable'}
                          {decided.updatedBy ? ` by ${decided.updatedBy}` : ''}
                        </>
                      )}
                      {decided && shared.length > 0 && ' — '}
                      {shared.length > 0 && (
                        <>also required by <span className="font-mono">{shared.join(' · ')}</span></>
                      )}
                    </p>
                  )}
                  {/* Provenance, not inheritance: the template author's decision is shown,
                      never applied. */}
                  {fromTemplate && (
                    <p className="text-[10px] text-gray-400 italic">
                      Template: {fromTemplate.status === 'done' ? 'covered' : 'not applicable'}
                      {fromTemplate.updatedBy ? ` — ${fromTemplate.updatedBy}` : ''}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onDecide(item.key, na ? null : 'na')}
                  disabled={busy}
                  title={na ? 'This item applies after all' : 'Not applicable to this manual'}
                  className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border disabled:opacity-40 ${
                    na
                      ? 'bg-gray-100 text-gray-600 border-gray-300'
                      : 'text-gray-400 border-gray-200 hover:text-gray-600 hover:border-gray-300'
                  }`}
                >
                  N/A
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/**
 * The checklist as a standalone side-rail panel.
 *
 * Same section, its own chrome. Opening it from the rail is the "work through this while
 * editing" path; the publish gate keeps showing the section inline, where it belongs at the
 * moment of committing.
 */
export const RegulatoryChecklistPanel: React.FC<RegulatoryChecklistProps & { onClose: () => void }> = ({
  onClose, ...checklist
}) => (
  <div className="w-[23rem] shrink-0 bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden">
    <div className="px-3 py-2.5 bg-light border-b border-gray-200 flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
          <Scale size={14} className={checklist.checklistSummary.open > 0 ? 'text-amber-500' : 'text-emerald-600'} />
          Regulatory checklist
        </div>
        <p className="text-[11px] text-muted mt-0.5">
          {checklist.regulationGroups.length === 0
            ? 'No regulations are assigned to this template.'
            : checklist.checklistSummary.open > 0
              ? `${checklist.checklistSummary.open} of ${checklist.checklistSummary.total} still to review.`
              : `All ${checklist.checklistSummary.total} decided.`}
        </p>
      </div>
      <button onClick={onClose} title="Collapse this panel" className="shrink-0 p-1 text-gray-400 hover:text-gray-700">
        <ChevronsRight size={15} />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto p-3">
      {checklist.regulationGroups.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">
          Assign regulations to this template to get a checklist here.
        </p>
      ) : (
        <RegulatoryChecklistSection {...checklist} />
      )}
    </div>
  </div>
);
