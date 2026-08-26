/**
 * TranslationStatusPanel — which chapters are still missing which language, docked beside
 * the editor.
 *
 * The translation state used to be readable only as a count on a button, with the detail
 * behind a modal you had to close to act on anything. Every row here is a jump into the
 * editor instead: clicking one opens that chapter with that language active, which is the
 * only way to actually close the gap (editing it in English would not).
 *
 * Grouped BY LANGUAGE rather than by chapter, because that is how the work is done — a
 * translator, or an auto-translate run, goes through one language at a time.
 *
 * Holds no rules of its own: the gaps arrive already computed as publish issues (see
 * publish-issues.ts), and auto-translation is a callback back to the page.
 */

import React, { useState } from 'react';
import { CheckCircle, ChevronDown, ChevronRight, ChevronsRight, Globe, Languages, Sparkles } from 'lucide-react';
import type { PublishIssue } from './publish-issues';

interface TranslationStatusPanelProps {
  /** Only the `translation` issues, rebuilt by the parent so a filled gap leaves at once. */
  issues: PublishIssue[];
  /** Every language this manual produces besides English (the source). */
  otherLanguages: string[];
  languageName: (code: string) => string;
  /** Distinct chapters still untranslated in at least one language. */
  untranslatedCount: number;
  onJump: (issue: PublishIssue) => void;
  activeIssueKey: string | null;
  /** Opens the existing auto-translate dialog. Absent while the manual is locked. */
  onAutoTranslate?: () => void;
  /** Collapse back to the side rail. */
  onClose: () => void;
}

/** One language's outstanding chapters. Collapsed once that language is complete. */
const LanguageGroup: React.FC<{
  lang: string;
  label: string;
  issues: PublishIssue[];
  activeIssueKey: string | null;
  onJump: (issue: PublishIssue) => void;
}> = ({ lang, label, issues, activeIssueKey, onJump }) => {
  const [expanded, setExpanded] = useState(issues.length > 0);
  const complete = issues.length === 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className={`w-full flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-1 ${
          complete ? 'text-emerald-700' : 'text-amber-600'
        }`}
      >
        {expanded
          ? <ChevronDown size={12} className="shrink-0" />
          : <ChevronRight size={12} className="shrink-0" />}
        {complete ? <CheckCircle size={13} /> : <Globe size={13} />}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {/* Status carries a word, never colour alone. */}
        <span className="text-gray-400 font-normal">
          {complete ? 'complete' : `${issues.length} left`}
        </span>
      </button>
      {expanded && (
        complete ? (
          <p className="text-[11px] text-muted mb-1.5 leading-relaxed">
            Every project-authored chapter has {lang.toUpperCase()} content.
          </p>
        ) : (
          <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
            {issues.map(issue => (
              <li key={issue.key}>
                <button
                  type="button"
                  onClick={() => onJump(issue)}
                  title={`Open this chapter with ${lang.toUpperCase()} active`}
                  className={`group w-full text-left px-2.5 py-2 flex items-start gap-2 transition-colors ${
                    issue.key === activeIssueKey ? 'bg-slate-100' : 'hover:bg-amber-50 text-gray-700'
                  }`}
                >
                  <div className="min-w-0 flex-1 text-xs font-medium leading-snug">{issue.label}</div>
                  <ChevronRight size={13} className="mt-0.5 shrink-0 text-gray-300 group-hover:text-gray-600" />
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
};

export const TranslationStatusPanel: React.FC<TranslationStatusPanelProps> = ({
  issues, otherLanguages, languageName, untranslatedCount, onJump, activeIssueKey,
  onAutoTranslate, onClose,
}) => {
  const byLang = new Map<string, PublishIssue[]>();
  for (const lang of otherLanguages) byLang.set(lang, []);
  for (const issue of issues) {
    if (!issue.lang) continue;
    const list = byLang.get(issue.lang);
    if (list) list.push(issue);
    else byLang.set(issue.lang, [issue]);
  }

  return (
    <div className="w-[23rem] shrink-0 bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 bg-light border-b border-gray-200 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
            <Languages size={14} className={untranslatedCount === 0 ? 'text-emerald-600' : 'text-amber-500'} />
            Translations
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            {otherLanguages.length === 0
              ? 'English only.'
              : untranslatedCount === 0
                ? 'Every chapter is translated.'
                : `${untranslatedCount} chapter${untranslatedCount === 1 ? '' : 's'} outstanding.`}
          </p>
        </div>
        <button onClick={onClose} title="Collapse this panel" className="shrink-0 p-1 text-gray-400 hover:text-gray-700">
          <ChevronsRight size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {otherLanguages.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">
            This manual only produces English, so there is nothing to translate.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-muted leading-relaxed">
              {untranslatedCount === 0
                ? `Every project-authored chapter is translated into all ${otherLanguages.length} language${otherLanguages.length === 1 ? '' : 's'}.`
                : `${untranslatedCount} chapter${untranslatedCount === 1 ? '' : 's'} still need work. Click any row to open it with that language active — editing it in English would not close the gap.`}
            </p>

            {onAutoTranslate && (
              <button
                onClick={onAutoTranslate}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-indigo-600 border border-dashed border-indigo-300 rounded hover:bg-indigo-50 transition-colors"
              >
                <Sparkles size={12} /> Review &amp; auto-translate…
              </button>
            )}

            {Array.from(byLang.entries()).map(([lang, langIssues]) => (
              <LanguageGroup
                key={lang}
                lang={lang}
                label={languageName(lang)}
                issues={langIssues}
                activeIssueKey={activeIssueKey}
                onJump={onJump}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

/** Icon the side rail uses for this panel. Exported so the rail and the panel can't drift. */
export const TranslationPanelIcon = Languages;

export default TranslationStatusPanel;
