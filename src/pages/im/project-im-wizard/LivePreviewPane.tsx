/**
 * LivePreviewPane — shows the manual chapter(s) the active wizard answer affects, resolved
 * live via the same `resolveManual()` the published output uses (no separate "preview"
 * endpoint or resolution path — see the wizard plan §8).
 *
 * Deliberately narrower than the full editor preview: only the section(s) the active
 * question's registry entry references (`sectionIds`, computed once per template load by
 * `getWizardQuestions` itself) are rendered. A question with no referenced section
 * shouldn't normally happen — `getWizardQuestions` already filters the question list down
 * to referenced-only placeholders — but is handled defensively rather than crashing.
 *
 * Project-level content overlays (sectionAdditions/extraSections/sectionOverrides/
 * sectionSkus/blockOverrides/skuContent) are read from the last-SAVED `instance`, not from
 * ProjectIMGenerator's live in-memory edit state for those: the wizard never touches them,
 * so the saved snapshot is accurate for everything except the placeholder value itself,
 * which `buildCandidateData` overlays fresh on every render.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { NodeRenderer } from '../../../modules/im-viewer/NodeRenderer';
import { resolveManual } from '../../../services';
import {
  CategoryAttribute, IMBlock, IMSection, IMTemplate, IMTemplateType, ProjectIM, ProjectSku, WizardQuestion,
} from '../../../types';
import { PREVIEW_SECTION_ATTR, findPreviewSection, previewScrollTopFor } from '../project-im-generator/preview-scroll.utils';

interface LivePreviewPaneProps {
  template: IMTemplate;
  sections: IMSection[];
  blocksById: Record<string, IMBlock>;
  attributesById: Record<string, CategoryAttribute>;
  projectSkus: ProjectSku[];
  boundSkuIds: string[];
  instance: ProjectIM | null;
  templateType: IMTemplateType;
  activeLang: string;
  activeQuestion: WizardQuestion | null;
  /** The value currently being edited for `activeQuestion` (not necessarily saved yet), so
   *  the preview updates on every keystroke, not just when the active question changes. */
  activeValue: string;
  buildCandidateData: (overrideKey: string, overrideValue: string) => Record<string, string>;
}

const HIGHLIGHT_MS = 1200;

const LivePreviewPane: React.FC<LivePreviewPaneProps> = ({
  template, sections, blocksById, attributesById, projectSkus, boundSkuIds, instance, templateType,
  activeLang, activeQuestion, activeValue, buildCandidateData,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [highlightSectionId, setHighlightSectionId] = useState<string | null>(null);

  const placeholderData = activeQuestion
    ? buildCandidateData(activeQuestion.key, activeValue)
    : buildCandidateData('', '');

  const resolverIM: ProjectIM = {
    id: instance?.id ?? '',
    templateId: template.id,
    templateType,
    placeholderData,
    skuContent: instance?.skuContent ?? {},
    status: instance?.status ?? 'draft',
    updatedAt: new Date().toISOString(),
    sectionAdditions: instance?.sectionAdditions ?? {},
    extraSections: instance?.extraSections ?? [],
    sectionOverrides: instance?.sectionOverrides ?? {},
    boundSkuIds,
    sectionSkus: instance?.sectionSkus ?? {},
    blockOverrides: instance?.blockOverrides ?? {},
  };

  const skuRefs = projectSkus.map((s) => ({ id: s.id, skuNumber: s.skuNumber }));
  const resolved = resolveManual(template, sections, blocksById, resolverIM, activeLang, skuRefs, attributesById);

  const relevantSectionIds = new Set(activeQuestion?.sectionIds ?? []);
  const relevantSections = resolved.sections.filter((s) => relevantSectionIds.has(s.id));
  const firstRelevantId = relevantSections[0]?.id ?? null;

  // Scroll + flash-highlight the first affected section whenever the active QUESTION
  // changes (not on every keystroke — re-scrolling under the cursor on every keystroke
  // would be disorienting), reusing the exact anchor vocabulary/technique "Show in
  // preview" already uses elsewhere in this editor.
  useEffect(() => {
    if (!firstRelevantId) return;
    const scroller = scrollerRef.current;
    if (scroller) {
      const target = findPreviewSection(scroller, firstRelevantId);
      if (target) scroller.scrollTop = previewScrollTopFor(scroller, target);
    }
    setHighlightSectionId(firstRelevantId);
    const t = setTimeout(() => setHighlightSectionId(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuestion?.key]);

  if (!activeQuestion) {
    return <div className="p-6 text-sm text-gray-400 italic">Select a question to preview its chapter.</div>;
  }

  if (relevantSections.length === 0) {
    return (
      <div className="p-6 flex items-start gap-2 text-sm text-gray-400 italic">
        <AlertCircle size={16} className="shrink-0 mt-0.5" />
        No preview available for this question — it isn't referenced in any chapter of this manual.
      </div>
    );
  }

  return (
    <div ref={scrollerRef} className="h-full overflow-y-auto p-4 space-y-4">
      {relevantSections.map((section) => (
        <div
          key={section.id}
          {...{ [PREVIEW_SECTION_ATTR]: section.id }}
          className={`rounded-lg p-2 transition-colors duration-500 ${highlightSectionId === section.id ? 'bg-indigo-50 ring-2 ring-indigo-200' : ''}`}
        >
          {section.title && <div className="font-bold text-sm text-gray-700 mb-2">{section.title}</div>}
          {section.nodes.map((node) => (
            // im-resolver.ts's ResolvedNode (src/types/im.types.ts) and the viewer's own
            // ManualNode (modules/im-viewer/types.ts) are meant to be kept in sync and are
            // for every node this pane renders, EXCEPT annotated_image_set: the resolver's
            // AnnotatedImage.alt/caption/annotations[].label are still per-language records
            // at this point (im-resolver.ts passes AnnotatedImageSetContent.images straight
            // through, unlocalized — a pre-existing shape gap in im-resolver.ts, out of
            // scope for this file, which must not modify im-resolver.ts). Cast rather than
            // touch either type: every field NodeRenderer actually reads for the node kinds
            // this wizard preview shows (html/callout) is identical either way.
            <NodeRenderer key={node.id} node={node as any} language={activeLang} />
          ))}
        </div>
      ))}
    </div>
  );
};

export default LivePreviewPane;
