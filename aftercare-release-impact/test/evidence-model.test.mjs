import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_FRESHNESS,
  EVIDENCE_STATUS,
  assessEvidence,
  normalizeCommitSha,
  summarizeEvidence,
  validateEvidenceRecord,
} from '../src/frontend/evidence-model.mjs';

const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const CURRENT_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function record(overrides = {}) {
  return {
    id: 'pipeline-901',
    kind: 'pipeline',
    source: 'GitLab',
    sourceUrl: 'https://gitlab.com/acme/payments/-/pipelines/901',
    commitSha: CURRENT_SHA,
    pipelineId: '901',
    observedAt: '2026-11-02T07:30:00.000Z',
    status: EVIDENCE_STATUS.PASSED,
    ...overrides,
  };
}

test('accepts only full immutable SHA-1 or SHA-256 identifiers', () => {
  assert.equal(normalizeCommitSha(CURRENT_SHA.toUpperCase()), CURRENT_SHA);
  assert.equal(normalizeCommitSha('c'.repeat(64)), 'c'.repeat(64));
  assert.equal(normalizeCommitSha(CURRENT_SHA.slice(0, 12)), null);
  assert.equal(normalizeCommitSha('feature/release'), null);
  assert.equal(normalizeCommitSha(''), null);
});

test('validates provenance and requires HTTPS source links', () => {
  assert.equal(validateEvidenceRecord(record()).valid, true);
  assert.equal(validateEvidenceRecord(record({ sourceUrl: 'http://gitlab.com/pipeline/1' })).valid, false);
  assert.equal(validateEvidenceRecord(record({ id: '' })).valid, false);
  assert.equal(validateEvidenceRecord(null).valid, false);
});

test('passes only evidence tied to the exact current revision and freshness window', () => {
  const result = assessEvidence({
    evidence: record(),
    expectedCommitSha: CURRENT_SHA,
    now: NOW,
  });

  assert.equal(result.status, EVIDENCE_STATUS.PASSED);
  assert.equal(result.freshness, EVIDENCE_FRESHNESS.CURRENT);
});

test('marks a successful pipeline from a different commit stale', () => {
  const result = assessEvidence({
    evidence: record({ commitSha: OTHER_SHA }),
    expectedCommitSha: CURRENT_SHA,
    now: NOW,
  });

  assert.equal(result.status, EVIDENCE_STATUS.STALE);
  assert.equal(result.freshness, EVIDENCE_FRESHNESS.STALE);
});

test('marks old evidence stale even when it belongs to the same commit', () => {
  const result = assessEvidence({
    evidence: record({ observedAt: '2026-10-30T07:30:00.000Z' }),
    expectedCommitSha: CURRENT_SHA,
    now: NOW,
  });

  assert.equal(result.status, EVIDENCE_STATUS.STALE);
});

test('does not pass evidence without a commit SHA', () => {
  const result = assessEvidence({
    evidence: record({ commitSha: null }),
    expectedCommitSha: CURRENT_SHA,
    now: NOW,
  });

  assert.equal(result.status, EVIDENCE_STATUS.UNAVAILABLE);
  assert.equal(result.freshness, EVIDENCE_FRESHNESS.UNKNOWN);
});

test('does not pass evidence when the reviewed change has no valid SHA', () => {
  const result = assessEvidence({
    evidence: record(),
    expectedCommitSha: 'main',
    now: NOW,
  });

  assert.equal(result.status, EVIDENCE_STATUS.UNAVAILABLE);
});

test('preserves failed, skipped, not-run, missing and conflicting states', () => {
  for (const status of [
    EVIDENCE_STATUS.FAILED,
    EVIDENCE_STATUS.CANCELLED,
    EVIDENCE_STATUS.SKIPPED,
    EVIDENCE_STATUS.NOT_RUN,
    EVIDENCE_STATUS.MISSING,
    EVIDENCE_STATUS.CONFLICTING,
    EVIDENCE_STATUS.NOT_APPLICABLE,
  ]) {
    const result = assessEvidence({
      evidence: record({ status }),
      expectedCommitSha: CURRENT_SHA,
      now: NOW,
    });
    assert.equal(result.status, status);
  }
});

test('rejects future observation times and invalid freshness policy', () => {
  const future = assessEvidence({
    evidence: record({ observedAt: '2026-11-02T09:00:00.000Z' }),
    expectedCommitSha: CURRENT_SHA,
    now: NOW,
  });
  const invalidPolicy = assessEvidence({
    evidence: record(),
    expectedCommitSha: CURRENT_SHA,
    now: NOW,
    maxAgeMs: -1,
  });

  assert.equal(future.status, EVIDENCE_STATUS.UNAVAILABLE);
  assert.equal(invalidPolicy.status, EVIDENCE_STATUS.UNAVAILABLE);
});

test('summarizes incomplete coverage without producing a green outcome', () => {
  const assessments = [
    assessEvidence({ evidence: record(), expectedCommitSha: CURRENT_SHA, now: NOW }),
  ];
  const summary = summarizeEvidence(assessments, ['pipeline', 'security_scan']);

  assert.equal(summary.coverage, 'incomplete');
  assert.deepEqual(summary.missingKinds, ['security_scan']);
  assert.equal(summary.outcome, 'needs_review');
  assert.equal(summary.hasBlockingEvidence, true);
});

test('does not claim complete coverage when no requirements are configured', () => {
  const summary = summarizeEvidence([], []);

  assert.equal(summary.coverage, 'unknown');
  assert.equal(summary.outcome, 'unknown');
});

test('does not accept an abbreviated commit hash as revision proof', () => {
  const result = assessEvidence({
    evidence: record({ commitSha: CURRENT_SHA.slice(0, 12) }),
    expectedCommitSha: CURRENT_SHA,
    now: NOW,
  });

  assert.equal(result.status, EVIDENCE_STATUS.UNAVAILABLE);
  assert.equal(result.freshness, EVIDENCE_FRESHNESS.UNKNOWN);
});

test('preserves a missing-evidence record without inventing a source URL', () => {
  const missing = record({ status: EVIDENCE_STATUS.MISSING, sourceUrl: null, commitSha: null });
  const validation = validateEvidenceRecord(missing);
  const result = assessEvidence({ evidence: missing, expectedCommitSha: CURRENT_SHA, now: NOW });

  assert.equal(validation.valid, true);
  assert.equal(result.status, EVIDENCE_STATUS.MISSING);
});

test('does not return a green outcome when checks pass but no policy is configured', () => {
  const passed = assessEvidence({ evidence: record(), expectedCommitSha: CURRENT_SHA, now: NOW });
  const summary = summarizeEvidence([passed], []);

  assert.equal(summary.coverage, 'unknown');
  assert.equal(summary.outcome, 'unknown');
});

test('returns needs-review when configured evidence is entirely absent', () => {
  const summary = summarizeEvidence([], ['pipeline', 'test_suite']);

  assert.equal(summary.coverage, 'incomplete');
  assert.deepEqual(summary.missingKinds, ['pipeline', 'test_suite']);
  assert.equal(summary.hasBlockingEvidence, true);
  assert.equal(summary.outcome, 'needs_review');
});
