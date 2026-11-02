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
