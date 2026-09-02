-- Migration 140: a regulation can be marked EXPIRED, and expiry stops work.
--
-- WHY A THIRD STATUS
--
-- `superseded` (migration 115) already retires a regulation, but it has never blocked
-- anything: it hides the row from the assignment picker while every existing use carries on.
-- That is the right behaviour for "we don't use this any more", and it is load-bearing for
-- rows people retired months ago. Turning it into a hard stop retroactively would have
-- frozen every manual and every compliance request citing one of them, with no warning.
--
-- So expiry is a separate, deliberate act:
--
--   active      In force. Applies; stops nothing.
--   superseded  Retired on purpose. Hidden from the picker; existing uses keep working.
--   expired     No longer valid. BLOCKS every IM publish and every NEW TCF request that
--               answers for it, until a replacement still in force is recorded.
--
-- WHAT LIFTS THE BLOCK: `superseded_by_id`. It has existed since 115 and was never written
-- by anything; it is now the single edit that unblocks the company. An expired regulation
-- pointing at a usable successor stops blocking immediately, and every TCF requirement and
-- IM template citing the expired row is treated as citing the successor. Relinking each
-- usage is cleanup offered afterwards, not a precondition -- freezing everything until a
-- person edits every row by hand punishes the people who did nothing wrong.
--
-- The chain is followed transitively (2009/125/EC -> 2024/1781 -> ...), and it is hostile
-- input: nothing in the schema stops A -> B -> A. Resolution lives in
-- src/services/regulatory/regulation-lifecycle.ts, where a cycle or an over-long chain
-- resolves to BLOCKING -- refusing to publish is recoverable, publishing against a dead law
-- is not.
--
-- NOT WIRED TO `version_state`. That column is what EUR-Lex says ('repealed'); `status` is
-- what we decided. An automated third-party lookup must never freeze production work on its
-- own, so the UI surfaces 'repealed' as a prompt to expire and a person presses the button.
--
-- THE SUPPLIER PORTAL IS UNAFFECTED, deliberately. The block bites when a NEW request is
-- created; a request already sent stays answerable, because the supplier did nothing wrong
-- and stranding their work to signal an internal library problem is the wrong trade. The
-- internal request detail flags the affected rows instead.

-- --- 1. The status itself ------------------------------------------------------

ALTER TABLE public.regulations DROP CONSTRAINT IF EXISTS regulations_status_check;
ALTER TABLE public.regulations
  ADD CONSTRAINT regulations_status_check
  CHECK (status IN ('active','superseded','expired'));

ALTER TABLE public.regulations
  ADD COLUMN IF NOT EXISTS expired_at     DATE,
  ADD COLUMN IF NOT EXISTS expired_reason TEXT;

COMMENT ON COLUMN public.regulations.status IS
  'active | superseded | expired. ''superseded'' hides the row from the assignment picker without stopping anything -- the supported way to retire a regulation, with existing assignments and past reports left intact. ''expired'' (migration 140) is a HARD STOP: every IM publish and every new TCF request answering for it is refused until superseded_by_id names a replacement still in force.';

COMMENT ON COLUMN public.regulations.superseded_by_id IS
  'The regulation that replaces this one. Decorative for ''superseded''; LOAD-BEARING for ''expired'' -- it is the single edit that lifts the block, and the chain is walked transitively. Nothing here prevents A -> B -> A, so the resolver treats a cycle as "no usable replacement", i.e. still blocking (src/services/regulatory/regulation-lifecycle.ts).';

COMMENT ON COLUMN public.regulations.expired_at IS
  'When the regulation stopped being valid. Named in every block message, so an operator reading "publish refused" can tell whether this is news.';

COMMENT ON COLUMN public.regulations.expired_reason IS
  'One line of why, e.g. "repealed by ESPR (EU) 2024/1781". Free text -- the machine-readable half is superseded_by_id.';

-- Self-reference is always a broken chain, and cheap to refuse at the door. It is NOT the
-- whole cycle check: A -> B -> A needs a graph walk, which lives in the resolver.
DO $$ BEGIN
  ALTER TABLE public.regulations
    ADD CONSTRAINT regulations_superseded_by_not_self
    CHECK (superseded_by_id IS NULL OR superseded_by_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- An expired row is only useful if its expiry date is recorded; default it to today rather
-- than leaving the block message vague. Applies to rows expired before this column existed
-- (none yet) and is otherwise inert.
UPDATE public.regulations
   SET expired_at = COALESCE(expired_at, CURRENT_DATE)
 WHERE status = 'expired' AND expired_at IS NULL;

-- Finding what an expiry would stop, without scanning the table.
CREATE INDEX IF NOT EXISTS idx_regulations_expired
  ON public.regulations (status) WHERE status = 'expired';

NOTIFY pgrst, 'reload schema';
