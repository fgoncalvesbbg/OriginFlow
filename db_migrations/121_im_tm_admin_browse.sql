-- 121_im_tm_admin_browse.sql
--
-- Read-side support for the Translation Memory admin console (Admin panel → Translation
-- Memory). Migration 113 built the corpus, the governance trigger and the retrieval
-- functions, but nothing that lets a human LOOK at the memory -- so nothing could ever be
-- approved, and `idx_im_tm_segments_queue` served a screen that did not exist.
--
-- Why these live in SQL rather than in the app's query builder: the vendor-neutral data
-- port (src/data/ports/database.port.ts) deliberately exposes only the operator surface
-- the app actually uses -- eq/neq/lt/lte/gt/gte/in/isNull/isNotNull/arrayContains -- with
-- no OFFSET and no text-search operator. A browsable, searchable, paginated console needs
-- both. Widening the shared port for one screen would push a new obligation onto every
-- future adapter (see PORTING.md); a named function is the seam the port already has for
-- exactly this, and it keeps the paging in the database where the row count lives.
--
-- Both functions are SECURITY INVOKER, so RLS still governs what a caller can see and no
-- privilege is created here. Same precedent as migration 113 section 5.
--
-- ADDITIVE ONLY: no table, column, policy or trigger is touched.

-- --- 1. Browse -----------------------------------------------------------------
--
-- Returns the whole row as a COMPOSITE plus the unpaged total, rather than re-listing
-- ~35 columns in the RETURNS TABLE. Two reasons: the signature cannot drift out of sync
-- when a column is added to im_tm_segments, and PostgREST nests the composite as a JSON
-- object, so the existing mapTmSegmentRow() in im-tm-lookup.service.ts reads it unchanged.
--
-- Search is `position(lower(needle) in lower(haystack)) > 0`, NOT ILIKE. A raw operator
-- search would need % and _ escaped, and the escaping bug only shows up the first time an
-- operator pastes a segment containing a percent sign -- which, in a corpus of appliance
-- manuals full of "100 % power", is immediately.
--
-- SHARP EDGE, inherited from im_tm_fuzzy_candidates: this is a substring lookup for a
-- human, not a match tier. Nothing it returns may ever be written to
-- im_tm_reuse_log.match_percent or presented as a similarity -- that number comes only
-- from the token-level scorer in im-tm-similarity.ts.
create or replace function public.im_tm_browse(
  p_status          text[]  default null,
  p_target_locales  text[]  default null,
  p_origins         text[]  default null,
  p_domain_category text    default null,
  p_search          text    default null,
  p_sort            text    default 'recent',
  p_limit           integer default 50,
  p_offset          integer default 0
)
returns table (
  segment     public.im_tm_segments,
  total_count bigint
)
language sql
stable
set search_path = public
as $$
  with filtered as (
    select s.*
      from public.im_tm_segments s
     where (p_status          is null or s.status = any(p_status))
       and (p_target_locales  is null or s.target_locale = any(p_target_locales))
       and (p_origins         is null or s.origin = any(p_origins))
       and (p_domain_category is null or s.domain_category_id = p_domain_category)
       and (
         p_search is null or btrim(p_search) = '' or
         position(lower(btrim(p_search)) in lower(s.placeholdered_source)) > 0 or
         position(lower(btrim(p_search)) in lower(s.raw_source))           > 0 or
         position(lower(btrim(p_search)) in lower(s.target_text))          > 0
       )
  )
  select f::public.im_tm_segments,
         count(*) over ()
    from filtered f
   order by
     -- 'queue' walks the review backlog the way idx_im_tm_segments_queue was built for:
     -- the segments that earn the most by being approved come first.
     case when p_sort = 'queue'  then f.usage_count end desc nulls last,
     case when p_sort = 'oldest' then f.created_at  end asc  nulls last,
     case when p_sort = 'recent' then f.updated_at  end desc nulls last,
     -- Total order, so paging can never repeat or skip a row on ties.
     f.id
   limit least(coalesce(p_limit, 50), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- --- 2. Facet counts -----------------------------------------------------------
--
-- One round trip for the console's stats strip and its locale/origin facets. Grouped
-- rather than pivoted so that adding a status or an origin needs no change here -- the
-- client pivots what it gets.
create or replace function public.im_tm_stats()
returns table (
  status        text,
  target_locale text,
  origin        text,
  n             bigint
)
language sql
stable
set search_path = public
as $$
  select s.status, s.target_locale, s.origin, count(*)::bigint
    from public.im_tm_segments s
   group by 1, 2, 3;
$$;

REVOKE ALL ON FUNCTION public.im_tm_browse(text[], text[], text[], text, text, text, integer, integer) FROM public;
REVOKE ALL ON FUNCTION public.im_tm_stats() FROM public;
GRANT EXECUTE ON FUNCTION public.im_tm_browse(text[], text[], text[], text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.im_tm_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';
