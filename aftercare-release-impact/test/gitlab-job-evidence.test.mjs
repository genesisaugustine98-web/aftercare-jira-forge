import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGitLabJob,
  normalizeGitLabTestReport,
} from '../src/frontend/gitlab-evidence-adapter.mjs';
import { assessEvidence, EVIDENCE_STATUS } from '../src/frontend/evidence-model.mjs';

const SHA = 'a'.repeat(40);
const PROJECT_ID = 4242;
const PIPELINE = {
  id: 9001,
  project_id: PROJECT_ID,
  sha: SHA,
  status: 'success',
  created_at: '2026-10-21T11:09:13.485Z',
  updated_at: '2026-10-21T11:10:21.662Z',
  web_url: 'https://gitlab.com/acme/showcase/-/pipelines/9001',
};
const JOB = {
  id: 12345,
  project_id: PROJECT_ID,
  status: 'success',
  stage: 'verify',
  name: 'unit_tests',
  web_url: 'https://gitlab.com/acme/showcase/-/jobs/12345',
  created_at: '2026-10-21T11:09:13.611Z',
  started_at: '2026-10-21T11:09:13.987Z',
  finished_at: '2026-10-21T11:09:27.690Z',
  commit: { id: SHA },
  pipeline: { id: PIPELINE.id },
};
const OPTIONS = {
  gitlabBaseUrl: 'https://gitlab.com',
  expectedProjectId: PROJECT_ID,
};

test('normalizes a GitLab job with project, pipeline and commit provenance', () => {
  const result = normalizeGitLabJob(JOB, { ...OPTIONS, kind: 'test_suite_execution' });

  assert.equal(result.valid, true);
  assert.equal(result.evidence.id, `gitlab:job:${PROJECT_ID}:12345`);
  assert.equal(result.evidence.kind, 'test_suite_execution');
  assert.equal(result.evidence.pipelineId, String(PIPELINE.id));
  assert.equal(result.evidence.commitSha, SHA);
  assert.equal(result.evidence.status, EVIDENCE_STATUS.PASSED);
});

test('requires the caller to assign an explicit job evidence category', () => {
  const result = normalizeGitLabJob(JOB, OPTIONS);

  assert.equal(result.valid, false);
  assert.match(result.error, /explicit evidence kind/);
});

test('maps active and cancelled jobs to non-passing states', () => {
  const cases = [
    ['created', EVIDENCE_STATUS.NOT_RUN],
    ['pending', EVIDENCE_STATUS.NOT_RUN],
    ['running', EVIDENCE_STATUS.NOT_RUN],
    ['preparing', EVIDENCE_STATUS.NOT_RUN],
    ['failed', EVIDENCE_STATUS.FAILED],
    ['canceled', EVIDENCE_STATUS.CANCELLED],
    ['skipped', EVIDENCE_STATUS.SKIPPED],
    ['manual', EVIDENCE_STATUS.SKIPPED],
  ];

  for (const [status, expected] of cases) {
    const result = normalizeGitLabJob({ ...JOB, status }, {
      ...OPTIONS,
      kind: 'ci_job',
    });
    assert.equal(result.valid, true);
    assert.equal(result.evidence.status, expected);
  }
});

test('rejects jobs from another project or GitLab origin', () => {
  assert.equal(normalizeGitLabJob({ ...JOB, project_id: 9 }, {
    ...OPTIONS,
    kind: 'ci_job',
  }).valid, false);

  assert.equal(normalizeGitLabJob({
    ...JOB,
    web_url: 'https://attacker.example/job/1',
  }, {
    ...OPTIONS,
    kind: 'ci_job',
  }).valid, false);
});

test('does not pass a job when its commit SHA is missing', () => {
  const result = normalizeGitLabJob({
    ...JOB,
    commit: { id: null },
  }, {
    ...OPTIONS,
    kind: 'test_suite_execution',
  });
  const assessment = assessEvidence({
    evidence: result.evidence,
    expectedCommitSha: SHA,
    now: Date.parse('2026-10-21T12:00:00.000Z'),
  });

  assert.equal(result.valid, true);
  assert.equal(assessment.status, EVIDENCE_STATUS.UNAVAILABLE);
});

test('normalizes a real-shape GitLab test report when all 11 tests pass', () => {
  const report = {
    total: { time: 0, count: 11, success: 11, failed: 0, skipped: 0, error: 0, suite_error: null },
    test_suites: [{
      name: 'unit_tests',
      total_time: 0,
      total_count: 11,
      success_count: 11,
      failed_count: 0,
      skipped_count: 0,
      error_count: 0,
      build_ids: [12345],
      suite_error: null,
    }],
  };
  const result = normalizeGitLabTestReport(report, PIPELINE, OPTIONS);

  assert.equal(result.valid, true);
  assert.equal(result.evidence.kind, 'test_suite');
  assert.equal(result.evidence.status, EVIDENCE_STATUS.PASSED);
  assert.equal(result.evidence.commitSha, SHA);
});

test('does not treat zero, skipped, failed or inconsistent test counts as passed', () => {
  const cases = [
    [{ count: 0, success: 0, failed: 0, skipped: 0, error: 0 }, EVIDENCE_STATUS.MISSING],
    [{ count: 3, success: 2, failed: 0, skipped: 1, error: 0 }, EVIDENCE_STATUS.SKIPPED],
    [{ count: 3, success: 2, failed: 1, skipped: 0, error: 0 }, EVIDENCE_STATUS.FAILED],
    [{ count: 3, success: 1, failed: 0, skipped: 0, error: 0 }, EVIDENCE_STATUS.CONFLICTING],
  ];

  for (const [total, expected] of cases) {
    const result = normalizeGitLabTestReport({ total }, PIPELINE, OPTIONS);
    assert.equal(result.valid, true);
    assert.equal(result.evidence.status, expected);
  }
});

test('rejects malformed test report aggregates', () => {
  const result = normalizeGitLabTestReport({
    total: { count: 1, success: -1, failed: 0, skipped: 0, error: 0 },
  }, PIPELINE, OPTIONS);

  assert.equal(result.valid, false);
});

test('marks a job from an earlier commit stale for the reviewed revision', () => {
  const result = normalizeGitLabJob({
    ...JOB,
    commit: { id: 'b'.repeat(40) },
  }, {
    ...OPTIONS,
    kind: 'test_suite_execution',
  });
  const assessment = assessEvidence({
    evidence: result.evidence,
    expectedCommitSha: SHA,
    now: Date.parse('2026-10-21T12:00:00.000Z'),
  });

  assert.equal(result.valid, true);
  assert.equal(assessment.status, EVIDENCE_STATUS.STALE);
});
