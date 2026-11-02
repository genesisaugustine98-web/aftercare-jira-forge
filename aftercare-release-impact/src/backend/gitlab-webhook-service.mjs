import {
  assessEvidence,
  EVIDENCE_STATUS,
  normalizeCommitSha,
  summarizeEvidence,
} from '../frontend/evidence-model.mjs';
import {
  normalizeGitLabJob,
  normalizeGitLabPipeline,
  resolveMergeRequestIssueLink,
} from '../frontend/gitlab-evidence-adapter.mjs';

const REQUIRED_KINDS = Object.freeze([
  'pipeline',
  'test_suite_execution',
  'security_scan_execution',
]);
const MAX_INDEX_SIZE = 500;
const MAX_JOBS_PER_PIPELINE = 200;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const JOB_KIND_BY_NAME = Object.freeze({
  unit_tests: 'test_suite_execution',
  tests: 'test_suite_execution',
  test: 'test_suite_execution',
  security_scan: 'security_scan_execution',
});

const key = (projectKey, suffix) => `gitlab.${projectKey}.${suffix}`;
const mrKey = (projectKey, iid) => key(projectKey, `mr.${iid}`);
const pipelineKey = (projectKey, id) => key(projectKey, `pipeline.${id}`);
const jobKey = (projectKey, id) => key(projectKey, `job.${id}`);
const issueMrIndexKey = (projectKey, issueKey) => key(projectKey, `issue-mrs.${issueKey}`);

async function getIndex(store, indexKey) {
  const value = await store.get(indexKey);
  return Array.isArray(value) ? value : [];
}

async function updateIndex(store, indexKey, value, add, limit = MAX_INDEX_SIZE) {
  const current = await getIndex(store, indexKey);
  const normalized = String(value);
  const next = add
    ? (current.includes(normalized) ? current : [...current, normalized])
    : current.filter((item) => String(item) !== normalized);

  if (next.length > limit) {
    return false;
  }

  await store.set(indexKey, next);
  return true;
}

function isTrustedGitLabUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === 'https://gitlab.com'
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

function issueKeysForMergeRequest(record) {
  if (record.linkStatus === 'linked' && record.issueKey) {
    return [record.issueKey];
  }
  return record.linkStatus === 'conflicting' ? record.candidates : [];
}

function makeMissingEvidence({
  id,
  kind,
  sourceUrl,
  commitSha,
  pipelineId,
  now,
  status = EVIDENCE_STATUS.MISSING,
  reason,
}) {
  return {
    id,
    kind,
    source: 'GitLab',
    sourceUrl,
    commitSha: normalizeCommitSha(commitSha),
    pipelineId: pipelineId == null ? undefined : String(pipelineId),
    observedAt: new Date(now).toISOString(),
    status,
    reason,
  };
}

function buildConflictSnapshot(issueKey, candidates, now) {
  return {
    status: 'conflicting',
    issueKey,
    message: 'Multiple GitLab merge requests or Jira issue references could match this work item.',
    candidates,
    assessments: [],
    summary: summarizeEvidence([], REQUIRED_KINDS),
    fetchedAt: new Date(now).toISOString(),
  };
}

function buildUnavailableSnapshot(issueKey, message, now) {
  return {
    status: 'unavailable',
    issueKey,
    message,
    assessments: [],
    summary: summarizeEvidence([], REQUIRED_KINDS),
    fetchedAt: new Date(now).toISOString(),
  };
}

async function recomputeIssueSnapshot({ projectKey, projectId, issueKey, store, now }) {
  if (await store.get(key(projectKey, 'mr-index-incomplete'))
    || await store.get(key(projectKey, `issue-index-incomplete.${issueKey}`))) {
    const snapshot = {
      status: 'incomplete',
      issueKey,
      message: 'The GitLab merge-request index exceeded the safe storage limit; absence cannot be established.',
      assessments: [],
      summary: summarizeEvidence([], REQUIRED_KINDS),
      fetchedAt: new Date(now).toISOString(),
    };
    await store.set(key(projectKey, `evidence.${issueKey}`), snapshot);
    return snapshot;
  }

  const mrIids = await getIndex(store, issueMrIndexKey(projectKey, issueKey));
  if (mrIids.length === 0) {
    const snapshot = {
      status: 'missing',
      issueKey,
      message: 'No GitLab merge request with one explicit matching Jira issue key has been received.',
      assessments: [],
      summary: summarizeEvidence([], REQUIRED_KINDS),
      fetchedAt: new Date(now).toISOString(),
    };
    await store.set(key(projectKey, `evidence.${issueKey}`), snapshot);
    return snapshot;
  }

  if (mrIids.length > 1) {
    const candidates = [];
    for (const iid of mrIids) {
      const mr = await store.get(mrKey(projectKey, iid));
      if (mr) candidates.push({ iid: mr.iid, title: mr.title, webUrl: mr.webUrl });
    }
    const snapshot = buildConflictSnapshot(issueKey, candidates, now);
    await store.set(key(projectKey, `evidence.${issueKey}`), snapshot);
    return snapshot;
  }

  const mr = await store.get(mrKey(projectKey, mrIids[0]));
  if (!mr || mr.linkStatus === 'conflicting') {
    const snapshot = buildConflictSnapshot(issueKey, mr?.candidates || [], now);
    await store.set(key(projectKey, `evidence.${issueKey}`), snapshot);
    return snapshot;
  }

  if (mr.linkStatus !== 'linked' || mr.issueKey !== issueKey) {
    const snapshot = {
      status: 'missing',
      issueKey,
      message: 'The merge request no longer contains one explicit matching Jira issue key.',
      assessments: [],
      summary: summarizeEvidence([], REQUIRED_KINDS),
      fetchedAt: new Date(now).toISOString(),
    };
    await store.set(key(projectKey, `evidence.${issueKey}`), snapshot);
    return snapshot;
  }

  const expectedCommitSha = normalizeCommitSha(mr.headSha);
  if (!expectedCommitSha || !mr.headShaVerified) {
    const snapshot = buildUnavailableSnapshot(
      issueKey,
      'The current merge-request head SHA has not been confirmed by a merge-request event.',
      now,
    );
    await store.set(key(projectKey, `evidence.${issueKey}`), snapshot);
    return snapshot;
  }

  const pipelineIds = await getIndex(store, key(projectKey, 'pipeline-index'));
  const pipelineRecords = [];
  for (const id of pipelineIds) {
    const pipeline = await store.get(pipelineKey(projectKey, id));
    if (pipeline && (pipeline.mergeRequestIid === String(mr.iid) || pipeline.ref === mr.sourceBranch)) {
      pipelineRecords.push(pipeline);
    }
  }

  const currentPipelines = pipelineRecords.filter(
    (pipeline) => normalizeCommitSha(pipeline.commitSha) === expectedCommitSha,
  );
  const candidates = currentPipelines.length > 0 ? currentPipelines : pipelineRecords;
  candidates.sort((left, right) => (
    new Date(right.updatedAt || right.observedAt).getTime()
    - new Date(left.updatedAt || left.observedAt).getTime()
  ));
  const selectedPipeline = candidates[0] || null;
  const assessments = [];

  if (await store.get(key(projectKey, 'pipeline-index-incomplete'))) {
    assessments.push(assessEvidence({
      evidence: makeMissingEvidence({
        id: `gitlab:incomplete-pipeline-index:${projectId}`,
        kind: 'ci_pipeline_collection',
        sourceUrl: mr.webUrl,
        commitSha: expectedCommitSha,
        now,
        status: EVIDENCE_STATUS.UNAVAILABLE,
        reason: 'The GitLab pipeline index exceeded the safe storage limit.',
      }),
      expectedCommitSha,
      now,
      maxAgeMs: MAX_AGE_MS,
    }));
  }

  if (!selectedPipeline) {
    assessments.push(assessEvidence({
      evidence: makeMissingEvidence({
        id: `gitlab:missing-pipeline:${projectId}:${mr.iid}`,
        kind: 'pipeline',
        sourceUrl: mr.webUrl,
        commitSha: expectedCommitSha,
        now,
        reason: 'No pipeline event has been received for this merge request branch.',
      }),
      expectedCommitSha,
      now,
      maxAgeMs: MAX_AGE_MS,
    }));
  } else {
    assessments.push(assessEvidence({
      evidence: selectedPipeline,
      expectedCommitSha,
      now,
      maxAgeMs: MAX_AGE_MS,
    }));

    const jobIds = await getIndex(store, key(projectKey, `pipeline-jobs.${selectedPipeline.pipelineId}`));
    const jobsByKind = new Map();

    for (const id of jobIds) {
      const job = await store.get(jobKey(projectKey, id));
      if (!job) continue;
      const previous = jobsByKind.get(job.kind);
      if (!previous || new Date(job.observedAt).getTime() > new Date(previous.observedAt).getTime()) {
        jobsByKind.set(job.kind, job);
      }
    }

    for (const kind of ['test_suite_execution', 'security_scan_execution']) {
      const job = jobsByKind.get(kind);
      if (job) {
        assessments.push(assessEvidence({
          evidence: job,
          expectedCommitSha,
          now,
          maxAgeMs: MAX_AGE_MS,
        }));
      } else {
        assessments.push(assessEvidence({
          evidence: makeMissingEvidence({
            id: `gitlab:missing-job:${projectId}:${selectedPipeline.pipelineId}:${kind}`,
            kind,
            sourceUrl: selectedPipeline.sourceUrl,
            commitSha: expectedCommitSha,
            pipelineId: selectedPipeline.pipelineId,
            now,
            reason: `No ${kind} job event has been received for the selected pipeline.`,
          }),
          expectedCommitSha,
          now,
          maxAgeMs: MAX_AGE_MS,
        }));
      }
    }

    if (await store.get(key(projectKey, `pipeline-jobs-incomplete.${selectedPipeline.pipelineId}`))) {
      assessments.push(assessEvidence({
        evidence: makeMissingEvidence({
          id: `gitlab:incomplete-job-index:${projectId}:${selectedPipeline.pipelineId}`,
          kind: 'ci_job_collection',
          sourceUrl: selectedPipeline.sourceUrl,
          commitSha: expectedCommitSha,
          pipelineId: selectedPipeline.pipelineId,
          now,
          status: EVIDENCE_STATUS.UNAVAILABLE,
          reason: 'The pipeline job index exceeded the safe storage limit.',
        }),
        expectedCommitSha,
        now,
        maxAgeMs: MAX_AGE_MS,
      }));
    }
  }

  const summary = summarizeEvidence(assessments, REQUIRED_KINDS);
  const snapshot = {
    status: summary.outcome,
    issueKey,
    expectedCommitSha,
    mergeRequest: {
      iid: mr.iid,
      title: mr.title,
      webUrl: mr.webUrl,
      sourceBranch: mr.sourceBranch,
      targetBranch: mr.targetBranch,
      state: mr.state,
    },
    pipeline: selectedPipeline ? {
      id: selectedPipeline.pipelineId,
      status: selectedPipeline.status,
      sha: selectedPipeline.commitSha,
      webUrl: selectedPipeline.sourceUrl,
      updatedAt: selectedPipeline.updatedAt || selectedPipeline.observedAt,
    } : null,
    assessments,
    summary,
    fetchedAt: new Date(now).toISOString(),
    notes: [
      'A successful security_scan job proves only that the configured job completed successfully; it does not prove that vulnerability findings are clear.',
      'Webhook evidence begins when the GitLab webhook is configured. Historical pipeline and job events are not backfilled.',
      'This is an evidence snapshot, not a release approval or an immutable audit decision.',
    ],
  };

  await store.set(key(projectKey, `evidence.${issueKey}`), snapshot);
  return snapshot;
}

async function handleMergeRequest({ projectKey, projectId, event, store, now, headShaVerified = true }) {
  const attributes = event.object_attributes || {};
  const iid = Number(attributes.iid);
  if (!Number.isSafeInteger(iid) || iid <= 0) {
    throw new TypeError('GitLab merge request event has no valid IID.');
  }

  const webUrl = attributes.url || attributes.web_url;
  if (!isTrustedGitLabUrl(webUrl)) {
    throw new TypeError('GitLab merge request URL is not trusted.');
  }

  const headSha = normalizeCommitSha(
    attributes.last_commit?.id || event.last_commit?.id,
  );
  const mergeRequest = {
    id: attributes.id,
    iid,
    project_id: projectId,
    title: attributes.title || '',
    description: attributes.description || '',
    source_branch: attributes.source_branch || '',
    target_branch: attributes.target_branch || '',
  };
  const link = resolveMergeRequestIssueLink(mergeRequest);
  const previous = await store.get(mrKey(projectKey, iid));
  const previousIssueKeys = previous ? issueKeysForMergeRequest(previous) : [];
  const candidates = link.status === 'linked'
    ? [link.issueKey]
    : link.status === 'conflicting' ? link.candidates : [];

  const record = {
    iid,
    projectId,
    title: mergeRequest.title,
    description: mergeRequest.description,
    sourceBranch: mergeRequest.source_branch,
    targetBranch: mergeRequest.target_branch,
    webUrl,
    headSha,
    headShaVerified: Boolean(headSha) && headShaVerified,
    state: attributes.state || attributes.action || 'unknown',
    updatedAt: attributes.updated_at || attributes.created_at || new Date(now).toISOString(),
    linkStatus: link.status,
    issueKey: link.issueKey || null,
    candidates,
  };

  await store.set(mrKey(projectKey, iid), record);
  const mrIndexComplete = await updateIndex(store, key(projectKey, 'mr-index'), iid, true);
  if (!mrIndexComplete) {
    await store.set(key(projectKey, 'mr-index-incomplete'), true);
  }

  const affectedIssues = [...new Set([...previousIssueKeys, ...candidates])];
  for (const issueKey of previousIssueKeys) {
    if (!candidates.includes(issueKey)) {
      await updateIndex(store, issueMrIndexKey(projectKey, issueKey), iid, false);
    }
  }
  for (const issueKey of candidates) {
    const complete = await updateIndex(store, issueMrIndexKey(projectKey, issueKey), iid, true);
    if (!complete) await store.set(key(projectKey, `issue-index-incomplete.${issueKey}`), true);
  }

  const snapshots = [];
  for (const issueKey of affectedIssues) {
    snapshots.push(await recomputeIssueSnapshot({
      projectKey, projectId, issueKey, store, now,
    }));
  }
  return { affectedIssues, snapshots };
}

async function handlePipeline({ projectKey, projectId, event, store, now }) {
  const attributes = event.object_attributes || {};
  const pipelineId = attributes.id;
  const pipelineInput = {
    id: pipelineId,
    project_id: projectId,
    status: attributes.status,
    sha: attributes.sha,
    ref: attributes.ref,
    web_url: attributes.url || attributes.web_url,
    created_at: attributes.created_at,
    updated_at: attributes.updated_at || attributes.finished_at,
  };

  const normalized = normalizeGitLabPipeline(pipelineInput, {
    gitlabBaseUrl: 'https://gitlab.com',
    expectedProjectId: projectId,
  });
  if (!normalized.valid) {
    throw new TypeError(normalized.error);
  }

  const record = {
    ...normalized.evidence,
    pipelineId: String(pipelineId),
    ref: pipelineInput.ref,
    mergeRequestIid: event.merge_request?.iid == null ? null : String(event.merge_request.iid),
    updatedAt: pipelineInput.updated_at || pipelineInput.created_at,
  };
  await store.set(pipelineKey(projectKey, pipelineId), record);

  // A pipeline event can include a linked MR summary. It may establish a
  // candidate Jira association, but it cannot independently confirm the MR
  // head SHA; a merge_request event must confirm that before evidence can pass.
  const associatedMr = event.merge_request;
  if (associatedMr?.iid != null && !await store.get(mrKey(projectKey, associatedMr.iid))) {
    const syntheticMrEvent = {
      object_kind: 'merge_request',
      project: { id: projectId },
      object_attributes: {
        id: associatedMr.id,
        iid: associatedMr.iid,
        title: associatedMr.title || '',
        description: '',
        source_branch: associatedMr.source_branch || '',
        target_branch: associatedMr.target_branch || '',
        url: associatedMr.url || associatedMr.web_url,
        state: associatedMr.state || 'unknown',
        updated_at: pipelineInput.updated_at || pipelineInput.created_at,
        last_commit: { id: pipelineInput.sha },
      },
    };
    if (isTrustedGitLabUrl(syntheticMrEvent.object_attributes.url)) {
      await handleMergeRequest({
        projectKey, projectId, event: syntheticMrEvent, store, now,
        headShaVerified: false,
      });
    }
  }

  const indexComplete = await updateIndex(store, key(projectKey, 'pipeline-index'), pipelineId, true);
  if (!indexComplete) await store.set(key(projectKey, 'pipeline-index-incomplete'), true);

  const mrIids = await getIndex(store, key(projectKey, 'mr-index'));
  const affectedIssues = new Set();
  for (const iid of mrIids) {
    const mr = await store.get(mrKey(projectKey, iid));
    if (mr?.sourceBranch === record.ref) {
      for (const issueKey of issueKeysForMergeRequest(mr)) affectedIssues.add(issueKey);
    }
  }

  const snapshots = [];
  for (const issueKey of affectedIssues) {
    snapshots.push(await recomputeIssueSnapshot({
      projectKey, projectId, issueKey, store, now,
    }));
  }
  return { affectedIssues: [...affectedIssues], snapshots };
}

async function handleJob({ projectKey, projectId, event, store, now }) {
  const pipelineId = event.pipeline_id;
  const buildId = event.build_id;
  const projectWebUrl = event.project?.web_url;
  const derivedJobUrl = isTrustedGitLabUrl(projectWebUrl)
    && Number.isSafeInteger(Number(buildId)) && Number(buildId) > 0
    ? `${projectWebUrl.replace(/\/$/, '')}/-/jobs/${buildId}`
    : undefined;
  const jobInput = {
    id: buildId,
    project_id: projectId,
    status: event.build_status,
    name: event.build_name,
    stage: event.build_stage,
    web_url: event.build_url || derivedJobUrl,
    created_at: event.build_created_at,
    started_at: event.build_started_at,
    finished_at: event.build_finished_at,
    // GitLab's job-hook commit.id is not the commit SHA; commit.sha is.
    commit: { id: event.commit?.sha },
    pipeline: { id: pipelineId },
  };
  const kind = JOB_KIND_BY_NAME[jobInput.name] || 'ci_job';
  const normalized = normalizeGitLabJob(jobInput, {
    gitlabBaseUrl: 'https://gitlab.com',
    expectedProjectId: projectId,
    expectedPipelineId: pipelineId,
    kind,
  });
  if (!normalized.valid) {
    throw new TypeError(normalized.error);
  }

  const record = {
    ...normalized.evidence,
    name: jobInput.name,
    stage: jobInput.stage,
  };
  await store.set(jobKey(projectKey, event.build_id), record);

  const indexComplete = await updateIndex(
    store,
    key(projectKey, `pipeline-jobs.${pipelineId}`),
    event.build_id,
    true,
    MAX_JOBS_PER_PIPELINE,
  );
  if (!indexComplete) {
    await store.set(key(projectKey, `pipeline-jobs-incomplete.${pipelineId}`), true);
  }

  const pipeline = await store.get(pipelineKey(projectKey, pipelineId));
  const affectedIssues = new Set();
  if (pipeline) {
    const mrIids = await getIndex(store, key(projectKey, 'mr-index'));
    for (const iid of mrIids) {
      const mr = await store.get(mrKey(projectKey, iid));
      if (mr && (String(mr.iid) === pipeline.mergeRequestIid || mr.sourceBranch === pipeline.ref)) {
        for (const issueKey of issueKeysForMergeRequest(mr)) affectedIssues.add(issueKey);
      }
    }
  }

  const snapshots = [];
  for (const issueKey of affectedIssues) {
    snapshots.push(await recomputeIssueSnapshot({
      projectKey, projectId, issueKey, store, now,
    }));
  }
  return { affectedIssues: [...affectedIssues], snapshots };
}

/**
 * Process a verified GitLab webhook event using only Forge storage.
 * No outbound GitLab API requests are made.
 */
export async function processGitLabWebhookEvent({
  projectKey,
  projectId,
  event,
  store,
  now = Date.now(),
}) {
  if (typeof projectKey !== 'string' || !/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    throw new TypeError('A valid Jira project key is required.');
  }
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new TypeError('A Forge-compatible storage adapter is required.');
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('GitLab webhook body must be an object.');
  }
  const eventProjectId = event.project?.id ?? event.project_id;
  if (Number(eventProjectId) !== Number(projectId)) {
    throw new TypeError('GitLab webhook project ID does not match the configured project.');
  }

  const common = { projectKey, projectId: Number(projectId), event, store, now };
  switch (event.object_kind) {
    case 'merge_request':
      return { eventKind: 'merge_request', ...(await handleMergeRequest(common)) };
    case 'pipeline':
      return { eventKind: 'pipeline', ...(await handlePipeline(common)) };
    case 'build':
      return { eventKind: 'build', ...(await handleJob(common)) };
    default:
      return {
        eventKind: String(event.object_kind || 'unknown'),
        affectedIssues: [],
        snapshots: [],
        ignored: true,
      };
  }
}

export const gitLabWebhookEvidencePolicy = Object.freeze({
  requiredKinds: REQUIRED_KINDS,
  maxAgeMs: MAX_AGE_MS,
  maxIndexSize: MAX_INDEX_SIZE,
  maxJobsPerPipeline: MAX_JOBS_PER_PIPELINE,
});
