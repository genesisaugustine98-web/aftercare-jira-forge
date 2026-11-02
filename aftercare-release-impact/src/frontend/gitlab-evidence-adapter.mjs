import { EVIDENCE_STATUS, normalizeCommitSha } from './evidence-model.mjs';

const PIPELINE_STATUS = Object.freeze({
  success: EVIDENCE_STATUS.PASSED,
  failed: EVIDENCE_STATUS.FAILED,
  canceled: EVIDENCE_STATUS.CANCELLED,
  cancelled: EVIDENCE_STATUS.CANCELLED,
  skipped: EVIDENCE_STATUS.SKIPPED,
  manual: EVIDENCE_STATUS.SKIPPED,
  created: EVIDENCE_STATUS.NOT_RUN,
  waiting_for_resource: EVIDENCE_STATUS.NOT_RUN,
  preparing: EVIDENCE_STATUS.NOT_RUN,
  pending: EVIDENCE_STATUS.NOT_RUN,
  running: EVIDENCE_STATUS.NOT_RUN,
  scheduled: EVIDENCE_STATUS.NOT_RUN,
});

/**
 * Convert one GitLab pipeline API object into Aftercare's provider-neutral
 * evidence shape. The configured GitLab origin and project ID are checked
 * before source links or pipeline metadata are trusted.
 */
export function normalizeGitLabPipeline(
  pipeline,
  { gitlabBaseUrl, expectedProjectId } = {},
) {
  if (!pipeline || typeof pipeline !== 'object' || Array.isArray(pipeline)) {
    return { valid: false, error: 'GitLab pipeline response must be an object.' };
  }

  let configuredOrigin;
  try {
    const base = new URL(gitlabBaseUrl);
    if (base.protocol !== 'https:' || base.username || base.password) {
      throw new Error('unsafe base URL');
    }
    configuredOrigin = base.origin;
  } catch {
    return { valid: false, error: 'A valid HTTPS GitLab base URL is required.' };
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(pipeline.web_url);
    if (sourceUrl.protocol !== 'https:' || sourceUrl.origin !== configuredOrigin
      || sourceUrl.username || sourceUrl.password) {
      throw new Error('untrusted pipeline URL');
    }
  } catch {
    return { valid: false, error: 'Pipeline URL does not belong to the configured HTTPS GitLab instance.' };
  }

  if (pipeline.project_id == null
    || String(pipeline.project_id) !== String(expectedProjectId ?? '')) {
    return { valid: false, error: 'Pipeline project does not match the configured GitLab project.' };
  }

  if (pipeline.id == null || !String(pipeline.id).trim()) {
    return { valid: false, error: 'GitLab pipeline is missing its stable ID.' };
  }

  const status = PIPELINE_STATUS[pipeline.status];
  if (!status) {
    return { valid: false, error: `Unsupported GitLab pipeline status: ${String(pipeline.status)}.` };
  }

  const observedAt = pipeline.updated_at || pipeline.created_at || null;
  if (!observedAt || !Number.isFinite(new Date(observedAt).getTime())) {
    return { valid: false, error: 'GitLab pipeline has no valid observation timestamp.' };
  }

  return {
    valid: true,
    evidence: {
      id: `gitlab:pipeline:${pipeline.project_id}:${pipeline.id}`,
      kind: 'pipeline',
      source: 'GitLab',
      sourceUrl: sourceUrl.toString(),
      commitSha: normalizeCommitSha(pipeline.sha),
      pipelineId: String(pipeline.id),
      observedAt,
      status,
      reason: status === EVIDENCE_STATUS.NOT_RUN
        ? `GitLab pipeline is currently ${pipeline.status}.`
        : undefined,
    },
  };
}

const JIRA_ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/**
 * Resolve only explicit Jira issue keys written on a merge request. A single
 * key is linkable; no key is missing and multiple keys are ambiguous. This
 * helper never guesses from similarity or silently picks one of several keys.
 */
export function resolveMergeRequestIssueLink(mergeRequest) {
  if (!mergeRequest || typeof mergeRequest !== 'object' || Array.isArray(mergeRequest)) {
    return { status: 'unavailable', issueKey: null, candidates: [] };
  }

  const searchableText = [
    mergeRequest.title,
    mergeRequest.description,
    mergeRequest.source_branch,
  ].filter((value) => typeof value === 'string').join(' ');

  const candidates = [...new Set(searchableText.match(JIRA_ISSUE_KEY) || [])];

  if (candidates.length === 0) {
    return {
      status: 'missing',
      issueKey: null,
      candidates: [],
      reason: 'No explicit Jira issue key was found in the merge request title, description or source branch.',
    };
  }

  if (candidates.length > 1) {
    return {
      status: 'conflicting',
      issueKey: null,
      candidates,
      reason: 'The merge request references multiple Jira issue keys; an explicit link decision is required.',
    };
  }

  return { status: 'linked', issueKey: candidates[0], candidates };
}


const JOB_STATUS = Object.freeze({
  success: EVIDENCE_STATUS.PASSED,
  failed: EVIDENCE_STATUS.FAILED,
  canceled: EVIDENCE_STATUS.CANCELLED,
  cancelled: EVIDENCE_STATUS.CANCELLED,
  canceling: EVIDENCE_STATUS.CANCELLED,
  skipped: EVIDENCE_STATUS.SKIPPED,
  manual: EVIDENCE_STATUS.SKIPPED,
  created: EVIDENCE_STATUS.NOT_RUN,
  waiting_for_resource: EVIDENCE_STATUS.NOT_RUN,
  preparing: EVIDENCE_STATUS.NOT_RUN,
  pending: EVIDENCE_STATUS.NOT_RUN,
  running: EVIDENCE_STATUS.NOT_RUN,
});

/**
 * Normalize a GitLab CI job as execution evidence for a caller-supplied
 * category. The caller must choose the category explicitly; a job name alone
 * is not proof that a scanner or test tool actually ran correctly.
 */
export function normalizeGitLabJob(
  job,
  { gitlabBaseUrl, expectedProjectId, kind } = {},
) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    return { valid: false, error: 'GitLab job response must be an object.' };
  }

  if (typeof kind !== 'string' || !kind.trim()) {
    return { valid: false, error: 'An explicit evidence kind is required for GitLab job normalization.' };
  }

  let configuredOrigin;
  try {
    const base = new URL(gitlabBaseUrl);
    if (base.protocol !== 'https:' || base.username || base.password) {
      throw new Error('unsafe base URL');
    }
    configuredOrigin = base.origin;
  } catch {
    return { valid: false, error: 'A valid HTTPS GitLab base URL is required.' };
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(job.web_url);
    if (sourceUrl.protocol !== 'https:' || sourceUrl.origin !== configuredOrigin
      || sourceUrl.username || sourceUrl.password) {
      throw new Error('untrusted job URL');
    }
  } catch {
    return { valid: false, error: 'Job URL does not belong to the configured HTTPS GitLab instance.' };
  }

  if (job.project_id == null
    || String(job.project_id) !== String(expectedProjectId ?? '')) {
    return { valid: false, error: 'Job project does not match the configured GitLab project.' };
  }

  if (job.id == null || !String(job.id).trim()) {
    return { valid: false, error: 'GitLab job is missing its stable ID.' };
  }

  if (job.pipeline?.id == null) {
    return { valid: false, error: 'GitLab job is not linked to a pipeline ID.' };
  }

  const status = JOB_STATUS[job.status];
  if (!status) {
    return { valid: false, error: `Unsupported GitLab job status: ${String(job.status)}.` };
  }

  const observedAt = job.finished_at || job.started_at || job.created_at || null;
  if (!observedAt || !Number.isFinite(new Date(observedAt).getTime())) {
    return { valid: false, error: 'GitLab job has no valid observation timestamp.' };
  }

  return {
    valid: true,
    evidence: {
      id: `gitlab:job:${job.project_id}:${job.id}`,
      kind: kind.trim(),
      source: 'GitLab',
      sourceUrl: sourceUrl.toString(),
      commitSha: normalizeCommitSha(job.commit?.id),
      pipelineId: String(job.pipeline.id),
      observedAt,
      status,
      reason: status === EVIDENCE_STATUS.NOT_RUN
        ? `GitLab job is currently ${job.status}.`
        : undefined,
    },
  };
}

/**
 * Convert GitLab's pipeline test-report summary into distinct test-suite
 * evidence. Zero tests, skipped tests, failed tests and inconsistent totals
 * never become a passing test result.
 */
export function normalizeGitLabTestReport(
  report,
  pipeline,
  { gitlabBaseUrl, expectedProjectId } = {},
) {
  const pipelineResult = normalizeGitLabPipeline(pipeline, {
    gitlabBaseUrl,
    expectedProjectId,
  });

  if (!pipelineResult.valid) {
    return pipelineResult;
  }

  const total = report?.total;
  const numericCounts = total && ['count', 'success', 'failed', 'skipped', 'error']
    .every((field) => Number.isInteger(total[field]) && total[field] >= 0);

  if (!numericCounts) {
    return { valid: false, error: 'GitLab test report has missing or invalid aggregate counts.' };
  }

  const counted = total.success + total.failed + total.skipped + total.error;
  let status;
  let reason;

  if (total.count === 0) {
    status = EVIDENCE_STATUS.MISSING;
    reason = 'The pipeline test report contains zero tests; no passing test evidence is available.';
  } else if (counted !== total.count) {
    status = EVIDENCE_STATUS.CONFLICTING;
    reason = 'GitLab test report aggregate counts do not add up to the reported total.';
  } else if (total.failed > 0 || total.error > 0 || total.suite_error) {
    status = EVIDENCE_STATUS.FAILED;
    reason = 'The GitLab test report contains failed tests or test-suite errors.';
  } else if (total.skipped > 0) {
    status = EVIDENCE_STATUS.SKIPPED;
    reason = 'The GitLab test report contains skipped tests; full test coverage is not established.';
  } else if (total.success === total.count) {
    status = EVIDENCE_STATUS.PASSED;
    reason = 'Every reported test passed in this pipeline.';
  } else {
    status = EVIDENCE_STATUS.CONFLICTING;
    reason = 'GitLab test report counts do not establish a successful result.';
  }

  return {
    valid: true,
    evidence: {
      id: `gitlab:test-report:${pipeline.project_id}:${pipeline.id}`,
      kind: 'test_suite',
      source: 'GitLab',
      sourceUrl: pipelineResult.evidence.sourceUrl,
      commitSha: pipelineResult.evidence.commitSha,
      pipelineId: String(pipeline.id),
      observedAt: pipeline.updated_at || pipeline.created_at,
      status,
      reason,
    },
  };
}
