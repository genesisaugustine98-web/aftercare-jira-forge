import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGitLabIssueEvidence } from '../src/backend/gitlab-evidence-service.mjs';

const PROJECT_ID = 42;
const SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const FRESH = '2026-11-02T07:50:00.000Z';

const mergeRequest = (overrides = {}) => ({
  iid: 1,
  title: 'VAN-1: validate payment change',
  description: 'A controlled release change.',
  source_branch: 'feature/VAN-1-payment',
  target_branch: 'main',
  web_url: 'https://gitlab.com/acme/payments/-/merge_requests/1',
  ...overrides,
});

const pipeline = (overrides = {}) => ({
  id: 10,
  project_id: PROJECT_ID,
  sha: SHA,
  ref: 'feature/VAN-1-payment',
  status: 'success',
  created_at: FRESH,
  updated_at: FRESH,
  web_url: 'https://gitlab.com/acme/payments/-/pipelines/10',
  ...overrides,
});

const job = (id, name, overrides = {}) => ({
  id,
  project_id: PROJECT_ID,
  name,
  stage: 'verify',
  status: 'success',
  web_url: `https://gitlab.com/acme/payments/-/jobs/${id}`,
  created_at: FRESH,
  started_at: FRESH,
  finished_at: FRESH,
  commit: { id: SHA },
  pipeline: { id: 10 },
  ...overrides,
});

const testReport = {
  total: { count: 11, success: 11, failed: 0, skipped: 0, error: 0, suite_error: null },
  test_suites: [{
    name: 'unit_tests',
    total_count: 11,
    success_count: 11,
    failed_count: 0,
    skipped_count: 0,
    error_count: 0,
    build_ids: [101],
  }],
};

const baseFixtures = () => ({
  mergeRequests: [mergeRequest()],
  detail: {
    ...mergeRequest(),
    id: 1001,
    project_id: PROJECT_ID,
    sha: SHA,
    diff_refs: { head_sha: SHA },
    head_pipeline: { id: 10 },
  },
  pipeline: pipeline(),
  jobs: [
    job(101, 'unit_tests'),
    job(102, 'security_scan', { stage: 'secure' }),
    job(103, 'package_source', { stage: 'package' }),
    job(104, 'release_evidence', { stage: 'release' }),
  ],
  report: testReport,
  mergeRequestHeaders: {},
});

function makeFetch(fixtures, options = {}) {
  return async (url) => {
    const parsed = new URL(url);
    const pathName = parsed.pathname;

    if (pathName.endsWith('/merge_requests') && !pathName.match(/\/merge_requests\/\d+$/)) {
      return response(fixtures.mergeRequests, fixtures.mergeRequestHeaders);
    }
    if (pathName.endsWith('/merge_requests/1')) {
      return response(fixtures.detail);
    }
    if (pathName.endsWith('/pipelines/10/jobs')) {
      return response(fixtures.jobs, fixtures.jobHeaders || {});
    }
    if (pathName.endsWith('/pipelines/10/test_report_summary')) {
      if (options.testReportStatus) return response({}, {}, options.testReportStatus);
      return response(fixtures.report);
    }
    if (pathName.endsWith('/pipelines/10')) {
      return response(fixtures.pipeline);
    }
    throw new Error(`Unexpected GitLab API path: ${pathName}`);
  };
}

function response(data, headers = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    json: async () => data,
  };
}

test('collects current revision-bound evidence from one explicitly linked merge request', async () => {
  const fixtures = baseFixtures();
  const result = await collectGitLabIssueEvidence({
    issueKey: 'VAN-1',
    projectId: PROJECT_ID,
    token: 'test-token',
    fetchImpl: makeFetch(fixtures),
    now: NOW,
  });

  assert.equal(result.status, 'evidence_current');
  assert.equal(result.expectedCommitSha, SHA);
  assert.equal(result.mergeRequest.iid, 1);
  assert.equal(result.pipeline.id, 10);
  assert.equal(result.summary.missingKinds.length, 0);
  assert.equal(result.assessments.some((item) => item.kind === 'security_scan_execution'), true);
  assert.equal(result.assessments.some((item) => item.kind === 'test_suite'), true);
  assert.equal(result.notes.some((note) => note.includes('does not prove')), true);
});

test('does not guess when the project has no merge request for the Jira issue', async () => {
  const fixtures = baseFixtures();
  fixtures.mergeRequests = [];
  const result = await collectGitLabIssueEvidence({
    issueKey: 'VAN-1',
    projectId: PROJECT_ID,
    token: 'test-token',
    fetchImpl: makeFetch(fixtures),
    now: NOW,
  });

  assert.equal(result.status, 'missing');
  assert.equal(result.summary.outcome, 'needs_review');
  assert.deepEqual(result.summary.missingKinds, [
    'pipeline',
    'test_suite',
    'security_scan_execution',
  ]);
});

test('marks merge requests with multiple Jira keys as conflicting', async () => {
  const fixtures = baseFixtures();
  fixtures.mergeRequests = [mergeRequest({ title: 'VAN-1 and VAN-2 shared change' })];
  const result = await collectGitLabIssueEvidence({
    issueKey: 'VAN-1',
    projectId: PROJECT_ID,
    token: 'test-token',
    fetchImpl: makeFetch(fixtures),
    now: NOW,
  });

  assert.equal(result.status, 'conflicting');
  assert.equal(result.summary.outcome, 'needs_review');
});

test('marks evidence from an earlier commit stale for the merge request head', async () => {
  const fixtures = baseFixtures();
  const oldSha = 'b'.repeat(40);
  fixtures.pipeline = pipeline({ sha: oldSha });
  fixtures.jobs = fixtures.jobs.map((item) => ({
    ...item,
    commit: { id: oldSha },
  }));
  const result = await collectGitLabIssueEvidence({
    issueKey: 'VAN-1',
    projectId: PROJECT_ID,
    token: 'test-token',
    fetchImpl: makeFetch(fixtures),
    now: NOW,
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.assessments.some((item) => item.status === 'stale'), true);
});

test('requires an explicit security scan execution record', async () => {
  const fixtures = baseFixtures();
  fixtures.jobs = fixtures.jobs.filter((item) => item.name !== 'security_scan');
  const result = await collectGitLabIssueEvidence({
    issueKey: 'VAN-1',
    projectId: PROJECT_ID,
    token: 'test-token',
    fetchImpl: makeFetch(fixtures),
    now: NOW,
  });

  assert.equal(result.status, 'needs_review');
  assert.deepEqual(result.summary.missingKinds, ['security_scan_execution']);
});

test('does not pass a pipeline when GitLab has no test report', async () => {
  const fixtures = baseFixtures();
  const result = await collectGitLabIssueEvidence({
    issueKey: 'VAN-1',
    projectId: PROJECT_ID,
    token: 'test-token',
    fetchImpl: makeFetch(fixtures, { testReportStatus: 404 }),
    now: NOW,
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.summary.counts.missing, 1);
  assert.equal(result.summary.missingKinds.includes('test_suite'), true);
});

test('refuses a conclusion when merge request pagination is incomplete', async () => {
  const fixtures = baseFixtures();
  fixtures.mergeRequestHeaders = { 'x-next-page': '2' };
  const result = await collectGitLabIssueEvidence({
    issueKey: 'VAN-1',
    projectId: PROJECT_ID,
    token: 'test-token',
    fetchImpl: makeFetch(fixtures),
    now: NOW,
    maxMergeRequestPages: 1,
  });

  assert.equal(result.status, 'incomplete');
  assert.equal(result.summary.outcome, 'needs_review');
});
