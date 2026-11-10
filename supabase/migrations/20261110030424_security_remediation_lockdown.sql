/*
# Security Remediation — Lock Down Open RLS Policies

## Problem
The initial migration created all tables with USING(true) policies granting
full CRUD to anon and authenticated. This is completely open.

## Changes
1. Revoke INSERT, UPDATE, DELETE from anon on all tables (read-only frontend).
2. Drop all open write policies.
3. Add cross-research evidence prevention trigger on claim_evidence.
4. Add SHA-256 hash function (pgcrypto is in extensions schema).
5. Add create_research_job and cancel_research_job SECURITY DEFINER functions.
6. Add cancelled, reasoning_summary, uncertainty_notes columns.

## Security Model
- Frontend (anon key): READ ONLY on all tables.
- Edge function (service_role): bypasses RLS, performs all pipeline writes.
- SECURITY DEFINER functions validate inputs for user-initiated operations.
*/

-- ============================================================
-- 1. Revoke write access from anon on all tables
-- ============================================================
REVOKE INSERT, UPDATE, DELETE ON research_jobs FROM anon;
GRANT SELECT ON research_jobs TO anon;
DROP POLICY IF EXISTS "anon_insert_research_jobs" ON research_jobs;
DROP POLICY IF EXISTS "anon_update_research_jobs" ON research_jobs;
DROP POLICY IF EXISTS "anon_delete_research_jobs" ON research_jobs;

REVOKE INSERT, UPDATE, DELETE ON research_questions FROM anon;
GRANT SELECT ON research_questions TO anon;
DROP POLICY IF EXISTS "anon_insert_research_questions" ON research_questions;
DROP POLICY IF EXISTS "anon_update_research_questions" ON research_questions;
DROP POLICY IF EXISTS "anon_delete_research_questions" ON research_questions;

REVOKE INSERT, UPDATE, DELETE ON source_runs FROM anon;
GRANT SELECT ON source_runs TO anon;
DROP POLICY IF EXISTS "anon_insert_source_runs" ON source_runs;
DROP POLICY IF EXISTS "anon_update_source_runs" ON source_runs;
DROP POLICY IF EXISTS "anon_delete_source_runs" ON source_runs;

REVOKE INSERT, UPDATE, DELETE ON evidence_items FROM anon;
GRANT SELECT ON evidence_items TO anon;
DROP POLICY IF EXISTS "anon_insert_evidence_items" ON evidence_items;
DROP POLICY IF EXISTS "anon_update_evidence_items" ON evidence_items;
DROP POLICY IF EXISTS "anon_delete_evidence_items" ON evidence_items;

REVOKE INSERT, UPDATE, DELETE ON claims FROM anon;
GRANT SELECT ON claims TO anon;
DROP POLICY IF EXISTS "anon_insert_claims" ON claims;
DROP POLICY IF EXISTS "anon_update_claims" ON claims;
DROP POLICY IF EXISTS "anon_delete_claims" ON claims;

REVOKE INSERT, UPDATE, DELETE ON claim_evidence FROM anon;
GRANT SELECT ON claim_evidence TO anon;
DROP POLICY IF EXISTS "anon_insert_claim_evidence" ON claim_evidence;
DROP POLICY IF EXISTS "anon_update_claim_evidence" ON claim_evidence;
DROP POLICY IF EXISTS "anon_delete_claim_evidence" ON claim_evidence;

REVOKE INSERT, UPDATE, DELETE ON reports FROM anon;
GRANT SELECT ON reports TO anon;
DROP POLICY IF EXISTS "anon_insert_reports" ON reports;
DROP POLICY IF EXISTS "anon_update_reports" ON reports;
DROP POLICY IF EXISTS "anon_delete_reports" ON reports;

REVOKE INSERT, UPDATE, DELETE ON decision_options FROM anon;
GRANT SELECT ON decision_options TO anon;
DROP POLICY IF EXISTS "anon_insert_decision_options" ON decision_options;
DROP POLICY IF EXISTS "anon_update_decision_options" ON decision_options;
DROP POLICY IF EXISTS "anon_delete_decision_options" ON decision_options;

-- ============================================================
-- 2. New columns
-- ============================================================
ALTER TABLE research_jobs ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS reasoning_summary text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS uncertainty_notes text;

-- ============================================================
-- 3. Cross-research evidence prevention trigger
-- ============================================================
CREATE OR REPLACE FUNCTION check_claim_evidence_same_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_claim_job uuid;
  v_evidence_job uuid;
BEGIN
  SELECT research_job_id INTO v_claim_job FROM claims WHERE id = NEW.claim_id;
  SELECT research_job_id INTO v_evidence_job FROM evidence_items WHERE id = NEW.evidence_item_id;

  IF v_claim_job IS NULL OR v_evidence_job IS NULL THEN
    RAISE EXCEPTION 'Claim or evidence item not found';
  END IF;

  IF v_claim_job <> v_evidence_job THEN
    RAISE EXCEPTION 'Cross-research evidence linking is not allowed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_same_research_job ON claim_evidence;
CREATE TRIGGER enforce_same_research_job
  BEFORE INSERT ON claim_evidence
  FOR EACH ROW
  EXECUTE FUNCTION check_claim_evidence_same_job();

-- ============================================================
-- 4. SHA-256 content hash function (pgcrypto is in extensions schema)
-- ============================================================
CREATE OR REPLACE FUNCTION sha256_hash(input text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT encode(extensions.digest(input::bytea, 'sha256'), 'hex')
$$;

GRANT EXECUTE ON FUNCTION sha256_hash(text) TO anon, authenticated;

-- ============================================================
-- 5. create_research_job SECURITY DEFINER function
-- ============================================================
CREATE OR REPLACE FUNCTION create_research_job(
  p_title text,
  p_original_query text,
  p_scope text DEFAULT NULL,
  p_language text DEFAULT 'ar',
  p_depth text DEFAULT 'quick'
)
RETURNS research_jobs
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_job research_jobs;
BEGIN
  IF p_title IS NULL OR length(trim(p_title)) < 3 THEN
    RAISE EXCEPTION 'Title must be at least 3 characters';
  END IF;
  IF p_original_query IS NULL OR length(trim(p_original_query)) < 3 THEN
    RAISE EXCEPTION 'Query must be at least 3 characters';
  END IF;
  IF p_depth NOT IN ('quick', 'deep') THEN
    RAISE EXCEPTION 'Depth must be quick or deep';
  END IF;
  IF p_language IS NULL OR length(trim(p_language)) < 2 THEN
    RAISE EXCEPTION 'Language must be specified';
  END IF;

  INSERT INTO research_jobs (title, original_query, scope, language, depth, status, current_stage, progress_percent)
  VALUES (p_title, p_original_query, p_scope, p_language, p_depth, 'planning', 1, 0)
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_research_job(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_research_job(text, text, text, text, text) TO anon, authenticated;

-- ============================================================
-- 6. cancel_research_job SECURITY DEFINER function
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_research_job(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE research_jobs
  SET cancelled = true,
      status = CASE WHEN status IN ('completed', 'failed', 'partial') THEN status ELSE 'failed' END,
      completed_at = CASE WHEN completed_at IS NULL THEN now() ELSE completed_at END,
      error_summary = CASE WHEN error_summary IS NULL THEN 'cancelled by user' ELSE error_summary END
  WHERE id = p_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_research_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_research_job(uuid) TO anon, authenticated;
