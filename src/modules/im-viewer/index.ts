/**
 * IM Viewer — a self-contained, portable module that renders published Instruction Manual JSON.
 * Hand it a manifest/manual URL (or object) and it renders a searchable, chaptered, zoomable
 * manual. Depends only on react, dompurify and lucide-react.
 */

export { IMViewer } from './IMViewer';
export type { IMViewerProps } from './IMViewer';
export type {
  ViewerSource,
  Manifest,
  ManifestLanguage,
  ResolvedManual,
  ManualSection,
  ManualNode,
  TemplateMetadata,
} from './types';
