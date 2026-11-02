import test from 'node:test';
import assert from 'node:assert/strict';
import { processGitLabWebhookEvent, recomputeGitLabIssueEvidence } from '../src/backend/gitlab-webhook-service.mjs';

const PROJECT_ID = 42;
const SHA = 'a'.repeat(40);
const OLD_SHA = 'b'.repeat(40);
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const FRESH = '2026-11-02T07:50:00.000Z';
const BRANCH = 'feature/VAN-1-payment';

function makeStore() {
  const values = new Map();
  return {
    get: async (key) => values.get(key),
    set: async (key, value) => { values.set(key, JSON.parse(JSON.stringify(value))); },
    values,
  };
}

function pipelineEvent(overrides = {}) {
  return {
    object_kind: 'pipeline',
    project: { id: PROJECT_ID },
    object_attributes: {
      id: 10,
      status: 'success',
      sha: SHA,
      ref: BRANCH,
      url: 'https://gitlab.com/acme/payments/-/pipelines/10',
      created_at: FRESH,
      updated_at: FRESH,
      ...overrides,
    },
  };
}

function jobEvent(id, name, overrides = {}) {
  return {
    object_kind: 'build',
    project: { id: PROJECT_ID, web_url: 'https://gitlab.com/acme/payments' },
    build_id: id,
    build_status: 'success',
    build_name: name,
    build_stage: 'verify',
    build_created_at: FRESH,
    build_started_at: FRESH,
    build_finished_at: FRESH,
    commit: { sha: SHA },
    pipeline_id: 10,
    ...overrides,
  };
}

function mergeRequestEvent(overrides = {}) {
  return {
    object_kind: 'merge_request',
    project: { id: PROJECT_ID },
    object_attributes: {
      id: 1001,
      iid: 1,
      title: 'VAN-1: validate payment change',
      description: 'Controlled change.',
      source_branch: BRANCH,
      target_branch: 'main',
      url: 'https://gitlab.com/acme/payments/-/merge_requests/1',
      state: 'opened',
      updated_at: FRESH,
      last_commit: { id: SHA },
      ...overrides,
    },
  };
}

async function seedCurrentEvidence(store) {
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: pipelineEvent(),
    store,
    now: NOW,
  });
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: jobEvent(101, 'unit_tests'),
    store,
    now: NOW,
  });
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: jobEvent(102, 'security_scan', { build_stage: 'secure' }),
    store,
    now: NOW,
  });
}

test('joins pipeline and job webhooks to an explicitly linked Jira issue', async () => {
  const store = makeStore();
  await seedCurrentEvidence(store);
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: customEvidenceEvent(),
    store,
    now: NOW,
  });

  const snapshot = result.snapshots[0];
  assert.equal(result.eventKind, 'aftercare_evidence');
  assert.equal(snapshot.status, 'evidence_current');
  assert.equal(snapshot.expectedCommitSha, SHA);
  assert.equal(snapshot.mergeRequest.iid, 1);
  assert.equal(snapshot.pipeline.id, '10');
  assert.deepEqual(snapshot.summary.missingKinds, []);
  assert.equal(snapshot.assessments.some((item) => item.kind === 'test_suite_execution'), true);
  assert.equal(snapshot.assessments.some((item) => item.kind === 'security_scan_execution'), true);
});

test('does not link a merge request without an explicit Jira issue key', async () => {
  const store = makeStore();
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent({
      title: 'Improve payment reliability',
      description: 'No Jira reference.',
      source_branch: 'feature/payment-reliability',
    }),
    store,
    now: NOW,
  });

  assert.deepEqual(result.affectedIssues, []);
  assert.equal(store.values.has('aftercare.evidence.VAN.VAN-1'), false);
});

test('marks merge requests with multiple Jira keys as conflicting', async () => {
  const store = makeStore();
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent({ title: 'VAN-1 and VAN-2 combined change' }),
    store,
    now: NOW,
  });

  assert.equal(result.snapshots.length, 2);
  assert.equal(result.snapshots.every((snapshot) => snapshot.status === 'conflicting'), true);
});

test('marks old pipeline and job events stale after the merge request head changes', async () => {
  const store = makeStore();
  await seedCurrentEvidence(store);
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent({ last_commit: { id: OLD_SHA } }),
    store,
    now: NOW,
  });

  const snapshot = result.snapshots[0];
  assert.equal(snapshot.status, 'needs_review');
  assert.equal(snapshot.expectedCommitSha, OLD_SHA);
  assert.equal(snapshot.assessments.some((item) => item.status === 'stale'), true);
});

test('requires security scan execution and does not claim vulnerability clearance', async () => {
  const store = makeStore();
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: pipelineEvent(),
    store,
    now: NOW,
  });
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: jobEvent(101, 'unit_tests'),
    store,
    now: NOW,
  });
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });

  assert.equal(result.snapshots[0].status, 'needs_review');
  assert.equal(result.snapshots[0].summary.missingKinds.includes('security_scan_execution'), true);
  assert.equal(result.snapshots[0].notes.some((note) => note.includes('does not prove')), true);
});

test('updates an issue association when a merge request changes its Jira key', async () => {
  const store = makeStore();
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent({
      title: 'VAN-2: revised association',
      description: '',
      source_branch: 'feature/VAN-2-payment',
    }),
    store,
    now: NOW + 1000,
  });

  assert.deepEqual(result.affectedIssues.sort(), ['VAN-1', 'VAN-2']);
  assert.equal(result.snapshots.find((snapshot) => snapshot.issueKey === 'VAN-1').status, 'missing');
  assert.equal(result.snapshots.find((snapshot) => snapshot.issueKey === 'VAN-2').status, 'needs_review');
});

test('rejects webhook events from a different GitLab project', async () => {
  await assert.rejects(
    processGitLabWebhookEvent({
      projectKey: 'VAN',
      projectId: PROJECT_ID,
      event: { ...mergeRequestEvent(), project: { id: 999 } },
      store: makeStore(),
      now: NOW,
    }),
    /does not match the configured project/,
  );
});

test('rejects a pipeline event with an untrusted URL', async () => {
  await assert.rejects(
    processGitLabWebhookEvent({
      projectKey: 'VAN',
      projectId: PROJECT_ID,
      event: pipelineEvent({ url: 'https://attacker.example/pipeline/10' }),
      store: makeStore(),
      now: NOW,
    }),
    /does not belong to the configured HTTPS GitLab instance/,
  );
});

test('does not associate a job event with an unobserved pipeline', async () => {
  const store = makeStore();
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: jobEvent(101, 'unit_tests', { pipeline_id: 999 }),
    store,
    now: NOW,
  });

  assert.deepEqual(result.affectedIssues, []);
  assert.equal((await store.get('gitlab.VAN.job.101')).pipelineId, '999');
  assert.equal((await store.get('gitlab.VAN.pipeline.10')), undefined);
});

test('keeps running jobs as not-run evidence', async () => {
  const store = makeStore();
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: pipelineEvent({ status: 'running' }),
    store,
    now: NOW,
  });
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: jobEvent(101, 'unit_tests', {
      build_status: 'running',
      build_finished_at: null,
    }),
    store,
    now: NOW,
  });
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: jobEvent(102, 'security_scan', {
      build_status: 'running',
      build_stage: 'secure',
      build_finished_at: null,
    }),
    store,
    now: NOW,
  });
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });

  assert.equal(result.snapshots[0].status, 'needs_review');
  assert.equal(result.snapshots[0].summary.counts.not_run, 3);
});

test('pipeline-linked MR summary is not treated as a verified head until an MR event arrives', async () => {
  const store = makeStore();
  const event = {
    ...pipelineEvent(),
    merge_request: {
      id: 1001,
      iid: 1,
      title: 'VAN-1: validate payment change',
      source_branch: BRANCH,
      target_branch: 'main',
      url: 'https://gitlab.com/acme/payments/-/merge_requests/1',
      state: 'opened',
    },
  };
  const pipelineResult = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event,
    store,
    now: NOW,
  });

  assert.equal(pipelineResult.snapshots[0].status, 'unavailable');
  assert.match(pipelineResult.snapshots[0].message, /head SHA has not been confirmed/);

  const mergeRequestResult = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });

  assert.equal(mergeRequestResult.snapshots[0].status, 'needs_review');
  assert.equal(mergeRequestResult.snapshots[0].expectedCommitSha, SHA);
});

test('recomputes freshness when an old snapshot is read after its 24-hour window', async () => {
  const store = makeStore();
  await seedCurrentEvidence(store);
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });

  const refreshed = await recomputeGitLabIssueEvidence({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    issueKey: 'VAN-1',
    store,
    now: NOW + (25 * 60 * 60 * 1000),
  });

  assert.equal(refreshed.status, 'needs_review');
  assert.equal(refreshed.summary.counts.stale, 3);
});

function customEvidenceEvent(overrides = {}) {
  return {
    object_kind: 'aftercare_evidence',
    project: { id: PROJECT_ID },
    generated_at: FRESH,
    pipeline: {
      id: 10,
      sha: SHA,
      ref: BRANCH,
      web_url: 'https://gitlab.com/acme/payments/-/pipelines/10',
    },
    test_report: {
      tests: 11,
      failures: 0,
      errors: 0,
      skipped: 0,
    },
    security_report: {
      total: 2,
      by_severity: { critical: 0, high: 0, medium: 1, low: 1 },
      blocking_findings: 0,
      decision: 'READY_FOR_HUMAN_REVIEW',
    },
    release_evidence: {
      decision: 'READY_FOR_HUMAN_REVIEW',
      human_approval_required: true,
      production_release_approved: false,
    },
    ...overrides,
  };
}

test('joins CI-published test, security and release summaries to the exact pipeline revision', async () => {
  const store = makeStore();
  await seedCurrentEvidence(store);
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: customEvidenceEvent(),
    store,
    now: NOW,
  });

  const snapshot = result.snapshots[0];
  assert.equal(snapshot.status, 'evidence_current');
  assert.deepEqual(snapshot.summary.missingKinds, []);
  assert.equal(snapshot.assessments.some((item) => item.kind === 'test_report'), true);
  assert.equal(snapshot.assessments.some((item) => item.kind === 'security_report'), true);
  assert.equal(snapshot.assessments.some((item) => item.kind === 'release_gate'), true);
  const security = snapshot.assessments.find((item) => item.kind === 'security_report');
  assert.equal(security.details.blockingFindings, 0);
  assert.equal(security.details.medium, 1);
});

test('blocks the evidence summary when Gatekeeper reports a HOLD', async () => {
  const store = makeStore();
  await seedCurrentEvidence(store);
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });
  const event = customEvidenceEvent({
    security_report: {
      total: 1,
      by_severity: { critical: 0, high: 1, medium: 0, low: 0 },
      blocking_findings: 1,
      decision: 'HOLD',
    },
  });
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event,
    store,
    now: NOW,
  });

  assert.equal(result.snapshots[0].status, 'needs_review');
  assert.equal(result.snapshots[0].summary.counts.failed, 1);
});

test('blocks the evidence summary when the JUnit report contains failures', async () => {
  const store = makeStore();
  await seedCurrentEvidence(store);
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });
  const event = customEvidenceEvent({
    test_report: { tests: 11, failures: 1, errors: 0, skipped: 0 },
  });
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event,
    store,
    now: NOW,
  });

  assert.equal(result.snapshots[0].status, 'needs_review');
  assert.equal(result.snapshots[0].assessments.find((item) => item.kind === 'test_report').status, 'failed');
});

test('marks CI-published report evidence stale when it belongs to another commit', async () => {
  const store = makeStore();
  await seedCurrentEvidence(store);
  await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });
  const event = customEvidenceEvent({
    pipeline: {
      id: 10,
      sha: OLD_SHA,
      ref: BRANCH,
      web_url: 'https://gitlab.com/acme/payments/-/pipelines/10',
    },
  });
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event,
    store,
    now: NOW,
  });

  assert.equal(result.snapshots[0].status, 'needs_review');
  assert.equal(result.snapshots[0].assessments.filter((item) => item.status === 'stale').length, 3);
});

test('rejects malformed CI-published report counts', async () => {
  await assert.rejects(
    processGitLabWebhookEvent({
      projectKey: 'VAN',
      projectId: PROJECT_ID,
      event: customEvidenceEvent({
        test_report: { tests: 2, failures: 2, errors: 2, skipped: 0 },
      }),
      store: makeStore(),
      now: NOW,
    }),
    /test-report counts are invalid/,
  );
});
