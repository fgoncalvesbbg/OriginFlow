-- 174: TCF conditions get their OWN questions, decoupled from category attributes.
--
-- WHAT WAS WRONG, and it is worse than "inelegant". A conditional TCF requirement gated on a
-- `category_attributes` row by id. Category attributes are PIM data with their own lifecycle,
-- and on 2026-08-28 all 172 of them were deleted on purpose. Every conditional requirement
-- has been pointing at a dead id ever since. Verified on the live database before writing
-- this: all 3 rows with a `condition` reference attribute ids that no longer exist.
--
-- The consequences were silent and both bad:
--
--   1. `passesFeatureGate` reads the answer for a missing id as absent, so the gate FAILS and
--      the requirement is EXCLUDED. Three real obligations — RED, Energy Labelling, Ecodesign
--      — were quietly dropped from every Beverage Coolers request. A compliance system that
--      silently stops asking for evidence is the exact failure mode worth engineering against.
--
--   2. `CreateComplianceRequest` built its "required answers" list from the CONDITIONS but
--      rendered its input fields from the surviving ATTRIBUTES. With the attribute gone there
--      was a required answer and no field to type it in, so the Create button stayed disabled
--      with nothing on screen explaining why. Beverage Coolers could not be requested at all.
--
-- THE FIX IS A SEPARATION OF OWNERSHIP. TCF conditions now reference `compliance_questions` —
-- a small set owned by the compliance library itself, versioned with it, deleted only by
-- someone editing it. A question is a QUESTION ("Does the product transmit radio?"), not a
-- PIM field that happens to be usable as one. The two things have different owners, different
-- lifecycles and different audiences, and pretending otherwise is what broke this.
--
-- QUESTIONS ARE LIBRARY-GLOBAL, deliberately not category-scoped. Categories already share
-- requirements (migration 173); if a requirement shared across twelve Hoods gated on a
-- category-scoped question, there would be no answer to "which category's copy of the
-- question?". One question, referenced by any requirement, is the only shape that composes
-- with sharing. `group_name` organises them for the author; it does not scope them.
--
-- AND THE FAILURE DIRECTION IS INVERTED. From now on a condition that CANNOT be evaluated —
-- its question was deleted, or it is still flagged `needs_review` — makes the requirement
-- APPLY, and flags it loudly. Over-asking a supplier for evidence is recoverable in a
-- conversation. Under-asking is discovered by an auditor. See `evaluateRequirementApplicability`
-- in src/services/compliance/tcf-condition.ts, which owns that rule; this migration only
-- makes it possible by giving conditions a resolvable target.

-- ===========================================================================
-- 1. The questions
-- ===========================================================================

create table if not exists public.compliance_questions (
  id           uuid primary key default gen_random_uuid(),

  /** The question as a human is asked it, not a field name. "Does it have a mains plug?" */
  label        text not null,
  /** Optional guidance shown under the question in the wizard. */
  help_text    text,

  data_type    text not null default 'boolean'
               check (data_type in ('boolean', 'enum', 'number', 'text')),
  /** Choices for `enum`. Ignored for every other type. */
  options      text[] not null default '{}',
  /** Shown beside a `number` answer (W, kg, L). Display only — never parsed. */
  unit         text,

  /** Author-facing grouping only. This does NOT scope the question to anything. */
  group_name   text,
  sort_order   integer not null default 0,

  /**
   * Set when a question exists but nobody has confirmed what it should ask — currently only
   * the ones this migration rescues below. A requirement gated on a `needs_review` question
   * APPLIES and is flagged, never silently excluded.
   */
  needs_review boolean not null default false,

  created_at   timestamptz not null default now(),
  created_by   text
);

comment on table public.compliance_questions is
  'Questions the TCF library asks to decide which conditional requirements apply (migration 174). Owned by the compliance library, NOT by the PIM: conditions used to reference category_attributes, which were deleted wholesale in Aug 2026 and left every conditional requirement silently never applying. Library-global on purpose — a requirement shared across categories (migration 173) cannot gate on a category-scoped question.';

comment on column public.compliance_questions.needs_review is
  'True while nobody has confirmed what this question should ask. A requirement gated on one still APPLIES (and is flagged) rather than being silently excluded.';

-- One question per thing worth asking. A case-insensitive unique label is the whole point:
-- the drift this feature exists to prevent starts with two questions meaning the same thing.
create unique index if not exists compliance_questions_label_key
  on public.compliance_questions (lower(btrim(label)));

create index if not exists compliance_questions_order_idx
  on public.compliance_questions (sort_order, created_at);

comment on column public.compliance_requirements.condition is
  'Applicability gate, in the same FeatureConditionFields shape IM block refs use. Since migration 174 the ids inside it name public.compliance_questions rows — NOT category_attributes. `passesFeatureGate` is id-agnostic, which is why the shape did not have to change.';

-- ===========================================================================
-- 2. Where the answers live
-- ===========================================================================
--
-- A new column rather than reusing `condition_attributes`, whose name would then be a lie.
-- Nothing is lost by leaving that one behind: verified on the live database, ZERO requests
-- have a non-empty `condition_attributes`, so there is no legacy answer data to carry and no
-- merge-on-read to maintain. It stays in place, unread, rather than being dropped in the same
-- migration that changes how answers work.

alter table public.compliance_requests
  add column if not exists condition_answers jsonb not null default '{}';

comment on column public.compliance_requests.condition_answers is
  'Answers to the TCF questions (migration 174), keyed by compliance_questions.id. What the wizard captured when the request was created. Kept as the EVIDENCE for requirement_ids — the answers that produced the set — not as something re-evaluated on read.';

comment on column public.compliance_requests.condition_attributes is
  'DEPRECATED (migration 174). Answers keyed by category_attributes.id, from when conditions gated on PIM attributes. Never populated on any row; superseded by condition_answers. Kept rather than dropped so this migration changes one thing.';

-- ===========================================================================
-- 2b. The FORMULATED set
-- ===========================================================================
--
-- The wizard does not merely collect answers, it decides a requirement list — and that list is
-- what the supplier is asked for. Storing it, rather than re-deriving it on every read, buys
-- three things that all matter here:
--
--   1. THE SUPPLIER PORTAL NEEDS NO QUESTIONS. It is an anonymous context reaching the
--      database with a token. Re-evaluating conditions there would mean granting anon read on
--      `compliance_questions`, i.e. publishing the internal questions that decide what a
--      supplier is asked. With the set frozen on the request, the portal reads a list of ids
--      and needs nothing else.
--
--   2. A SENT REQUEST STOPS MOVING. Edit the library tomorrow — add a requirement, tighten a
--      condition, re-word a question — and a request already with a supplier keeps the exact
--      set they were asked for. That is already this system's stated philosophy for expired
--      regulations ("a request already sent is NOT affected — the supplier did nothing
--      wrong"), and it applies at least as strongly to the list itself.
--
--   3. IT IS THE RECORD. "Why was this supplier asked for a RED report?" is answerable from
--      the row: these answers, therefore this set. Re-deriving it from today's library would
--      answer a different question.
--
-- Empty means a legacy request, created before this migration. Those fall back to
-- "unconditional requirements only", which is exactly what they resolved to at the time —
-- every condition then pointed at a deleted attribute and so excluded its requirement.

alter table public.compliance_requests
  add column if not exists requirement_ids text[] not null default '{}';

comment on column public.compliance_requests.requirement_ids is
  'The requirement set the wizard formulated for this request (migration 174), frozen at creation. The supplier portal renders exactly these, so it needs no access to compliance_questions and later library edits cannot change what an already-sent request asked for. Empty = a legacy request; fall back to the unconditional requirements.';

-- ===========================================================================
-- 3. Rescue the orphaned conditions
-- ===========================================================================
--
-- Every existing condition points at a deleted attribute, so its INTENT is unrecoverable —
-- the row that said what "attribute da0d7c07" meant is gone. Three options, and only one is
-- honest:
--
--   Guess the question from the numbers ("10 to 1500, so… watts?") and write the guess into a
--   compliance system as though it were fact. No.
--
--   Null the conditions out, making the requirements unconditional. Safe in the
--   over-ask direction and it does unblock the screen, but it throws away the bounds someone
--   deliberately chose, and the next person cannot tell a decision from an accident.
--
--   Preserve the shape, admit the ignorance. One question per distinct dead id — so two
--   requirements that gated on the SAME attribute still gate on the same question, which is
--   real information worth keeping — carrying the numeric bounds, flagged `needs_review`,
--   with a help text naming the dead attribute and the requirements it gated. The evaluator
--   treats `needs_review` as "applies, and flagged", so nothing is silently dropped while the
--   question waits to be worded properly.
--
-- Idempotent: an id that already names a live question is skipped, so re-running is a no-op.

do $rescue$
declare
  v_ref       record;
  v_qid       uuid;
  v_label     text;
  v_type      text;
  v_attr_name text;
begin
  for v_ref in
    select
      coalesce(cr.condition->>'requires_feature', cr.condition->>'requires_feature_absent') as old_id,
      bool_or((cr.condition ? 'requires_feature_num_min') or (cr.condition ? 'requires_feature_num_max')) as is_numeric,
      min(cr.condition->>'requires_feature_num_min') as num_min,
      min(cr.condition->>'requires_feature_num_max') as num_max,
      count(*)                                       as used_by,
      string_agg(distinct cr.title, '; ')            as titles
    from public.compliance_requirements cr
    where cr.condition is not null
      and coalesce(cr.condition->>'requires_feature', cr.condition->>'requires_feature_absent') is not null
      and not exists (
        select 1 from public.compliance_questions q
        where q.id::text = coalesce(cr.condition->>'requires_feature', cr.condition->>'requires_feature_absent')
      )
    group by 1
  loop
    -- Reset every iteration. A `select ... into` that finds no row leaves the variable at its
    -- PREVIOUS value inside a loop, which would quietly label one question after another.
    v_attr_name := null;
    select a.name into v_attr_name
    from public.category_attributes a
    where a.id::text = v_ref.old_id;

    v_type := case when v_ref.is_numeric then 'number' else 'text' end;

    -- The id suffix keeps two distinct dead attributes from colliding on the unique label
    -- index and being silently merged into one question.
    v_label := case
      when v_attr_name is not null then
        format('Needs review - %s [%s]', v_attr_name, left(v_ref.old_id, 8))
      when v_ref.is_numeric then
        format('Needs review - numeric condition %s to %s [%s]',
               coalesce(v_ref.num_min, '?'), coalesce(v_ref.num_max, '?'), left(v_ref.old_id, 8))
      else
        format('Needs review - presence condition [%s]', left(v_ref.old_id, 8))
    end;

    insert into public.compliance_questions
      (label, data_type, help_text, needs_review, group_name, created_by)
    values (
      v_label,
      v_type,
      format(
        'Rescued by migration 174. This gated %s requirement(s) — %s — on category attribute %s, %s. '
        || 'Because the gate could not be evaluated, those requirements were silently never applying. '
        || 'Re-word this question to say what should actually be asked, set its type and options, then clear "needs review".',
        v_ref.used_by,
        v_ref.titles,
        v_ref.old_id,
        case when v_attr_name is not null
             then format('which still exists as "%s" but is PIM data and no longer a valid target', v_attr_name)
             else 'which no longer exists' end
      ),
      true,
      'Needs review',
      'migration 174'
    )
    returning id into v_qid;

    update public.compliance_requirements cr
    set condition = case
          when cr.condition ? 'requires_feature'
            then jsonb_set(cr.condition, '{requires_feature}', to_jsonb(v_qid::text))
          else jsonb_set(cr.condition, '{requires_feature_absent}', to_jsonb(v_qid::text))
        end
    where cr.condition is not null
      and coalesce(cr.condition->>'requires_feature', cr.condition->>'requires_feature_absent') = v_ref.old_id;
  end loop;
end
$rescue$;

-- ===========================================================================
-- 4. Grants and policies
-- ===========================================================================
--
-- Supabase's default privileges grant anon ALL on every new table, so revoke first and then
-- grant only what is wanted (see migration 167's note).
--
-- Staff read and write; anon gets NOTHING. The supplier portal never needs a question — it
-- renders `compliance_requests.requirement_ids`, the set the wizard already formulated, and
-- evaluates no conditions at all. That is the reason the set is frozen onto the request
-- (section 2b): the alternative was granting anon read here, i.e. publishing the internal
-- questions that decide what a supplier gets asked for.

alter table public.compliance_questions enable row level security;

revoke all on public.compliance_questions from anon, authenticated;
grant select, insert, update, delete on public.compliance_questions to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'compliance_questions'
      and policyname = 'compliance_questions_read'
  ) then
    create policy "compliance_questions_read" on public.compliance_questions
      for select to authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'compliance_questions'
      and policyname = 'compliance_questions_write'
  ) then
    create policy "compliance_questions_write" on public.compliance_questions
      for all to authenticated using (true) with check (true);
  end if;
end $$;
