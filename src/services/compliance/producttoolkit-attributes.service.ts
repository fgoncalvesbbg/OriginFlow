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
 * The API has no authentication by design (anyone who can reach the URL can read it), so
 * these are plain GETs with no credentials attached.
 *
 * Trust boundary: the definitions are human-curated — "which attributes the team decided
 * matter for this category" — NOT a live read of Akeneo's own family requirements. They
 * can lag the PIM. Nothing here is auto-applied; rows land in the import preview where a
 * person confirms them.
 */
import type { ParsedAttributeRow } from '../../utils/attribute-csv-import.utils';
import { mapGroupName } from '../../utils/attribute-csv-import.utils';
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

/** One attribute of GET /definitions/{l3}. */
export interface PtAttribute {
  akeneoCode: string;
  displayName?: string;
  fieldType?: string;
  cluster?: string;
  options?: string[];
  eprelId?: string | null;
  required?: boolean;
  sortOrder?: number;
}

/**
 * ProductToolkit could not be reached at all — almost always "the operator is off the
 * internal network", not "the service is broken". Callers should say so plainly rather
 * than presenting it as a failure of the import.
 */
export class ProductToolkitUnavailableError extends Error {
  constructor(public readonly url: string, cause?: unknown) {
    super(
      `Could not reach ProductToolkit at ${url}. This API is published only on the internal ` +
      `network, so it is unreachable off the VPN. If you are on the network, the host's TLS ` +
      `certificate may not be trusted by this browser — that also surfaces as a connection failure.`,
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // A DNS failure, a refused connection, a timeout and an untrusted certificate are all
    // indistinguishable here — the browser deliberately hides which. All mean "unreachable".
    throw new ProductToolkitUnavailableError(url, err);
  }
  if (res.status === 404) return { status: 404, body: null };
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
 * Dropped on the way through, because `category_attributes` has nowhere to put them:
 * `sortOrder` (OriginFlow orders by group then name) and `eprelId`.
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

    // Reuse the CSV importer's cluster→group table so one mapping serves both sources. It
    // also strips ProductToolkit's leading numbering ("2. Standard Electric Specs").
    const { group, unmapped: groupUnmapped } = mapGroupName(rawCluster);
    if (groupUnmapped) {
      flags.push(
        `Cluster "${rawCluster || '(blank)'}" has no matching group — filed under Category Specific. ` +
        `Change the Group in the preview if it belongs elsewhere.`,
      );
    }

    const options = a.options ?? [];
    if (dataType === 'enum' && options.length === 0) {
      flags.push("The definition doesn't restrict this select's options — Akeneo's own option list applies.");
    }

    const name = (a.displayName ?? '').trim() || a.akeneoCode;
    if (!(a.displayName ?? '').trim()) {
      flags.push('No display name in the definition — using the Akeneo code as the name.');
    }

    return {
      name,
      akeneoId: a.akeneoCode?.trim() || undefined,
      group,
      dataType,
      enumOptions: dataType === 'enum' ? options : undefined,
      required: a.required === true ? true : undefined,
      flags,
      rawGroup: rawCluster,
      rawDataType: rawFieldType,
    };
  });
