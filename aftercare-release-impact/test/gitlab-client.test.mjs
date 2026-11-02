import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGitLabProject,
  fetchGitLabTestReportSummary,
  GitLabApiError,
  listGitLabMergeRequests,
  listGitLabPipelineJobs,
} from '../src/backend/gitlab-client.mjs';

const TOKEN = 'glpat-test-token-never-log';
const jsonResponse = (data, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] || null },
  json: async () => data,
});

test('fetches a project only from the configured GitLab API origin', async () => {
  let calledUrl;
  let calledOptions;
  const project = {
    id: 42,
    path_with_namespace: 'group/project',
    web_url: 'https://gitlab.com/group/project',
  };
  const result = await fetchGitLabProject(42, TOKEN, async (url, options) => {
    calledUrl = url;
    calledOptions = options;
    return jsonResponse(project);
  });

  assert.equal(calledUrl, 'https://gitlab.com/api/v4/projects/42');
  assert.equal(calledOptions.headers['PRIVATE-TOKEN'], TOKEN);
  assert.equal(calledOptions.method, 'GET');
  assert.deepEqual(result, project);
});

test('rejects invalid project identifiers before making a request', async () => {
  let called = false;
  await assert.rejects(
    fetchGitLabProject('../other-project', TOKEN, async () => {
      called = true;
      return jsonResponse({});
    }),
    /positive integer/,
  );
  assert.equal(called, false);
});

test('does not expose an access token in API error messages', async () => {
  await assert.rejects(
    fetchGitLabProject(42, TOKEN, async () => jsonResponse({}, { status: 401 })),
    (error) => {
      assert.ok(error instanceof GitLabApiError);
      assert.equal(error.status, 401);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    },
  );
});

test('paginates merge requests and reports whether the result is complete', async () => {
  const urls = [];
  const result = await listGitLabMergeRequests(42, TOKEN, async (url) => {
    urls.push(url);
    if (url.includes('page=1')) {
      return jsonResponse([{ iid: 1 }], { headers: { 'x-next-page': '2' } });
    }
    return jsonResponse([{ iid: 2 }]);
  });

  assert.equal(urls.length, 2);
  assert.equal(result.complete, true);
  assert.deepEqual(result.mergeRequests.map((item) => item.iid), [1, 2]);
});

test('marks merge request search incomplete when the page cap is reached', async () => {
  const result = await listGitLabMergeRequests(42, TOKEN, async () => (
    jsonResponse([{ iid: 1 }], { headers: { 'x-next-page': '2' } })
  ), { maxPages: 1 });

  assert.equal(result.complete, false);
  assert.equal(result.mergeRequests.length, 1);
});

test('marks pipeline job collection incomplete when more than one page exists', async () => {
  const result = await listGitLabPipelineJobs(42, 99, TOKEN, async () => (
    jsonResponse([{ id: 10 }], { headers: { 'x-next-page': '2' } })
  ));

  assert.equal(result.complete, false);
  assert.equal(result.jobs.length, 1);
});

test('fetches GitLab test report summary through the expected endpoint', async () => {
  let calledUrl;
  const report = { total: { count: 1, success: 1, failed: 0, skipped: 0, error: 0 } };
  const result = await fetchGitLabTestReportSummary(42, 99, TOKEN, async (url) => {
    calledUrl = url;
    return jsonResponse(report);
  });

  assert.equal(calledUrl, 'https://gitlab.com/api/v4/projects/42/pipelines/99/test_report_summary');
  assert.deepEqual(result, report);
});
