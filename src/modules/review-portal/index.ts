/**
 * The shared supplier review portal.
 *
 * `ReviewPortalShell` is everything a reviewer does that has nothing to do with WHAT they
 * are reviewing; a surface supplies the document and the anchor. Two surfaces exist today —
 * the Instruction Manual's `<IMViewer>` (in src/pages/im/IMReviewPortal.tsx, because the
 * viewer is the IM module's) and `PdfReviewCanvas` here.
 */

export { ReviewPortalShell, default as ReviewPortalShellDefault } from './ReviewPortalShell';
export type { ReviewPortalShellProps, ReviewSurfaceRenderProps } from './ReviewPortalShell';
// NOT re-exported: PdfReviewCanvas pulls pdf.js in at module scope, and a barrel export
// would drag it into the main chunk for anything that imports this file. Import it
// lazily from its own path — see src/pages/design/DesignSpecReviewPortal.tsx.
export type { PdfReviewCanvasProps } from './PdfReviewCanvas';
export { anchorLabel, anchorExcerpt, anchorSortKey, orderByAnchor } from './anchor-labels';
