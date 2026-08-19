-- 113: Segment-level translation memory for the IM module.
--
-- Until now the only translation reuse in the system was a session-only Map in
-- src/services/ai/translation.service.ts, keyed on the WHOLE HTML fragment. Two
-- sections whose safety paragraph differs by a single word therefore share
-- nothing, and closing the browser tab throws the lot away. Every re-authored
-- boilerplate paragraph -- the same disposal, cleaning, warranty and warning text
-- retyped across category templates -- is paid for again in every target
-- language, and a corrected wording can only be chased by hand.
--
-- This migration adds the durable half: one row per (source segment, target
-- locale) with full provenance, plus an append-only log of every reuse DECISION
-- so leverage is measurable per language and per domain instead of asserted.
--
-- The segmentation/normalization/placeholder layer that produces the keys lives
-- in src/services/im/im-tm-*.ts. This schema stores its output; it does not
-- reimplement any of it. Column-to-code mapping, since the names differ slightly:
--
--   source_key           <- SegmentKeys.segmentKey       (im-tm-key.ts)
--   plain_key            <- SegmentKeys.plainKeyHash
--   context_key          <- SegmentKeys.contextHash
--   source_fingerprint   <- SegmentKeys.sourceFingerprint
--   placeholdered_source <- PlaceholderedSegment.patternText
--   raw_source           <- Segment.rawText
--   placeholder_types    <- ExtractedPlaceholder.type[], ORDERED
--   token_identities     <- SegmentToken.identity[], ORDERED
--
-- Data-model decisions worth stating, because each has a cheaper-looking
-- alternative that is expensive to unwind later:
--
--   * LOCALE, not language. source_locale/target_locale hold a full locale code
--     ('de' today, 'de-AT' when it is wanted). The JSONB content keys in
--     im_sections / im_blocks stay 2-letter ISO 639-1 and are deliberately NOT
--     migrated: a bare 'de' row means "language-neutral German, valid for every
--     de-* market". Retrieval asks for a fallback chain (['de-AT','de']) and must
--     never auto-apply a hit whose locale distance is greater than zero. The TM is
--     therefore locale-correct from day one at the cost of one extra column, and
--     the day im_markets grows per-market variants nothing has to be rewritten.
--     NEVER backfill 'de' -> 'de-DE'. That would assert a region nobody chose,
--     silently making every existing row a fallback miss for Austria and a false
--     exact match for Germany.
--
--   * APPROVED-ONLY AUTO-APPLY is a hard rule, enforced in three places: RLS
--     refuses a born-approved insert, the guard trigger refuses approval without a
--     recorded reviewer and refuses mutating an approved row's linguistic payload,
--     and the client tier logic (im-tm-similarity.ts tierFor) refuses to
--     auto-apply anything not approved. Unreviewed machine output may serve as a
--     fuzzy REFERENCE only. This is the one rule that cannot be retrofitted:
--     published snapshots inherit poisoned content and there is no un-poisoning
--     pass.
--
--   * DEPRECATE + INSERT, never edit. An approved segment's target text is
--     immutable; a correction deprecates the row and inserts a replacement linked
--     by supersedes_id. That is why the dedupe unique index is PARTIAL on
--     status <> 'deprecated' -- a retired row must stop occupying the key.
--
--   * domain_category_id is TEXT with no foreign key. im_templates.category_id is
--     itself TEXT (verified against the live database) while categories_l3.id is
--     UUID, so this column mirrors im_templates.category_id byte-for-byte and a
--     category-less blank template simply stores NULL.
--
--   * NO Postgres enums and NO updated_at trigger, per house style: CHECK
--     constraints for closed value sets, and the service supplies updated_at in
--     its payload. The reuse log is append-only and carries created_at only.
--
--   * Do NOT try to unify source_fingerprint with the enSourceHash marker in
--     im-translation-marker.ts. They do different jobs: the marker hash is djb2
--     over RAW HTML so that any edit at all invalidates it, while these keys are
--     over NORMALIZED, PLACEHOLDERED text so that cosmetic whitespace does not.
--     Someone will eventually propose merging them; this is why not.

-- --- 0. Extension -------------------------------------------------------------
--
-- pg_trgm backs the fuzzy-recall index. Installed now, while the table is empty,
-- because adding a GIN index to a populated TM later means either a long
-- ACCESS EXCLUSIVE lock or CREATE INDEX CONCURRENTLY, and the latter cannot run
-- inside the single-transaction migration style this repo uses.
--
-- SHARP EDGE: with the extension in `extensions`, the similarity() function, the
-- % operator and gin_trgm_ops are NOT on the default search_path. Every function
-- touching them below sets `search_path = public, extensions`, and the index names
-- extensions.gin_trgm_ops explicitly. Forgetting either is the standard way this
-- migration appears to work while silently never using the index.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- --- 1. The segment store -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.im_tm_segments (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_locale         TEXT        NOT NULL,                       -- 'en' / 'en-GB'
  target_locale         TEXT        NOT NULL,                       -- 'de' / 'de-AT'
  source_key            TEXT        NOT NULL,                       -- 32 hex; the exact-match key
  plain_key             TEXT        NOT NULL,                       -- formatting-insensitive; FUZZY RECALL ONLY
  context_key           TEXT,                                       -- neighbours + container; NULL = not captured
  source_fingerprint    TEXT        NOT NULL,                       -- byte-level hash of raw_source
  placeholdered_source  TEXT        NOT NULL,                       -- normalized, placeholders substituted
  raw_source            TEXT        NOT NULL,                       -- verbatim slice; lets a re-normalize rebuild the corpus
  target_text           TEXT        NOT NULL,                       -- PLACEHOLDERED target, not thawed HTML
  placeholder_types     TEXT[]      NOT NULL DEFAULT '{}',          -- ORDERED; order is load-bearing for re-injection
  token_identities      TEXT[]      NOT NULL DEFAULT '{}',          -- ORDERED chip/format marker identities
  placeholder_safe      BOOLEAN     NOT NULL DEFAULT FALSE,         -- re-injection into another segment is provably safe
  container             TEXT,                                       -- 'p' / 'td' / 'h2' / 'root', for reporting
  anchor_path           TEXT,                                       -- structural path, to re-find a row after an edit
  domain_category_id    TEXT,                                       -- mirrors im_templates.category_id; NULL = category-less
  domain_content_type   TEXT        CHECK (domain_content_type IS NULL OR domain_content_type IN
                                      ('safety','installation','operation','cleaning','maintenance',
                                       'disposal','warranty','specs','other')),
  origin                TEXT        NOT NULL CHECK (origin IN ('human','machine','imported','supplier')),
  status                TEXT        NOT NULL DEFAULT 'unreviewed'
                                      CHECK (status IN ('unreviewed','approved','deprecated')),
  regulatory_refs       TEXT[]      NOT NULL DEFAULT '{}',          -- e.g. {'(EU) 2019/2016','EN 60335-1'}
  segmentation_version  INTEGER     NOT NULL,
  normalization_version INTEGER     NOT NULL,
  placeholder_version   INTEGER     NOT NULL,
  usage_count           INTEGER     NOT NULL DEFAULT 0,
  last_used_at          TIMESTAMPTZ,
  reviewed_by           TEXT,                                       -- profiles.email of the approver
  reviewed_at           TIMESTAMPTZ,
  deprecated_at         TIMESTAMPTZ,
  deprecated_reason     TEXT,
  supersedes_id         UUID        REFERENCES public.im_tm_segments(id) ON DELETE SET NULL,
  source_ref            TEXT,                                       -- vendor file / import label, for supplier-scoped invalidation
  created_by            TEXT,                                       -- JWT-verified email, stamped server-side
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.im_tm_segments.source_key IS
  'Hash of the placeholdered, normalized source plus the source locale, the ordered placeholder type signature and the segmentation/normalization/placeholder versions. Produced by buildSegmentKeys in src/services/im/im-tm-key.ts.';
COMMENT ON COLUMN public.im_tm_segments.plain_key IS
  'As source_key but with inline formatting markers stripped. FUZZY RECALL ONLY -- it must never ground an auto-apply, because target word order makes re-deriving tag positions impossible and a silent emphasis change in a regulated instruction is a real defect.';
COMMENT ON COLUMN public.im_tm_segments.target_text IS
  'The PLACEHOLDERED target, not thawed HTML. Values and chips are re-injected at read time by reassembleFragment; storing thawed HTML would bake one fragment''s concrete chips into a row that other fragments need to reuse.';
COMMENT ON COLUMN public.im_tm_segments.placeholder_types IS
  'Ordered placeholder types. ORDER IS LOAD-BEARING: re-injection maps {{Pn}} by position, so a row whose ordered types differ from the querying segment''s must not be auto-applied even on a text match.';
COMMENT ON COLUMN public.im_tm_segments.token_identities IS
  'Ordered chip/image/formatting marker identities of the source segment, so a candidate whose marker multiset differs can be rejected before any text is written.';
COMMENT ON COLUMN public.im_tm_segments.placeholder_safe IS
  'FALSE when the target''s grammar would depend on a placeholder value (a numeral counting a noun, an ordinal, a sentence-initial value). Such a row is stored with literal values and may never lend its target to a segment with different values.';
COMMENT ON COLUMN public.im_tm_segments.source_locale IS
  'FULL locale code. A bare 2-letter code means "language-neutral, valid for every regional variant" -- it is NOT shorthand for the majority market and must never be backfilled to one.';
COMMENT ON COLUMN public.im_tm_segments.target_locale IS
  'FULL locale code. See source_locale. Retrieval resolves a fallback chain and must not auto-apply a hit from a parent locale.';
COMMENT ON COLUMN public.im_tm_segments.status IS
  'Only ''approved'' may be auto-applied into content. ''unreviewed'' may serve as a fuzzy reference to the translation engine. ''deprecated'' is excluded from retrieval entirely and releases its slot in the dedupe index.';
COMMENT ON COLUMN public.im_tm_segments.origin IS
  'Where the target came from. DERIVED SERVER-SIDE from the caller''s declared path, never accepted from the browser: a client able to claim origin=''human'' for model output is the cheapest possible way to poison this table, and it would happen by accident rather than by attack.';
COMMENT ON COLUMN public.im_tm_segments.supersedes_id IS
  'The approved row this one replaces. Corrections are deprecate-then-insert so published content keeps a traceable lineage instead of silently changing meaning underneath it.';
COMMENT ON COLUMN public.im_tm_segments.source_ref IS
  'Vendor file name or import label, so a whole supplier''s contribution can be invalidated in one action when it proves unreliable.';
COMMENT ON COLUMN public.im_tm_segments.raw_source IS
  'The verbatim frozen slice of source HTML. Kept so the corpus can be re-keyed under a new segmentation or normalization version without re-translating anything.';

-- Dedupe key. Nullable columns need coalesce() in an EXPRESSION index, and the
-- index is PARTIAL so a deprecated row releases the key for its replacement.
--
-- NOTE for the service layer: PostgREST cannot express ON CONFLICT ... WHERE, so a
-- partial index is NOT usable as an upsert arbiter. Writes must select-then-insert
-- and tolerate a 23505 race by re-reading. Discovering this in production is
-- unpleasant, hence the comment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_im_tm_segments_dedupe
  ON public.im_tm_segments (
    source_locale,
    target_locale,
    source_key,
    coalesce(context_key, ''),
    coalesce(domain_category_id, ''),
    coalesce(domain_content_type, ''),
    segmentation_version
  )
  WHERE status <> 'deprecated';

-- Exact/perfect lookup: one query covers a whole run's worth of keys.
CREATE INDEX IF NOT EXISTS idx_im_tm_segments_exact
  ON public.im_tm_segments (target_locale, source_key, status)
  WHERE status <> 'deprecated';

-- Fallback-chain lookup by base language, without a generated column.
CREATE INDEX IF NOT EXISTS idx_im_tm_segments_base_lang
  ON public.im_tm_segments (split_part(target_locale, '-', 1), split_part(source_locale, '-', 1), status);

-- Formatting-insensitive recall.
CREATE INDEX IF NOT EXISTS idx_im_tm_segments_plain
  ON public.im_tm_segments (target_locale, plain_key)
  WHERE status <> 'deprecated';

-- Fuzzy recall. gin_trgm_ops MUST be schema-qualified -- the extension is not on
-- the default search_path.
CREATE INDEX IF NOT EXISTS idx_im_tm_segments_trgm
  ON public.im_tm_segments USING GIN (placeholdered_source extensions.gin_trgm_ops);

-- Approval queue: the highest-leverage unreviewed rows first, so scarce review
-- attention lands where it saves the most.
CREATE INDEX IF NOT EXISTS idx_im_tm_segments_queue
  ON public.im_tm_segments (status, target_locale, usage_count DESC);

-- Invalidation criteria.
CREATE INDEX IF NOT EXISTS idx_im_tm_segments_reg_refs
  ON public.im_tm_segments USING GIN (regulatory_refs);
CREATE INDEX IF NOT EXISTS idx_im_tm_segments_domain
  ON public.im_tm_segments (domain_category_id, domain_content_type, status);

-- --- 2. Governance guard ------------------------------------------------------

create or replace function public.im_tm_segments_governance_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  caller_email text;
  is_admin boolean;
begin
  -- Service role / SQL console (auth.uid() is null) bypasses RLS anyway and must
  -- not be bricked, exactly as migration 110's guard does.
  --
  -- CONSEQUENCE, stated plainly: a Netlify function using SUPABASE_SERVICE_ROLE_KEY
  -- is NOT protected by the rules below and must enforce them in code. The two
  -- mitigations are mandatory -- such a function may only ever write
  -- status='unreviewed', and APPROVAL MUST NEVER GO THROUGH A SERVER FUNCTION.
  -- Approval happens in the browser under the admin's own JWT so that RLS and this
  -- trigger both apply, which means there is no server-side approval endpoint to
  -- compromise in the first place.
  if auth.uid() is null then
    if tg_op = 'UPDATE' then
      new.updated_at := coalesce(new.updated_at, now());
    end if;
    return new;
  end if;

  select p.email, upper(coalesce(p.role, '')) = 'ADMIN'
    into caller_email, is_admin
    from public.profiles p
   where p.id = auth.uid();

  if tg_op = 'INSERT' then
    if new.status = 'approved' then
      raise exception 'A translation-memory segment cannot be created already approved -- insert it unreviewed and approve it as a separate, audited act';
    end if;
    return new;
  end if;

  -- Becoming approved: admin only, and the reviewer must be recorded.
  --
  -- A four-eyes rule (reviewed_by <> created_by) is deliberately NOT enforced here.
  -- This deployment has a very small number of admin accounts, so a hard
  -- constraint would routinely make approval impossible and be experienced as a
  -- bug rather than as a control. Both identities are stored instead, so a report
  -- can surface self-approvals and reviewed_by is available as an invalidation
  -- criterion -- meaning one careless reviewer's batch can be revoked in a single
  -- action. Turning this into a hard rule later is a three-line change here.
  if new.status = 'approved' and old.status <> 'approved' then
    if not coalesce(is_admin, false) then
      raise exception 'Only an administrator can approve a translation-memory segment';
    end if;
    if new.reviewed_by is null or new.reviewed_at is null then
      raise exception 'Approving a translation-memory segment requires a recorded reviewer and review timestamp';
    end if;
  end if;

  -- An approved segment's linguistic payload is immutable. Corrections go
  -- deprecate-then-insert (supersedes_id) so that published content keeps a
  -- traceable lineage instead of silently changing meaning underneath it.
  if old.status = 'approved' and new.status = 'approved' then
    if new.target_text          is distinct from old.target_text
      or new.placeholdered_source is distinct from old.placeholdered_source
      or new.source_key           is distinct from old.source_key
      or new.placeholder_types    is distinct from old.placeholder_types
      or new.token_identities     is distinct from old.token_identities
      or new.source_locale        is distinct from old.source_locale
      or new.target_locale        is distinct from old.target_locale
    then
      raise exception 'An approved translation-memory segment is immutable -- deprecate it and insert a replacement linked by supersedes_id';
    end if;
  end if;
  -- usage_count, last_used_at, regulatory_refs and a transition to 'deprecated'
  -- stay writable on an approved row by design: the counters are how the review
  -- queue is prioritized, and retirement must always remain possible.

  if new.status = 'deprecated' and old.status <> 'deprecated' then
    new.deprecated_at := coalesce(new.deprecated_at, now());
  end if;

  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_im_tm_segments_governance ON public.im_tm_segments;
CREATE TRIGGER trg_im_tm_segments_governance
  BEFORE INSERT OR UPDATE ON public.im_tm_segments
  FOR EACH ROW EXECUTE FUNCTION public.im_tm_segments_governance_guard();

-- --- 3. The reuse log ---------------------------------------------------------
--
-- Append-only, matching im_translation_imports. run_kind and source_chars are the
-- two columns that are unrecoverable if omitted: a log you have to backfill is a
-- log you do not have. run_kind='xliff_export' additionally lets the import path
-- answer "did we pre-fill this unit?" without a second table.

CREATE TABLE IF NOT EXISTS public.im_tm_reuse_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID        NOT NULL,                         -- groups one translate / export / import run
  run_kind            TEXT        NOT NULL CHECK (run_kind IN ('ai','xliff_export','xliff_import','manual')),
  scope               TEXT        NOT NULL CHECK (scope IN ('template','block','project')),
  template_id         UUID        REFERENCES public.im_templates(id) ON DELETE SET NULL,
  block_id            UUID        REFERENCES public.im_blocks(id)    ON DELETE SET NULL,
  project_id          UUID,                                         -- no FK: deleting a project must not erase the audit trail
  template_type       TEXT,
  fragment_id         TEXT,                                         -- '<sectionId>#inline:3' etc.
  segment_index       INTEGER     NOT NULL,
  source_locale       TEXT        NOT NULL,
  target_locale       TEXT        NOT NULL,
  tier                TEXT        NOT NULL CHECK (tier IN ('perfect','exact','fuzzy_high','fuzzy_low','miss')),
  match_percent       INTEGER     CHECK (match_percent IS NULL OR (match_percent BETWEEN 0 AND 100)),
  locale_distance     INTEGER     NOT NULL DEFAULT 0,               -- 0 = requested locale, >0 = fallback
  matched_segment_id  UUID        REFERENCES public.im_tm_segments(id) ON DELETE SET NULL,
  applied             BOOLEAN     NOT NULL DEFAULT FALSE,           -- written into content without a model call
  reference_only      BOOLEAN     NOT NULL DEFAULT FALSE,           -- handed to the model as a minimal-edit reference
  domain_category_id  TEXT,
  domain_content_type TEXT,
  source_chars        INTEGER     NOT NULL,                         -- the leverage denominator
  decided_by          TEXT,                                         -- JWT-verified email
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.im_tm_reuse_log.tier IS
  'The retrieval tier this decision landed in. Reported per tier and NEVER blended into a single leverage percentage: "we reused 62%" hides whether that was safe 100% matches or risky near-matches somebody had to rewrite by hand.';
COMMENT ON COLUMN public.im_tm_reuse_log.source_chars IS
  'Character count of the source segment -- the denominator for cost-avoidance reporting. Cannot be reconstructed after the fact, which is why it is captured at decision time.';
COMMENT ON COLUMN public.im_tm_reuse_log.applied IS
  'TRUE only when the stored target was written into content with no model call. A reference handed to the engine is reference_only, not applied; conflating the two overstates leverage.';

CREATE INDEX IF NOT EXISTS idx_im_tm_reuse_log_locale_time
  ON public.im_tm_reuse_log (target_locale, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_im_tm_reuse_log_run
  ON public.im_tm_reuse_log (run_id);
CREATE INDEX IF NOT EXISTS idx_im_tm_reuse_log_domain
  ON public.im_tm_reuse_log (domain_category_id, tier, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_im_tm_reuse_log_template
  ON public.im_tm_reuse_log (template_id, run_kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_im_tm_reuse_log_fragment
  ON public.im_tm_reuse_log (template_id, target_locale, fragment_id, occurred_at DESC);

-- --- 4. Termbase extension ----------------------------------------------------
--
-- translation_verbatims already implements the termbase-as-CONSTRAINT design the
-- TM needs: phrases are frozen by freezeVerbatims so the model physically cannot
-- alter them, and the approved target wording is substituted on thaw. It is not a
-- lookup-and-paste dictionary and must not become one. These columns only add the
-- traceability and locale hooks the TM's invalidation paths need.
--
-- Note translation_verbatims.created_by is UUID here, while
-- im_tm_segments.created_by is TEXT (an email). That is inconsistent, and
-- deliberately NOT "harmonized" in this migration -- changing an existing column's
-- type is a separate, riskier change than adding a table.

ALTER TABLE public.translation_verbatims
  ADD COLUMN IF NOT EXISTS regulatory_ref      TEXT,
  ADD COLUMN IF NOT EXISTS is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS locale_translations JSONB  NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.translation_verbatims.regulatory_ref IS
  'Regulation this phrase derives from, e.g. ''(EU) 2019/2016''. Lets an invalidation campaign by regulatory reference also list the verbatims it affects.';
COMMENT ON COLUMN public.translation_verbatims.is_active IS
  'FALSE retires a phrase from freezing without deleting it -- the record of what was protected when must survive, because it is the evidence for past published manuals.';
COMMENT ON COLUMN public.translation_verbatims.locale_translations IS
  'Locale-keyed overrides ({"de-AT": "..."}) layered over the 2-letter `translations` map. Readers resolve locale_translations[locale] ?? translations[lang], so nothing existing has to move.';

-- --- 5. Retrieval and reporting functions ------------------------------------
--
-- All SECURITY INVOKER, so RLS still governs what a caller can see. These are not
-- anon-facing, so SECURITY DEFINER would only strip away protection we want.
-- Precedent: 80_im_block_section_usage_security_invoker.sql.

-- Fuzzy candidate recall. Returns candidates ORDERED BY trigram similarity, which
-- is a RECALL device only.
--
-- SHARP EDGE: the number written into im_tm_reuse_log.match_percent and shown to an
-- operator must come from the token-level scorer in im-tm-similarity.ts, NOT from
-- trigram similarity. Trigram is character-based and would rate '2.5 l' against
-- '25 l' as a near match -- exactly the failure mode the token scorer exists to
-- prevent. If a trigram score ever leaks into the log, the reported percentages
-- stop matching what humans see and the leverage reporting becomes untrustworthy.
create or replace function public.im_tm_fuzzy_candidates(
  p_source          text,
  p_source_locale   text,
  p_target_locales  text[],
  p_min_similarity  real    default 0.45,
  p_limit           integer default 30,
  p_domain_category text    default null
)
returns setof public.im_tm_segments
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  -- Transaction-local: the % operator reads this GUC and the instance default is
  -- not ours to rely on.
  perform set_config('pg_trgm.similarity_threshold', p_min_similarity::text, true);
  return query
    select s.*
      from public.im_tm_segments s
     where s.status <> 'deprecated'
       and s.target_locale = any(p_target_locales)
       and split_part(s.source_locale, '-', 1) = split_part(p_source_locale, '-', 1)
       and s.placeholdered_source % p_source
       and (p_domain_category is null
            or s.domain_category_id is null
            or s.domain_category_id = p_domain_category)
     order by extensions.similarity(s.placeholdered_source, p_source) desc, s.usage_count desc
     limit least(p_limit, 100);
end;
$$;

-- Atomic usage counters. Doing this as a read-modify-write from the browser under a
-- concurrent translate pool loses increments, and it has to work on APPROVED rows,
-- which the guard trigger deliberately permits.
create or replace function public.im_tm_note_used(p_ids uuid[])
returns void
language sql
set search_path = public
as $$
  update public.im_tm_segments
     set usage_count = usage_count + 1,
         last_used_at = now(),
         updated_at = now()
   where id = any(p_ids);
$$;

-- Leverage aggregation. Returns rows PER (locale, domain, tier) and deliberately
-- offers no blended percentage -- see the column comment on im_tm_reuse_log.tier.
create or replace function public.im_tm_leverage(
  p_from           timestamptz default null,
  p_to             timestamptz default null,
  p_target_locales text[]      default null,
  p_template_id    uuid        default null
)
returns table (
  target_locale      text,
  domain_category_id text,
  tier               text,
  events             bigint,
  chars              bigint,
  applied_events     bigint,
  applied_chars      bigint
)
language sql
stable
set search_path = public
as $$
  select l.target_locale,
         l.domain_category_id,
         l.tier,
         count(*)::bigint,
         coalesce(sum(l.source_chars), 0)::bigint,
         count(*) filter (where l.applied)::bigint,
         coalesce(sum(l.source_chars) filter (where l.applied), 0)::bigint
    from public.im_tm_reuse_log l
   where (p_from is null or l.occurred_at >= p_from)
     and (p_to   is null or l.occurred_at <  p_to)
     and (p_target_locales is null or l.target_locale = any(p_target_locales))
     and (p_template_id is null or l.template_id = p_template_id)
   group by 1, 2, 3;
$$;

REVOKE ALL ON FUNCTION public.im_tm_fuzzy_candidates(text, text, text[], real, integer, text) FROM public;
REVOKE ALL ON FUNCTION public.im_tm_note_used(uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.im_tm_leverage(timestamptz, timestamptz, text[], uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.im_tm_fuzzy_candidates(text, text, text[], real, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.im_tm_note_used(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.im_tm_leverage(timestamptz, timestamptz, text[], uuid) TO authenticated;

-- --- 6. Row level security ----------------------------------------------------

ALTER TABLE public.im_tm_segments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.im_tm_reuse_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Segments: everyone signed in reads (retrieval is the entire point) and inserts
  -- (authoring produces candidates), nobody inserts an approved row, only an admin
  -- deletes. Approval itself is gated by the trigger, which RLS cannot express.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_tm_segments' AND policyname='Auth read') THEN
    CREATE POLICY "Auth read" ON public.im_tm_segments FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_tm_segments' AND policyname='Auth insert unreviewed') THEN
    CREATE POLICY "Auth insert unreviewed" ON public.im_tm_segments FOR INSERT TO authenticated
      WITH CHECK (status <> 'approved');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_tm_segments' AND policyname='Auth update') THEN
    CREATE POLICY "Auth update" ON public.im_tm_segments FOR UPDATE TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_tm_segments' AND policyname='Admin delete') THEN
    CREATE POLICY "Admin delete" ON public.im_tm_segments FOR DELETE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(coalesce(p.role,'')) = 'ADMIN'));
  END IF;

  -- Reuse log: an audit trail. Insert and read for everyone signed in; NO update
  -- and NO delete policy at all, so it is append-only through the API even for an
  -- administrator.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_tm_reuse_log' AND policyname='Auth read') THEN
    CREATE POLICY "Auth read" ON public.im_tm_reuse_log FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_tm_reuse_log' AND policyname='Auth insert') THEN
    CREATE POLICY "Auth insert" ON public.im_tm_reuse_log FOR INSERT TO authenticated
      WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
