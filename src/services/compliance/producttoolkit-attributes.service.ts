/**
 * Read-only client for ProductToolkit's Attribute Viewer API — the team's curated,
 * per-category attribute definitions (one CSV uploaded per category).
 *
 * WHY THIS RUNS IN THE BROWSER
 * ----------------------------
 * ProductToolkit is bound to 127.0.0.1:8787 on its host and published only as
 * https://producttoolkit.chal-tec.local via that host's nginx — an internal-network name.
 * OriginFlow has no server inside that network: the Netlify functions and the Supabase
 * edge functions both run in the cloud and cannot resolve `.local`. So there is no proxy
 * to hide behind — the fetch has to come from the operator's own browser, and it only
 * succeeds while they are on the internal network/VPN. Everything here therefore treats
 * "unreachable" as an ordinary, expected outcome rather than an error to shout about.
 *
 * AUTH AND CORS
 * These two endpoints are public: `/definitions` and `/definitions/{l3}` need no session, and
 * ProductToolkit returns `Access-Control-Allow-Origin: *`. Verified live, 2026-09-03.
 *
 * So this sends NO credentials. That is not just tidiness — a wildcard ACAO is REJECTED by
 * browsers whenever the request includes credentials, so `credentials: 'include'` would turn
 * a working call into a CORS failure. (It briefly existed here during a window when the API
 * required a session and echoed its own origin; both were reverted upstream.)
 *
 * TLS IS THE REMAINING TRAP
 * The host's certificate is issued by an internal CA:
 *     issuer  DC=local, DC=chal-tec, CN=chal-tec-SKWNAPP11-CA
 *     subject CN=producttoolkit.chal-tec.local   (expires 2028-07-26)
 * A browser without that CA installed fails at the TLS layer, and a background fetch gets no
 * certificate prompt — it simply fails, indistinguishably from the host being down. A
 * click-through exception (from visiting the host in a tab) only lasts that browser session,
 * which is exactly why this can "work once, then stop".
 *
 * Trust boundary: the definitions are human-curated — "which attributes the team decided
 * matter for this category" — NOT a live read of Akeneo's own family requirements. They
 * can lag the PIM. Nothing here is auto-applied; rows land in the import preview where a
 * person confirms them.
 */
import type { ParsedAttributeRow } from '../../utils/attribute-csv-import.utils';
import type { AttributeDataType } from '../../types';

/** Production is the internal nginx host; point VITE_PRODUCTTOOLKIT_URL at a dev instance to override. */
const DEFAULT_BASE_URL = 'https://producttoolkit.chal-tec.local/api/apps/attribute-viewer';

const baseUrl = (): string => {
  const configured = import.meta.env.VITE_PRODUCTTOOLKIT_URL as string | undefined;
  return (configured?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
};

/** How long to wait before calling it unreachable. Off-network, the failure is usually instant. */
const TIMEOUT_MS = 8000;

/** One row of GET /definitions — a category someone has uploaded a definition for. */
export interface PtDefinitionSummary {
  l3: string;
  sourceFile?: string;
  attributeCount?: number;
  uploadedAt?: string;
  uploadedBy?: string;
  akeneoCheckedAt?: string | null;
  editCount?: number;
  pendingCount?: number;
}

/**
 * One attribute of GET /definitions/{l3}.
 *
 * Verified against the live endpoint (Angled Hoods, 71 attributes): every field below is
 * actually served. `updatedAt` is documented by the ProductToolkit team but is NOT present
 * on the deployed response yet, so it is optional and nothing depends on it.
 */
export interface PtAttribute {
  /** Stable numeric id. Survives a rename of BOTH displayName and akeneoCode, which makes it
   *  the only safe join key for a re-sync — see planAttributeSync. */
  attributeId?: number;
  akeneoCode: string;
  displayName?: string;
  fieldType?: string;
  cluster?: string;
  options?: string[];
  unit?: string | null;
  eprelId?: string | null;
  /** 'global' = shared across categories, 'category' = owned by this one. Authoritative. */
  scope?: 'global' | 'category' | string;
  supplierVisible?: boolean;
  required?: boolean;
  sortOrder?: number;
  /** How many PT categories use it — context when a scope change is proposed. */
  usedByCategories?: number;
  /** Not served yet; present in the team's spec for incremental sync. */
  updatedAt?: string;
}

/**
 * ProductToolkit could not be reached at all — almost always "the operator is off the
 * internal network", not "the service is broken". Callers should say so plainly rather
 * than presenting it as a failure of the import.
 */
export class ProductToolkitUnavailableError extends Error {
  constructor(public readonly url: string, cause?: unknown) {
    super(
      `Could not reach ProductToolkit at ${url}. The browser reports a network-level failure ` +
      `and hides the reason, so check these in order:\n` +
      `1. Certificate trust — most likely. The host uses an internal CA ` +
      `(chal-tec-SKWNAPP11-CA). A browser without that CA installed fails during the TLS ` +
      `handshake, and a background request like this one gets no certificate prompt, so it ` +
      `just fails. TO CONFIRM: open ${new URL(url).origin}/api/health in this same browser — a ` +
      `certificate warning proves it, a padlock rules it out. Note a click-through exception ` +
      `lasts only for that browser session, which is why this can work once and then stop.\n` +
      `2. Not on the internal network/VPN — the host is only published there.\n` +
      `3. ProductToolkit is down, or blocking this origin.`,
    );
    this.name = 'ProductToolkitUnavailableError';
    this.cause = cause;
  }
}

const getJson = async <T>(path: string): Promise<{ status: number; body: T | null }> => {
  const url = `${baseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // Deliberately no `credentials`: these endpoints are public, and ProductToolkit returns
      // ACAO `*`, which a browser refuses to honour for a credentialed request.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // A DNS failure, a refused connection, a timeout and an untrusted certificate are all
    // indistinguishable here — the browser deliberately hides which. All mean "unreachable".
    throw new ProductToolkitUnavailableError(url, err);
  }
  if (res.status === 404) return { status: 404, body: null };
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `ProductToolkit requires a signed-in session (${res.status}). Open ` +
      `${baseUrl().replace(/\/api\/.*$/, '')}/auth/login in this browser, sign in, then retry.`,
    );
  }
  if (!res.ok) throw new Error(`ProductToolkit responded ${res.status} for ${path}`);
  return { status: res.status, body: (await res.json()) as T };
};

/**
 * Every category ProductToolkit holds a definition for. Most OriginFlow categories will not
 * appear — a definition is only there once someone has uploaded its CSV.
 */
export const getProductToolkitDefinitions = async (): Promise<PtDefinitionSummary[]> => {
  const { body } = await getJson<{ definitions?: PtDefinitionSummary[] }>('/definitions');
  return body?.definitions ?? [];
};

/**
 * The attribute list for one category, or null when no definition is loaded for it
 * (HTTP 404 / NO_DEFINITION — documented as expected and common, so not an error).
 */
export const getProductToolkitDefinition = async (l3: string): Promise<PtAttribute[] | null> => {
  const { body } = await getJson<{ attributes?: PtAttribute[] }>(
    `/definitions/${encodeURIComponent(l3)}`,
  );
  return body ? (body.attributes ?? []) : null;
};

/**
 * ProductToolkit fieldType → OriginFlow AttributeDataType.
 *
 * `multiselect` has no distinct representation here: OriginFlow stores both single- and
 * multi-select as 'enum' and decides the input mode at validation time (see
 * validateAttributeValue's 'multi-select' mode), so it maps to 'enum' and is flagged.
 * OriginFlow's 'image' type has no ProductToolkit counterpart.
 */
const mapFieldType = (raw?: string): { dataType: AttributeDataType; unmapped: boolean } => {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'text': return { dataType: 'text', unmapped: false };
    case 'integer': return { dataType: 'integer', unmapped: false };
    case 'decimal': return { dataType: 'decimal', unmapped: false };
    case 'boolean': return { dataType: 'boolean', unmapped: false };
    case 'select':
    case 'multiselect': return { dataType: 'enum', unmapped: false };
    default: return { dataType: 'text', unmapped: true };
  }
};

/**
 * Turn a ProductToolkit definition into the same preview rows the CSV importer produces, so
 * both sources feed one preview grid and one `importCategoryAttributes` write path.
 *
 * Pure and dependency-free on purpose — the network half above is what needs the VPN, this
 * half is unit-testable.
 *
 * Nothing is dropped any more: `sortOrder` lands in sort_order (migration 137), and
 * `attributeId` / `eprelId` in pt_attribute_id / eprel_id (migration 138). `scope` and
 * `supplierVisible` come through as first-class fields rather than being inferred.
 */
export const mapProductToolkitAttributes = (attrs: PtAttribute[]): ParsedAttributeRow[] =>
  attrs.map(a => {
    const flags: string[] = [];
    const rawFieldType = a.fieldType ?? '';
    const rawCluster = a.cluster ?? '';

    const { dataType, unmapped: typeUnmapped } = mapFieldType(rawFieldType);
    if (typeUnmapped) {
      flags.push(`Unrecognised field type "${rawFieldType || '(blank)'}" — defaulted to text.`);
    }
    if (rawFieldType.trim().toLowerCase() === 'multiselect') {
      flags.push('Multi-select is stored as an enum; OriginFlow decides single vs multi at entry time.');
    }

    // ProductToolkit's cluster IS the group — used verbatim, not mapped onto OriginFlow's own
    // ATTRIBUTE_GROUPS list. PT owns the taxonomy, so translating it here only created a way
    // to get it wrong: three of the six real cluster names had no match and silently collapsed
    // into "Category Specific", taking 19 attributes and their global scope with them.
    // Scope no longer rides on the group name either (PT states it per attribute), so a group
    // is now purely a display heading and any string is valid.
    const group = rawCluster.trim() || 'Category Specific';

    const options = a.options ?? [];
    if (dataType === 'enum' && options.length === 0) {
      flags.push("The definition doesn't restrict this select's options — Akeneo's own option list applies.");
    }

    const supplierVisible = a.supplierVisible === false ? false : undefined;
    const name = (a.displayName ?? '').trim() || a.akeneoCode;
    if (!(a.displayName ?? '').trim()) {
      flags.push('No display name in the definition — using the Akeneo code as the name.');
    }

    return {
      name,
      unit: (a.unit ?? '').trim() || undefined,
      akeneoId: a.akeneoCode?.trim() || undefined,
      group,
      dataType,
      enumOptions: dataType === 'enum' ? options : undefined,
      supplierVisible,
      required: a.required === true ? true : undefined,
      sortOrder: typeof a.sortOrder === 'number' ? a.sortOrder : undefined,
      ptAttributeId: typeof a.attributeId === 'number' ? a.attributeId : undefined,
      eprelId: a.eprelId ?? undefined,
      // Only the two values we understand are honoured; anything else falls back to
      // inferring scope from the group, rather than silently trusting an unknown string.
      scope: a.scope === 'global' || a.scope === 'category' ? a.scope : undefined,
      usedByCategories: typeof a.usedByCategories === 'number' ? a.usedByCategories : undefined,
      flags,
      rawGroup: rawCluster,
      rawDataType: rawFieldType,
    };
  });
