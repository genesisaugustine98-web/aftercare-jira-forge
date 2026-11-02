import test from 'node:test';
import assert from 'node:assert/strict';
import { processGitLabWebhookEvent } from '../src/backend/gitlab-webhook-service.mjs';

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
    set: async (key, value) => { values.set(key, structuredClone(value)); },
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
    project: { id: PROJECT_ID },
    build_id: id,
    build_status: 'success',
    build_name: name,
    build_stage: 'verify',
    build_url: `https://gitlab.com/acme/payments/-/jobs/${id}`,
    build_created_at: FRESH,
    build_started_at: FRESH,
    build_finished_at: FRESH,
    commit: { id: SHA },
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
  const result = await processGitLabWebhookEvent({
    projectKey: 'VAN',
    projectId: PROJECT_ID,
    event: mergeRequestEvent(),
    store,
    now: NOW,
  });

  const snapshot = result.snapshots[0];
  assert.equal(result.eventKind, 'merge_request');
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
  assert.deepEqual(result.snapshots[0].summary.missingKinds, ['security_scan_execution']);
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

test('rejects a job event linked to a different pipeline', async () => {
  await assert.rejects(
    processGitLabWebhookEvent({
      projectKey: 'VAN',
      projectId: PROJECT_ID,
      event: jobEvent(101, 'unit_tests', { pipeline_id: 999 }),
      store: makeStore(),
      now: NOW,
    }),
    /different pipeline/,
  );
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
