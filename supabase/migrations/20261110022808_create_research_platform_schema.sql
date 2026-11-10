/*
# Research Platform Schema — OUR AI RESEARCH

Creates the full data model for an Arabic-first multi-source research platform.
Single-tenant (no auth) for the MVP — all data is shared/public.

## New Tables

1. `research_jobs` — main research task records
   - id (uuid PK)
   - title (text) — display title
   - original_query (text) — user's raw input
   - scope (text) — market/country scope if provided
   - language (text, default 'ar')
   - depth (text: 'quick' | 'deep', default 'quick')
   - status (text: 'planning' | 'collecting' | 'analyzing' | 'verifying' | 'reporting' | 'completed' | 'failed' | 'partial')
   - current_stage (int, default 1) — 1=planning, 2=collecting, 3=analyzing, 4=verifying, 5=reporting
   - progress_percent (int, default 0)
   - error_summary (text)
   - created_at, completed_at (timestamptz)

2. `research_questions` — sub-questions分解 from the main topic
   - id, research_job_id (FK), question, priority (int), status (text)

3. `source_runs` — per-source collection attempts
   - id, research_job_id (FK), source_name, action_name, status (running/success/failed/idle), started_at, completed_at, result_count, error_code, error_message

4. `evidence_items` — unified source results
   - id, research_job_id, source_run_id (FK nullable), title, url, source_type (web/repo/video), excerpt, published_at, retrieved_at, author, content_hash, reliability_notes, collection_status

5. `claims` — extracted claims with confidence
   - id, research_job_id, claim_text, claim_type, confidence_level (high/medium/low/unverified), verification_status

6. `claim_evidence` — many-to-many linking claims to evidence
   - claim_id (FK), evidence_item_id (FK), relation_type

7. `reports` — generated reports
   - id, research_job_id (FK), report_version (int), report_content (jsonb — structured report), created_at

8. `decision_options` — decision options with rationale
   - id, research_job_id (FK), option_title, rationale, expected_benefits, risks, assumptions, confidence_level

## Security
- RLS enabled on all tables.
- Grants to `anon, authenticated` (single-tenant, no auth for MVP).
- All CRUD allowed for anon + authenticated (data is intentionally shared).
*/

-- research_jobs
CREATE TABLE IF NOT EXISTS research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  original_query text NOT NULL,
  scope text,
  language text NOT NULL DEFAULT 'ar',
  depth text NOT NULL DEFAULT 'quick' CHECK (depth IN ('quick', 'deep')),
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'collecting', 'analyzing', 'verifying', 'reporting', 'completed', 'failed', 'partial')),
  current_stage int NOT NULL DEFAULT 1,
  progress_percent int NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE research_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_jobs TO anon, authenticated;
DROP POLICY IF EXISTS "anon_select_research_jobs" ON research_jobs;
CREATE POLICY "anon_select_research_jobs" ON research_jobs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_research_jobs" ON research_jobs;
CREATE POLICY "anon_insert_research_jobs" ON research_jobs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_research_jobs" ON research_jobs;
CREATE POLICY "anon_update_research_jobs" ON research_jobs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_research_jobs" ON research_jobs;
CREATE POLICY "anon_delete_research_jobs" ON research_jobs FOR DELETE TO anon, authenticated USING (true);

-- research_questions
CREATE TABLE IF NOT EXISTS research_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_job_id uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  question text NOT NULL,
  priority int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'answered', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE research_questions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_questions TO anon, authenticated;
DROP POLICY IF EXISTS "anon_select_research_questions" ON research_questions;
CREATE POLICY "anon_select_research_questions" ON research_questions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_research_questions" ON research_questions;
CREATE POLICY "anon_insert_research_questions" ON research_questions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_research_questions" ON research_questions;
CREATE POLICY "anon_update_research_questions" ON research_questions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_research_questions" ON research_questions;
CREATE POLICY "anon_delete_research_questions" ON research_questions FOR DELETE TO anon, authenticated USING (true);

-- source_runs
CREATE TABLE IF NOT EXISTS source_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_job_id uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  action_name text NOT NULL,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'success', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  result_count int DEFAULT 0,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE source_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON source_runs TO anon, authenticated;
DROP POLICY IF EXISTS "anon_select_source_runs" ON source_runs;
CREATE POLICY "anon_select_source_runs" ON source_runs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_source_runs" ON source_runs;
CREATE POLICY "anon_insert_source_runs" ON source_runs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_source_runs" ON source_runs;
CREATE POLICY "anon_update_source_runs" ON source_runs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_source_runs" ON source_runs;
CREATE POLICY "anon_delete_source_runs" ON source_runs FOR DELETE TO anon, authenticated USING (true);

-- evidence_items
CREATE TABLE IF NOT EXISTS evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_job_id uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  source_run_id uuid REFERENCES source_runs(id) ON DELETE SET NULL,
  title text NOT NULL,
  url text,
  source_type text NOT NULL CHECK (source_type IN ('web', 'repo', 'video')),
  excerpt text,
  published_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  author text,
  content_hash text,
  reliability_notes text,
  collection_status text NOT NULL DEFAULT 'collected' CHECK (collection_status IN ('collected', 'failed', 'partial')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON evidence_items TO anon, authenticated;
DROP POLICY IF EXISTS "anon_select_evidence_items" ON evidence_items;
CREATE POLICY "anon_select_evidence_items" ON evidence_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_evidence_items" ON evidence_items;
CREATE POLICY "anon_insert_evidence_items" ON evidence_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_evidence_items" ON evidence_items;
CREATE POLICY "anon_update_evidence_items" ON evidence_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_evidence_items" ON evidence_items;
CREATE POLICY "anon_delete_evidence_items" ON evidence_items FOR DELETE TO anon, authenticated USING (true);

-- claims
CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_job_id uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  claim_text text NOT NULL,
  claim_type text NOT NULL DEFAULT 'factual',
  confidence_level text NOT NULL DEFAULT 'unverified' CHECK (confidence_level IN ('high', 'medium', 'low', 'unverified')),
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'conflicted', 'unverified')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON claims TO anon, authenticated;
DROP POLICY IF EXISTS "anon_select_claims" ON claims;
CREATE POLICY "anon_select_claims" ON claims FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_claims" ON claims;
CREATE POLICY "anon_insert_claims" ON claims FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_claims" ON claims;
CREATE POLICY "anon_update_claims" ON claims FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_claims" ON claims;
CREATE POLICY "anon_delete_claims" ON claims FOR DELETE TO anon, authenticated USING (true);

-- claim_evidence
CREATE TABLE IF NOT EXISTS claim_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  evidence_item_id uuid NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  relation_type text NOT NULL DEFAULT 'supports',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE claim_evidence ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_evidence TO anon, authenticated;
DROP POLICY IF EXISTS "anon_select_claim_evidence" ON claim_evidence;
CREATE POLICY "anon_select_claim_evidence" ON claim_evidence FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_claim_evidence" ON claim_evidence;
CREATE POLICY "anon_insert_claim_evidence" ON claim_evidence FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_claim_evidence" ON claim_evidence;
CREATE POLICY "anon_update_claim_evidence" ON claim_evidence FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_claim_evidence" ON claim_evidence;
CREATE POLICY "anon_delete_claim_evidence" ON claim_evidence FOR DELETE TO anon, authenticated USING (true);

-- reports
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_job_id uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  report_version int NOT NULL DEFAULT 1,
  report_content jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON reports TO anon, authenticated;
DROP POLICY IF EXISTS "anon_select_reports" ON reports;
CREATE POLICY "anon_select_reports" ON reports FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_reports" ON reports;
CREATE POLICY "anon_insert_reports" ON reports FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_reports" ON reports;
CREATE POLICY "anon_update_reports" ON reports FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_reports" ON reports;
CREATE POLICY "anon_delete_reports" ON reports FOR DELETE TO anon, authenticated USING (true);

-- decision_options
CREATE TABLE IF NOT EXISTS decision_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_job_id uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  option_title text NOT NULL,
  rationale text,
  expected_benefits text,
  risks text,
  assumptions text,
  confidence_level text NOT NULL DEFAULT 'medium' CHECK (confidence_level IN ('high', 'medium', 'low', 'unverified')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE decision_options ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON decision_options TO anon, authenticated;
DROP POLICY IF EXISTS "anon_select_decision_options" ON decision_options;
CREATE POLICY "anon_select_decision_options" ON decision_options FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_decision_options" ON decision_options;
CREATE POLICY "anon_insert_decision_options" ON decision_options FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_decision_options" ON decision_options;
CREATE POLICY "anon_update_decision_options" ON decision_options FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_decision_options" ON decision_options;
CREATE POLICY "anon_delete_decision_options" ON decision_options FOR DELETE TO anon, authenticated USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_research_questions_job ON research_questions(research_job_id);
CREATE INDEX IF NOT EXISTS idx_source_runs_job ON source_runs(research_job_id);
CREATE INDEX IF NOT EXISTS idx_evidence_items_job ON evidence_items(research_job_id);
CREATE INDEX IF NOT EXISTS idx_claims_job ON claims(research_job_id);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim ON claim_evidence(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_evidence ON claim_evidence(evidence_item_id);
CREATE INDEX IF NOT EXISTS idx_reports_job ON reports(research_job_id);
CREATE INDEX IF NOT EXISTS idx_decision_options_job ON decision_options(research_job_id);
CREATE INDEX IF NOT EXISTS idx_research_jobs_created ON research_jobs(created_at DESC);
