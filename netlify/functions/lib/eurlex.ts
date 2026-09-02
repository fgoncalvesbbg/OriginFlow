/**
 * EUR-Lex version lookup — the pure half, so the SPARQL shape and the verdict logic can
 * be tested without a network.
 *
 * WHAT QUESTION THIS ANSWERS: "is the edition of this EU act that OriginFlow records still
 * the current one?" The answer comes from three facts CELLAR holds about a work:
 *
 *   * cdm:act_consolidated_consolidates_resource_legal (INBOUND) — every consolidated
 *     version of the act. The newest one's date is the real "as it stands today" date.
 *   * cdm:resource_legal_amends_resource_legal (INBOUND) — every amending act, and when.
 *   * cdm:resource_legal_date_end-of-validity — '9999-12-31' means still in force;
 *     any real date in the past means repealed.
 *
 * These predicate names are not guesses. They were found by enumerating the inbound
 * predicates on the LVD's work IRI against the live endpoint on 2026-09-02; the obvious
 * candidates (`resource_legal_consolidated_by`, `resource_legal_amended_by_resource_legal`)
 * exist in the ontology but carry no triples for these acts and return empty silently —
 * which is the failure mode this comment exists to prevent someone rediscovering.
 *
 * The endpoint is public, unauthenticated, and answers a batched VALUES query for the
 * whole library in one round trip.
 */

export const EURLEX_SPARQL_ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';

/** CELLAR's sentinel for "no end of validity" — the act is still in force. */
export const NO_END_OF_VALIDITY = '9999-12-31';

export type VersionState = 'current' | 'newer_available' | 'repealed' | 'not_found' | 'error';

export interface EurLexFacts {
  celex: string;
  /** cdm:work_date_document — the date of the act itself. */
  documentDate?: string;
  /** '9999-12-31' when still in force. */
  endOfValidity?: string;
  /** Newest consolidated CELEX, e.g. "02014L0035-20260530". */
  latestConsolidated?: string;
  /** Date parsed out of `latestConsolidated`'s suffix. */
  latestConsolidatedOn?: string;
  amendments?: number;
  lastAmendedOn?: string;
}

/**
 * Build the batched query. `MAX(?cc)` over consolidated CELEX numbers is a lexical max,
 * which is also the chronological one because the date suffix is zero-padded yyyymmdd —
 * the one place string ordering and date ordering coincide, and worth stating because it
 * looks like a bug. The amendment date is aggregated separately with MAX over the DATE,
 * since amending-act CELEX numbers do NOT sort chronologically.
 */
export const buildVersionQuery = (celexes: string[]): string => {
  const values = celexes
    .map(c => `"${c.replace(/[^A-Za-z0-9()-]/g, '')}"^^xsd:string`)
    .join(' ');
  return `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?celex
       (SAMPLE(?d) AS ?documentDate)
       (SAMPLE(?e) AS ?endOfValidity)
       (MAX(?cc) AS ?latestConsolidated)
       (COUNT(DISTINCT ?a) AS ?amendments)
       (MAX(?ad) AS ?lastAmendedOn)
WHERE {
  VALUES ?celex { ${values} }
  ?w cdm:resource_legal_id_celex ?celex .
  OPTIONAL { ?w cdm:work_date_document ?d }
  OPTIONAL { ?w cdm:resource_legal_date_end-of-validity ?e }
  OPTIONAL { ?c cdm:act_consolidated_consolidates_resource_legal ?w ; cdm:resource_legal_id_celex ?cc }
  OPTIONAL { ?a cdm:resource_legal_amends_resource_legal ?w . OPTIONAL { ?a cdm:work_date_document ?ad } }
}
GROUP BY ?celex`;
};

/** The consolidation date encoded in a consolidated CELEX suffix, or null. */
export const consolidatedDate = (celex: string | undefined): string | undefined => {
  const m = (celex ?? '').match(/-(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
};

interface SparqlBinding { [k: string]: { value: string } | undefined }

/** Turn the SPARQL JSON results into facts keyed by CELEX. */
export const parseVersionResults = (json: any): Map<string, EurLexFacts> => {
  const out = new Map<string, EurLexFacts>();
  const bindings: SparqlBinding[] = json?.results?.bindings ?? [];
  for (const b of bindings) {
    const celex = b.celex?.value;
    if (!celex) continue;
    const latestConsolidated = b.latestConsolidated?.value || undefined;
    const amendments = b.amendments?.value ? Number(b.amendments.value) : undefined;
    out.set(celex, {
      celex,
      documentDate: b.documentDate?.value || undefined,
      endOfValidity: b.endOfValidity?.value || undefined,
      latestConsolidated,
      latestConsolidatedOn: consolidatedDate(latestConsolidated),
      amendments: Number.isFinite(amendments) ? amendments : undefined,
      lastAmendedOn: b.lastAmendedOn?.value || undefined,
    });
  }
  return out;
};

/**
 * The verdict.
 *
 * `known` is the newest date OriginFlow already records for the regulation — its
 * `last_amended_at`, falling back to `issued_at`. Anything EUR-Lex reports after that date
 * is something we have not accounted for.
 *
 * Deliberately NOT clever about the difference between a consolidation and an amendment:
 * both mean "the text an operator would download today is not the text this row describes",
 * which is the only thing the badge claims. A repeal outranks both, because a newer version
 * of a repealed act is not the interesting fact about it.
 */
export const decideState = (
  facts: EurLexFacts | undefined,
  known: string | null | undefined,
  today = new Date().toISOString().slice(0, 10),
): VersionState => {
  if (!facts) return 'not_found';

  const eov = facts.endOfValidity;
  if (eov && eov !== NO_END_OF_VALIDITY && eov <= today) return 'repealed';

  const newest = [facts.latestConsolidatedOn, facts.lastAmendedOn]
    .filter((d): d is string => !!d)
    .sort()
    .pop();

  if (!newest) return 'current';

  // No recorded date at all: we cannot claim "current" about a row that says nothing,
  // but we can say a consolidation exists that nobody has reconciled.
  const baseline = known || facts.documentDate;
  if (!baseline) return 'newer_available';

  return newest > baseline ? 'newer_available' : 'current';
};
