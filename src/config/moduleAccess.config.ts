/**
 * Module access configuration — the single list of modules gated to Super Admins.
 *
 * This is the one place to edit when a module goes into or comes out of testing.
 * Both the route table (`SuperAdminRoute` in App.tsx) and the sidebar (Layout.tsx)
 * read from here, so a module can never be hidden from the nav while still being
 * reachable by typing its URL — the failure mode that makes "hidden" modules leak.
 *
 * The tier is a flag on top of the existing role, not a fourth UserRole: ~30 RLS
 * policies hardcode `upper(role) = 'ADMIN'`, so a distinct role value would
 * silently strip a super admin's admin rights. See migration 154.
 *
 * Scope: this is a VISIBILITY gate for work in progress, not a security boundary.
 * The underlying tables keep whatever RLS they already had, so a determined admin
 * with the API key can still reach the data. Gate the tables too if a module ever
 * needs to hide data rather than hide an unfinished screen.
 */

/**
 * Path prefixes only a Super Admin may see. A prefix covers the module's whole
 * subtree: '/sourcing' also gates '/sourcing/create' and '/sourcing/:id'.
 */
export const SUPER_ADMIN_ONLY_PATH_PREFIXES: readonly string[] = [
  // The Attribute Viewer, which absorbed the SKU Catalog in Phase 3 of
  // docs/originflow-attribute-viewer-merge-plan.md.
  //
  // WHY THIS GREW TO COVER '/attributes': before the merge, '/attributes' was a read-and-flag
  // screen open to every authenticated user, and '/products' — which could add, delete,
  // bulk-overwrite, finalize and export SKUs — was gated here. Merging them onto one page moved
  // those destructive capabilities onto the open URL. Rather than widen who can delete a SKU as
  // a side effect of a refactor, the merged module stays gated until somebody decides otherwise.
  // Removing '/attributes' from this list is the deliberate act of opening it up.
  '/attributes',
  // Kept so the old bookmark is gated the same way; '/products' now just redirects.
  '/products',
  // The Roadmap Creator (migration 167). Gated because the port is INCOMPLETE, not because the
  // data is sensitive: the board, marks, placeholders and import work, but the Step-Up Chart,
  // History and Summary tabs are not built yet. Its real access model is RLS —
  // is_roadmap_editor() for annotation writes, and no write policy at all on the two reference
  // tables. Removing this line is the deliberate act of launching it.
  '/roadmap',
  // NOTE: '/design-specs' was listed here while the module was under construction and was
  // removed deliberately when it launched to all users. The module's real access model was
  // never this gate — it is the DESIGNER role and the is_design_editor() write policies from
  // migration 163, plus the can_see_project() read policies, all of which are unchanged: an
  // ADMIN or DESIGNER sees every spec, a PM sees the specs of the projects they own.
];

/**
 * True when `pathname` falls inside a Super-Admin-only module.
 *
 * Matches the prefix exactly or as a path segment boundary, so '/products' never
 * accidentally gates a future '/products-report' route.
 */
export const isSuperAdminOnlyPath = (pathname: string): boolean =>
  SUPER_ADMIN_ONLY_PATH_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
