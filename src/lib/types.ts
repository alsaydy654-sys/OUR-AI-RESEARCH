export type ResearchDepth = 'quick' | 'deep';

export type ResearchStatus =
  | 'planning'
  | 'collecting'
  | 'analyzing'
  | 'verifying'
  | 'reporting'
  | 'completed'
  | 'failed'
  | 'partial';

export type SourceRunStatus = 'idle' | 'running' | 'success' | 'failed';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unverified';

export type VerificationStatus = 'pending' | 'verified' | 'conflicted' | 'unverified';

export type SourceType = 'web' | 'repo' | 'video';

export type ResearchJob = {
  id: string;
  title: string;
  original_query: string;
  scope: string | null;
  language: string;
  depth: ResearchDepth;
  status: ResearchStatus;
  current_stage: number;
  progress_percent: number;
  error_summary: string | null;
  created_at: string;
  completed_at: string | null;
};

export type ResearchQuestion = {
  id: string;
  research_job_id: string;
  question: string;
  priority: number;
  status: string;
  created_at: string;
};

export type SourceRun = {
  id: string;
  research_job_id: string;
  source_name: string;
  action_name: string;
  status: SourceRunStatus;
  started_at: string | null;
  completed_at: string | null;
  result_count: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

export type EvidenceItem = {
  id: string;
  research_job_id: string;
  source_run_id: string | null;
  title: string;
  url: string | null;
  source_type: SourceType;
  excerpt: string | null;
  published_at: string | null;
  retrieved_at: string;
  author: string | null;
  content_hash: string | null;
  reliability_notes: string | null;
  collection_status: string;
  created_at: string;
};

export type Claim = {
  id: string;
  research_job_id: string;
  claim_text: string;
  claim_type: string;
  confidence_level: ConfidenceLevel;
  verification_status: VerificationStatus;
  created_at: string;
};

export type ClaimEvidence = {
  id: string;
  claim_id: string;
  evidence_item_id: string;
  relation_type: string;
  created_at: string;
};

export type DecisionOption = {
  id: string;
  research_job_id: string;
  option_title: string;
  rationale: string | null;
  expected_benefits: string | null;
  risks: string | null;
  assumptions: string | null;
  confidence_level: ConfidenceLevel;
  created_at: string;
};

export type ReportContent = {
  executiveSummary: string;
  researchQuestion: string;
  scope: string;
  keyFindings: { finding: string; evidenceCount: number }[];
  evidenceAndSources: { title: string; url: string; type: SourceType; excerpt: string; retrievedAt: string }[];
  marketAnalysis: string;
  competitors: string;
  technicalAnalysis: string;
  opportunities: string[];
  risks: { risk: string; severity: 'high' | 'medium' | 'low'; mitigation: string }[];
  recommendations: string[];
  decisionOptions: { title: string; rationale: string; confidence: ConfidenceLevel }[];
  unknowns: string[];
  sources: { title: string; url: string; type: SourceType; retrievedAt: string; author: string | null }[];
};

export type Report = {
  id: string;
  research_job_id: string;
  report_version: number;
  report_content: ReportContent;
  created_at: string;
};
