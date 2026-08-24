/**
 * Admin console → IM Print: the global print typography the PDF exporter renders with.
 *
 * WHY this screen exists. The exported booklet's typography was not one decision in one
 * place: the font family came from the IM template's metadata, and a template is bound to a
 * product category — so the same booklet program printed in a different font per category —
 * while sizes, line spacing and page margins were hardcoded in the renderer and needed a
 * code deploy to change. This is now one admin-owned house style.
 *
 * Four profiles, laid out as two cards per document kind. Product category is deliberately
 * NOT an axis; the two that remain are the ones that genuinely need different values:
 *   - a compact Warning Leaflet must fit a few pages (~6pt) where a full manual is set at
 *     ~10.8pt, so they cannot share one profile without one of them becoming unusable;
 *   - A5 needs a smaller scale than A4 for the same content.
 *
 * Each card saves independently — one bad value can't block the other three — and the
 * service clamps to the same ranges the table's CHECK constraints enforce, so a saved value
 * is always a renderable one.
 */

import React, { useEffect, useState } from 'react';
import { Type, Loader2, RotateCcw, Check } from 'lucide-react';
import {
  getPrintSettings,
  savePrintSettingsProfile,
  defaultTypographyFor,
  PRINT_FONT_FAMILIES,
  PRINT_SETTING_LIMITS,
  type PrintSettingsProfile,
} from '../../services';
import { IM_TEMPLATE_TYPE_LABELS, type IMTemplateType } from '../../types';

const profileTitle = (p: PrintSettingsProfile) =>
  `${IM_TEMPLATE_TYPE_LABELS[p.templateType] ?? p.templateType} · ${p.pageSize.toUpperCase()}`;

const key = (p: { templateType: string; pageSize: string }) => `${p.templateType}::${p.pageSize}`;

const MM_PER_PT = 25.4 / 72;
const PAGE_HEIGHT_MM: Record<string, number> = { a4: 297, a5: 210 };

/**
 * What the point size and line spacing actually buy on the page.
 *
 * "Line spacing ×" on its own is ambiguous — it is a multiplier of the font size, and nothing
 * on the screen said what that came to in millimetres or how many lines a page then holds.
 * Since those two numbers are what decide the page count, they are shown next to the fields
 * that produce them.
 */
const lineBudget = (p: PrintSettingsProfile) => {
  const mmPerLine = p.bodyPt * p.lineHeight * MM_PER_PT;
  const textHeightMm = (PAGE_HEIGHT_MM[p.pageSize] ?? 297) - p.margins.top - p.margins.bottom;
  return { mmPerLine, linesPerPage: mmPerLine > 0 ? Math.floor(textHeightMm / mmPerLine) : 0 };
};

/** A labelled number input bound to one numeric field of a profile. */
const NumField: React.FC<{
  label: string;
  suffix: string;
  value: number;
  limits: { min: number; max: number; step: number };
  onChange: (n: number) => void;
}> = ({ label, suffix, value, limits, onChange }) => (
  <label className="block">
    <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
      {label} <span className="font-normal normal-case tracking-normal text-gray-400">({suffix})</span>
    </span>
    <input
      type="number"
      min={limits.min}
      max={limits.max}
      step={limits.step}
      value={value}
      // An emptied field must not become 0 (0pt text renders invisible) — hold the last
      // valid value instead and let the operator finish typing.
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-400"
    />
  </label>
);

const ProfileCard: React.FC<{
  profile: PrintSettingsProfile;
  onChange: (next: PrintSettingsProfile) => void;
  onSave: () => Promise<void>;
  dirty: boolean;
  saving: boolean;
  savedAt: boolean;
  error?: string;
}> = ({ profile, onChange, onSave, dirty, saving, savedAt, error }) => {
  const L = PRINT_SETTING_LIMITS;
  const set = (patch: Partial<PrintSettingsProfile>) => onChange({ ...profile, ...patch });
  const setMargin = (side: keyof PrintSettingsProfile['margins'], n: number) =>
    onChange({ ...profile, margins: { ...profile.margins, [side]: n } });
  const builtIn = defaultTypographyFor(profile.templateType, profile.pageSize);

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h4 className="font-semibold text-gray-800 text-sm">{profileTitle(profile)}</h4>
          <p className="text-[11px] text-muted mt-0.5">
            {profile.templateType === 'warning_leaflet'
              ? 'Compact layout — every element uses the body size, every heading the heading size.'
              : 'Body copy, section titles, table of contents and the back page.'}
          </p>
        </div>
        <button
          onClick={() => onChange({ ...profile, ...builtIn })}
          title="Reset this profile to the built-in defaults"
          className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-600 whitespace-nowrap"
        >
          <RotateCcw size={12} /> Defaults
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Font</span>
          <select
            value={profile.fontFamily}
            onChange={(e) => set({ fontFamily: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            style={{ fontFamily: `'${profile.fontFamily}', Arial, sans-serif` }}
          >
            {PRINT_FONT_FAMILIES.map((f) => (
              <option key={f} value={f} style={{ fontFamily: `'${f}', Arial, sans-serif` }}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <NumField label="Body text" suffix="pt" value={profile.bodyPt} limits={L.bodyPt} onChange={(n) => set({ bodyPt: n })} />
        <NumField label="Headings" suffix="pt" value={profile.headingPt} limits={L.headingPt} onChange={(n) => set({ headingPt: n })} />
        <NumField label="Line spacing" suffix="×" value={profile.lineHeight} limits={L.lineHeight} onChange={(n) => set({ lineHeight: n })} />
        <div />

        <p className="col-span-2 -mt-1 text-[11px] text-gray-500">
          {profile.bodyPt}pt × {profile.lineHeight} ={' '}
          <strong className="font-semibold text-gray-600">{lineBudget(profile).mmPerLine.toFixed(2)}mm</strong> per line
          {' → ~'}
          <strong className="font-semibold text-gray-600">{lineBudget(profile).linesPerPage}</strong> lines per{' '}
          {profile.pageSize.toUpperCase()} page at these margins.
        </p>

        <div className="col-span-2 pt-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Content density</span>
          <div className="grid grid-cols-3 gap-2">
            <NumField
              label="Cell padding"
              suffix="mm"
              value={profile.tableCellPaddingMm}
              limits={L.tableCellPaddingMm}
              onChange={(n) => set({ tableCellPaddingMm: n })}
            />
            <NumField
              label="Block spacing"
              suffix="mm"
              value={profile.blockSpacingMm}
              limits={L.blockSpacingMm}
              onChange={(n) => set({ blockSpacingMm: n })}
            />
            <NumField
              label="Paragraph spacing"
              suffix="em"
              value={profile.paragraphSpacingEm}
              limits={L.paragraphSpacingEm}
              onChange={(n) => set({ paragraphSpacingEm: n })}
            />
            <NumField
              label="Table rules"
              suffix="mm"
              value={profile.tableBorderMm}
              limits={L.tableBorderMm}
              onChange={(n) => set({ tableBorderMm: n })}
            />
            <NumField
              label="Table text"
              suffix="x body"
              value={profile.tableFontScale}
              limits={L.tableFontScale}
              onChange={(n) => set({ tableFontScale: n })}
            />
            <NumField
              label="Max image height"
              suffix="mm"
              value={profile.cellImageMaxHeightMm}
              limits={L.cellImageMaxHeightMm}
              onChange={(n) => set({ cellImageMaxHeightMm: n })}
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            Cell padding applies to each side of every table cell, so a row costs twice this value
            on top of its text; it was fixed at ~2.12mm, more than a whole line box at this body
            size. Block spacing is the gap above and below tables, images, callouts, step lists and
            legends — previously a fixed 8.5mm on every page size. The image cap stops one
            illustration from setting its row height and stretching the text beside it to match.
          </p>
          <p className="text-[11px] text-gray-400 mt-1">
            Where an image sits — inline, wrapped left or right, or centred on its own line — stays
            an author decision, set per image with the Align control in the block editor.
          </p>
          <p className="text-[11px] text-gray-400 mt-1">
            Paragraph spacing is the gap after every paragraph and list, in em of body size (list
            items take 0.3x it). It was a hardcoded 1em — a web default, and 0.83 of a line box at
            this body size. Table text is a ratio of body size, floored at 6pt so it cannot shrink
            safety content without limit. Table rules
            were a fixed 1px — 0.75pt in print, against 6.65pt cell text. 0 draws no rules; below
            about 0.09mm a hairline risks dropping out on press.
          </p>
        </div>

        <div className="col-span-2 pt-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Page margins (mm)</span>
          <div className="grid grid-cols-4 gap-2">
            <NumField label="Top" suffix="mm" value={profile.margins.top} limits={L.marginTop} onChange={(n) => setMargin('top', n)} />
            <NumField label="Bottom" suffix="mm" value={profile.margins.bottom} limits={L.marginBottom} onChange={(n) => setMargin('bottom', n)} />
            <NumField label="Left" suffix="mm" value={profile.margins.left} limits={L.marginLeft} onChange={(n) => setMargin('left', n)} />
            <NumField label="Right" suffix="mm" value={profile.margins.right} limits={L.marginRight} onChange={(n) => setMargin('right', n)} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            The bottom margin also holds the stamped running footer and page number (min{' '}
            {L.marginBottom.min}mm). Keep left/right at 10mm or more on multi-language booklets —
            the language edge tabs are ~8mm wide and content would print under them.
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}

      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={() => void onSave()}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt && !dirty && (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <Check size={13} /> Saved
          </span>
        )}
        {dirty && !saving && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>
    </div>
  );
};

const PrintSettingsAdminSection: React.FC = () => {
  const [profiles, setProfiles] = useState<PrintSettingsProfile[]>([]);
  // The last saved state, so "dirty" is a real comparison rather than a flag that a failed
  // save would leave lying. Keyed by templateType::pageSize.
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const snapshot = (p: PrintSettingsProfile) =>
    JSON.stringify([p.fontFamily, p.bodyPt, p.headingPt, p.lineHeight, p.margins]);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await getPrintSettings();
      setProfiles(rows);
      setBaseline(Object.fromEntries(rows.map((r) => [key(r), snapshot(r)])));
    } catch (e) {
      console.error('[PrintSettingsAdminSection] loading print settings failed:', e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const update = (next: PrintSettingsProfile) =>
    setProfiles((prev) => prev.map((p) => (key(p) === key(next) ? next : p)));

  const save = async (profile: PrintSettingsProfile) => {
    const k = key(profile);
    setSavingKey(k);
    setErrors((prev) => ({ ...prev, [k]: '' }));
    try {
      // The service clamps out-of-range values, so take back what was actually stored —
      // otherwise the form would keep showing a number the renderer will not use.
      const stored = await savePrintSettingsProfile(profile);
      setProfiles((prev) => prev.map((p) => (key(p) === k ? stored : p)));
      setBaseline((prev) => ({ ...prev, [k]: snapshot(stored) }));
      setSavedKeys((prev) => ({ ...prev, [k]: true }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErrors((prev) => ({
        ...prev,
        [k]: /permission|denied|row-level/i.test(message)
          ? 'Only an administrator can change the print settings.'
          : `Could not save: ${message}`,
      }));
    } finally {
      setSavingKey(null);
    }
  };

  const groups: IMTemplateType[] = ['im', 'warning_leaflet'];

  return (
    <div>
      <div className="px-6 py-4 bg-light border-b border-gray-200">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Type size={17} className="text-indigo-600" /> Print typography
        </h3>
        <p className="text-xs text-muted mt-0.5 max-w-3xl">
          One global house style for every exported PDF — font, text and heading size, line
          spacing and page margins, per page size. It is intentionally <strong>not</strong> per
          product category: the font used to come from each category's IM template, so the same
          booklet program could print in a different font depending on where it was generated.
          Changes apply to the next PDF generated; already-rendered PDFs are unaffected.
        </p>
      </div>

      {loading ? (
        <div className="px-6 py-10 flex items-center gap-2 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading print settings…
        </div>
      ) : (
        <div className="px-6 py-5 space-y-6">
          {groups.map((templateType) => {
            const group = profiles.filter((p) => p.templateType === templateType);
            if (!group.length) return null;
            return (
              <div key={templateType}>
                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">
                  {IM_TEMPLATE_TYPE_LABELS[templateType] ?? templateType}
                </h4>
                <div className="grid lg:grid-cols-2 gap-4">
                  {group.map((p) => (
                    <ProfileCard
                      key={key(p)}
                      profile={p}
                      onChange={update}
                      onSave={() => save(p)}
                      dirty={baseline[key(p)] !== snapshot(p)}
                      saving={savingKey === key(p)}
                      savedAt={!!savedKeys[key(p)]}
                      error={errors[key(p)] || undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PrintSettingsAdminSection;
