import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGitLabPipeline,
  resolveMergeRequestIssueLink,
} from '../src/frontend/gitlab-evidence-adapter.mjs';
import { assessEvidence, EVIDENCE_STATUS } from '../src/frontend/evidence-model.mjs';

const PIPELINE = {
  id: 901,
  project_id: 42,
  status: 'success',
  sha: 'a'.repeat(40),
  web_url: 'https://gitlab.com/acme/payments/-/pipelines/901',
  created_at: '2026-11-02T07:00:00.000Z',
  updated_at: '2026-11-02T07:30:00.000Z',
};

const OPTIONS = {
  gitlabBaseUrl: 'https://gitlab.com',
  expectedProjectId: 42,
};

test('normalizes a successful GitLab pipeline with exact project provenance', () => {
  const result = normalizeGitLabPipeline(PIPELINE, OPTIONS);

  assert.equal(result.valid, true);
  assert.equal(result.evidence.id, 'gitlab:pipeline:42:901');
  assert.equal(result.evidence.kind, 'pipeline');
  assert.equal(result.evidence.status, EVIDENCE_STATUS.PASSED);
  assert.equal(result.evidence.commitSha, PIPELINE.sha);
  assert.equal(result.evidence.sourceUrl, PIPELINE.web_url);
});

test('maps pending and running pipelines to not-run rather than passed', () => {
  for (const status of ['created', 'pending', 'preparing', 'running', 'scheduled']) {
    const result = normalizeGitLabPipeline({ ...PIPELINE, status }, OPTIONS);
    assert.equal(result.valid, true);
    assert.equal(result.evidence.status, EVIDENCE_STATUS.NOT_RUN);
  }
});

test('preserves failed, cancelled, skipped and manual pipeline states', () => {
  const cases = [
    ['failed', EVIDENCE_STATUS.FAILED],
    ['canceled', EVIDENCE_STATUS.CANCELLED],
    ['cancelled', EVIDENCE_STATUS.CANCELLED],
    ['skipped', EVIDENCE_STATUS.SKIPPED],
    ['manual', EVIDENCE_STATUS.SKIPPED],
  ];

  for (const [status, expected] of cases) {
    const result = normalizeGitLabPipeline({ ...PIPELINE, status }, OPTIONS);
    assert.equal(result.valid, true);
    assert.equal(result.evidence.status, expected);
  }
});

test('rejects pipeline URLs outside the configured GitLab origin', () => {
  const result = normalizeGitLabPipeline({
    ...PIPELINE,
    web_url: 'https://attacker.example/pipeline/901',
  }, OPTIONS);

  assert.equal(result.valid, false);
  assert.match(result.error, /configured HTTPS GitLab instance/);
});

test('rejects a pipeline from a different GitLab project', () => {
  const result = normalizeGitLabPipeline({ ...PIPELINE, project_id: 99 }, OPTIONS);

  assert.equal(result.valid, false);
  assert.match(result.error, /project does not match/);
});

test('requires an HTTPS GitLab base URL and a valid timestamp', () => {
  assert.equal(normalizeGitLabPipeline(PIPELINE, {
    ...OPTIONS,
    gitlabBaseUrl: 'http://gitlab.com',
  }).valid, false);

  assert.equal(normalizeGitLabPipeline({
    ...PIPELINE,
    updated_at: 'not-a-date',
    created_at: null,
  }, OPTIONS).valid, false);
});

test('keeps absent commit SHA explicit so assessment cannot claim a pass', () => {
  const result = normalizeGitLabPipeline({ ...PIPELINE, sha: null }, OPTIONS);

  assert.equal(result.valid, true);
  assert.equal(result.evidence.commitSha, null);
  const assessment = assessEvidence({
    evidence: result.evidence,
    expectedCommitSha: PIPELINE.sha,
    now: Date.parse('2026-11-02T08:00:00.000Z'),
  });
  assert.equal(assessment.status, EVIDENCE_STATUS.UNAVAILABLE);
});

test('links a merge request only when it names one explicit Jira issue key', () => {
  const result = resolveMergeRequestIssueLink({
    title: 'VAN-1 validate payment release',
    description: 'Checks the Fireblocks sandbox flow.',
    source_branch: 'feature/van-1-validation',
  });

  assert.equal(result.status, 'linked');
  assert.equal(result.issueKey, 'VAN-1');
});

test('does not guess a Jira link when no issue key is present', () => {
  const result = resolveMergeRequestIssueLink({
    title: 'Improve payment reliability',
    description: 'No Jira reference here.',
    source_branch: 'feature/payment-reliability',
  });

  assert.equal(result.status, 'missing');
  assert.equal(result.issueKey, null);
});

test('marks multiple Jira issue keys as conflicting instead of choosing one', () => {
  const result = resolveMergeRequestIssueLink({
    title: 'VAN-1 and VAN-2 combined change',
    description: 'Touches both items.',
  });

  assert.equal(result.status, 'conflicting');
  assert.deepEqual(result.candidates, ['VAN-1', 'VAN-2']);
  assert.equal(result.issueKey, null);
});
