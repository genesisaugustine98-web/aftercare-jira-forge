import {
  assessEvidence,
  EVIDENCE_STATUS,
  normalizeCommitSha,
  summarizeEvidence,
} from '../frontend/evidence-model.mjs';
import {
  fetchGitLabMergeRequest,
  fetchGitLabPipeline,
  fetchGitLabTestReportSummary,
  GitLabApiError,
  listGitLabMergeRequests,
  listGitLabPipelineJobs,
} from './gitlab-client.mjs';
import {
  normalizeGitLabJob,
  normalizeGitLabPipeline,
  normalizeGitLabTestReport,
  resolveMergeRequestIssueLink,
} from '../frontend/gitlab-evidence-adapter.mjs';

const DEFAULT_REQUIRED_KINDS = Object.freeze([
  'pipeline',
  'test_suite',
  'security_scan_execution',
]);

const JOB_KIND_BY_NAME = Object.freeze({
  unit_tests: 'test_suite_execution',
  security_scan: 'security_scan_execution',
  package_source: 'build_execution',
  release_evidence: 'release_evidence_execution',
});

function isTrustedGitLabUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === 'https://gitlab.com'
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

function createFallbackEvidence({
  id,
  kind,
  status,
  sourceUrl,
  commitSha,
  pipelineId,
  now,
  reason,
}) {
  return {
    id,
    kind,
    status,
    source: 'GitLab',
    sourceUrl,
    commitSha: normalizeCommitSha(commitSha),
    pipelineId: pipelineId == null ? undefined : String(pipelineId),
    observedAt: new Date(now).toISOString(),
    reason,
  };
}

function assess(record, expectedCommitSha, now, maxAgeMs) {
  return assessEvidence({
    evidence: record,
    expectedCommitSha,
    now,
    maxAgeMs,
  });
}

function summarize(assessments, requiredKinds) {
  return summarizeEvidence(assessments, requiredKinds);
}

/**
 * Collect a single, current Jira issue's GitLab evidence. The service only
 * links merge requests that explicitly name exactly one Jira issue key.
 * It never guesses based on text similarity.
 */
export async function collectGitLabIssueEvidence({
  issueKey,
  projectId,
  token,
  fetchImpl,
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000,
  requiredKinds = DEFAULT_REQUIRED_KINDS,
  maxMergeRequestPages = 5,
}) {
  if (typeof issueKey !== 'string' || !/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) {
    throw new TypeError('A valid Jira issue key is required.');
  }

  const listing = await listGitLabMergeRequests(
    projectId,
    token,
    fetchImpl,
    { maxPages: maxMergeRequestPages },
  );

  if (!listing.complete) {
    return {
      status: 'incomplete',
      issueKey,
      message: 'The GitLab merge request list exceeded the safe pagination limit. No absence or readiness conclusion is made.',
      summary: summarize([], requiredKinds),
      assessments: [],
      fetchedAt: new Date(now).toISOString(),
    };
  }

  const matches = [];
  const conflicts = [];

  for (const mergeRequest of listing.mergeRequests) {
    const link = resolveMergeRequestIssueLink(mergeRequest);
    if (link.status === 'linked' && link.issueKey === issueKey) {
      matches.push(mergeRequest);
    } else if (link.status === 'conflicting' && link.candidates.includes(issueKey)) {
      conflicts.push({ mergeRequest, candidates: link.candidates });
    }
  }

  if (conflicts.length > 0 || matches.length > 1) {
    return {
      status: 'conflicting',
      issueKey,
      message: 'More than one possible GitLab change association exists. An explicit human link decision is required.',
      candidates: [
        ...matches.map((item) => ({ iid: item.iid, title: item.title, webUrl: item.web_url })),
        ...conflicts.map(({ mergeRequest, candidates }) => ({
          iid: mergeRequest.iid,
          title: mergeRequest.title,
          webUrl: mergeRequest.web_url,
          issueKeys: candidates,
        })),
      ],
      summary: summarize([], requiredKinds),
      assessments: [],
      fetchedAt: new Date(now).toISOString(),
    };
  }

  if (matches.length === 0) {
    return {
      status: 'missing',
      issueKey,
      message: 'No merge request with one explicit matching Jira issue key was found.',
      summary: summarize([], requiredKinds),
      assessments: [],
      fetchedAt: new Date(now).toISOString(),
    };
  }

  const listedMergeRequest = matches[0];
  const mergeRequest = await fetchGitLabMergeRequest(
    projectId,
    listedMergeRequest.iid,
    token,
    fetchImpl,
  );
  if (!isTrustedGitLabUrl(mergeRequest.web_url)
    || String(mergeRequest.project_id) !== String(projectId)
    || String(mergeRequest.iid) !== String(listedMergeRequest.iid)) {
    return {
      status: 'unavailable',
      issueKey,
      message: 'The GitLab merge request identity or source URL could not be verified.',
      summary: summarize([], requiredKinds),
      assessments: [],
      fetchedAt: new Date(now).toISOString(),
    };
  }

  const detailLink = resolveMergeRequestIssueLink(mergeRequest);

  if (detailLink.status !== 'linked' || detailLink.issueKey !== issueKey) {
    return {
      status: 'conflicting',
      issueKey,
      message: 'The full merge request record does not confirm the explicit Jira issue association.',
      mergeRequest: {
        iid: mergeRequest.iid,
        title: mergeRequest.title,
        webUrl: mergeRequest.web_url,
      },
      summary: summarize([], requiredKinds),
      assessments: [],
      fetchedAt: new Date(now).toISOString(),
    };
  }

  const rawHeadSha = mergeRequest.diff_refs?.head_sha ?? mergeRequest.sha;
  const expectedCommitSha = normalizeCommitSha(rawHeadSha);
  const mergeRequestSha = normalizeCommitSha(mergeRequest.sha);

  if (expectedCommitSha && mergeRequestSha && expectedCommitSha !== mergeRequestSha) {
    return {
      status: 'conflicting',
      issueKey,
      message: 'GitLab returned conflicting merge-request head commit identifiers.',
      mergeRequest: {
        iid: mergeRequest.iid,
        title: mergeRequest.title,
        webUrl: mergeRequest.web_url,
      },
      summary: summarize([], requiredKinds),
      assessments: [],
      fetchedAt: new Date(now).toISOString(),
    };
  }

  if (!expectedCommitSha) {
    return {
      status: 'unavailable',
      issueKey,
      message: 'GitLab did not provide a full source-head commit SHA for this merge request.',
      mergeRequest: {
        iid: mergeRequest.iid,
        title: mergeRequest.title,
        webUrl: mergeRequest.web_url,
      },
      summary: summarize([], requiredKinds),
      assessments: [],
      fetchedAt: new Date(now).toISOString(),
    };
  }

  const assessments = [];
  let pipeline = null;
  let jobsComplete = true;
  let testReportAvailable = false;
  const headPipelineId = mergeRequest.head_pipeline?.id;

  if (headPipelineId == null) {
    const missingPipeline = createFallbackEvidence({
      id: `gitlab:missing-pipeline:${projectId}:${mergeRequest.iid}`,
      kind: 'pipeline',
      status: EVIDENCE_STATUS.MISSING,
      sourceUrl: mergeRequest.web_url,
      commitSha: expectedCommitSha,
      now,
      reason: 'The merge request has no visible head pipeline.',
    });
    assessments.push(assess(missingPipeline, expectedCommitSha, now, maxAgeMs));
  } else {
    try {
      pipeline = await fetchGitLabPipeline(projectId, headPipelineId, token, fetchImpl);
      const normalizedPipeline = normalizeGitLabPipeline(pipeline, {
        gitlabBaseUrl: 'https://gitlab.com',
        expectedProjectId: projectId,
        expectedPipelineId: headPipelineId,
      });

      if (normalizedPipeline.valid) {
        assessments.push(assess(
          normalizedPipeline.evidence,
          expectedCommitSha,
          now,
          maxAgeMs,
        ));
      } else {
        const unavailablePipeline = createFallbackEvidence({
          id: `gitlab:unavailable-pipeline:${projectId}:${headPipelineId}`,
          kind: 'pipeline',
          status: EVIDENCE_STATUS.UNAVAILABLE,
          sourceUrl: mergeRequest.web_url,
          commitSha: pipeline.sha,
          pipelineId: headPipelineId,
          now,
          reason: normalizedPipeline.error,
        });
        assessments.push(assess(unavailablePipeline, expectedCommitSha, now, maxAgeMs));
        pipeline = null;
      }
    } catch (error) {
      const missing = error instanceof GitLabApiError && error.status === 404;
      const unavailablePipeline = createFallbackEvidence({
        id: `gitlab:unavailable-pipeline:${projectId}:${headPipelineId}`,
        kind: 'pipeline',
        status: missing ? EVIDENCE_STATUS.MISSING : EVIDENCE_STATUS.UNAVAILABLE,
        sourceUrl: mergeRequest.web_url,
        commitSha: expectedCommitSha,
        pipelineId: headPipelineId,
        now,
        reason: missing
          ? 'The head pipeline could not be found in GitLab.'
          : 'The head pipeline could not be retrieved from GitLab.',
      });
      assessments.push(assess(unavailablePipeline, expectedCommitSha, now, maxAgeMs));
    }
  }

  if (pipeline && pipeline.web_url) {
    try {
      const jobListing = await listGitLabPipelineJobs(
        projectId,
        pipeline.id,
        token,
        fetchImpl,
      );
      jobsComplete = jobListing.complete;

      for (const job of jobListing.jobs) {
        const kind = JOB_KIND_BY_NAME[job.name] || 'ci_job';
        const normalizedJob = normalizeGitLabJob(job, {
          gitlabBaseUrl: 'https://gitlab.com',
          expectedProjectId: projectId,
          expectedPipelineId: pipeline.id,
          kind,
        });

        if (normalizedJob.valid) {
          assessments.push(assess(
            normalizedJob.evidence,
            expectedCommitSha,
            now,
            maxAgeMs,
          ));
        } else {
          const unavailableJob = createFallbackEvidence({
            id: `gitlab:unavailable-job:${projectId}:${job.id ?? 'unknown'}`,
            kind,
            status: EVIDENCE_STATUS.UNAVAILABLE,
            sourceUrl: pipeline.web_url,
            commitSha: job.commit?.id,
            pipelineId: pipeline.id,
            now,
            reason: 'A GitLab job record could not be validated.',
          });
          assessments.push(assess(unavailableJob, expectedCommitSha, now, maxAgeMs));
        }
      }

      if (!jobsComplete) {
        const incompleteJobs = createFallbackEvidence({
          id: `gitlab:incomplete-jobs:${projectId}:${pipeline.id}`,
          kind: 'ci_job_collection',
          status: EVIDENCE_STATUS.UNAVAILABLE,
          sourceUrl: pipeline.web_url,
          commitSha: pipeline.sha,
          pipelineId: pipeline.id,
          now,
          reason: 'GitLab returned more than one page of pipeline jobs; the evidence set is incomplete.',
        });
        assessments.push(assess(incompleteJobs, expectedCommitSha, now, maxAgeMs));
      }
    } catch {
      const unavailableJobs = createFallbackEvidence({
        id: `gitlab:unavailable-jobs:${projectId}:${pipeline.id}`,
        kind: 'ci_job_collection',
        status: EVIDENCE_STATUS.UNAVAILABLE,
        sourceUrl: pipeline.web_url,
        commitSha: pipeline.sha,
        pipelineId: pipeline.id,
        now,
        reason: 'Pipeline jobs could not be retrieved from GitLab.',
      });
      assessments.push(assess(unavailableJobs, expectedCommitSha, now, maxAgeMs));
    }

    try {
      const report = await fetchGitLabTestReportSummary(
        projectId,
        pipeline.id,
        token,
        fetchImpl,
      );
      const normalizedReport = normalizeGitLabTestReport(report, pipeline, {
        gitlabBaseUrl: 'https://gitlab.com',
        expectedProjectId: projectId,
      });

      testReportAvailable = normalizedReport.valid;
      if (normalizedReport.valid) {
        assessments.push(assess(
          normalizedReport.evidence,
          expectedCommitSha,
          now,
          maxAgeMs,
        ));
      } else {
        const unavailableReport = createFallbackEvidence({
          id: `gitlab:unavailable-test-report:${projectId}:${pipeline.id}`,
          kind: 'test_suite',
          status: EVIDENCE_STATUS.UNAVAILABLE,
          sourceUrl: pipeline.web_url,
          commitSha: pipeline.sha,
          pipelineId: pipeline.id,
          now,
          reason: 'The GitLab test report could not be validated.',
        });
        assessments.push(assess(unavailableReport, expectedCommitSha, now, maxAgeMs));
      }
    } catch (error) {
      const missing = error instanceof GitLabApiError && error.status === 404;
      const missingReport = createFallbackEvidence({
        id: `gitlab:missing-test-report:${projectId}:${pipeline.id}`,
        kind: 'test_suite',
        status: missing ? EVIDENCE_STATUS.MISSING : EVIDENCE_STATUS.UNAVAILABLE,
        sourceUrl: pipeline.web_url,
        commitSha: pipeline.sha,
        pipelineId: pipeline.id,
        now,
        reason: missing
          ? 'GitLab has no test report summary for this pipeline.'
          : 'The GitLab test report could not be retrieved.',
      });
      assessments.push(assess(missingReport, expectedCommitSha, now, maxAgeMs));
    }
  } else {
    const missingTestReport = createFallbackEvidence({
      id: `gitlab:missing-test-report:${projectId}:${headPipelineId ?? mergeRequest.iid}`,
      kind: 'test_suite',
      status: EVIDENCE_STATUS.MISSING,
      sourceUrl: mergeRequest.web_url,
      commitSha: expectedCommitSha,
      pipelineId: headPipelineId,
      now,
      reason: 'No pipeline is available from which to retrieve a test report.',
    });
    assessments.push(assess(missingTestReport, expectedCommitSha, now, maxAgeMs));
  }

  const summary = summarize(assessments, requiredKinds);
  return {
    status: summary.outcome,
    issueKey,
    expectedCommitSha,
    mergeRequest: {
      iid: mergeRequest.iid,
      title: mergeRequest.title,
      webUrl: mergeRequest.web_url,
      sourceBranch: mergeRequest.source_branch,
      targetBranch: mergeRequest.target_branch,
    },
    pipeline: pipeline ? {
      id: pipeline.id,
      status: pipeline.status,
      sha: pipeline.sha,
      webUrl: pipeline.web_url,
      updatedAt: pipeline.updated_at,
    } : null,
    assessments,
    summary,
    fetchedAt: new Date(now).toISOString(),
    notes: [
      'A successful security_scan job proves only that the configured job completed successfully; it does not prove that a vulnerability report was empty.',
      'This is an evidence snapshot, not a release approval or an immutable audit decision.',
    ],
    testReportAvailable,
    jobsComplete,
  };
}
