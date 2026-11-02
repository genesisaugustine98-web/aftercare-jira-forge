const GITLAB_API_BASE = 'https://gitlab.com/api/v4';

export class GitLabApiError extends Error {
  constructor(status, message = `GitLab API returned HTTP ${status}.`) {
    super(message);
    this.name = 'GitLabApiError';
    this.status = status;
  }
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return number;
}

async function requestJson(path, token, fetchImpl) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) {
    throw new TypeError('A valid GitLab access token is required.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required.');
  }

  const url = new URL(path, GITLAB_API_BASE);
  if (url.origin !== 'https://gitlab.com' || !url.pathname.startsWith('/api/v4/')) {
    throw new TypeError('GitLab API request URL is outside the configured API origin.');
  }

  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'PRIVATE-TOKEN': token,
    },
  });

  if (!response?.ok) {
    throw new GitLabApiError(response?.status || 0);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new GitLabApiError(502, 'GitLab API returned an unreadable JSON response.');
  }

  return { data, response };
}

export async function fetchGitLabProject(projectId, token, fetchImpl) {
  const id = requirePositiveInteger(projectId, 'GitLab project ID');
  const { data } = await requestJson(`/projects/${id}`, token, fetchImpl);
  if (!data || Number(data.id) !== id || typeof data.path_with_namespace !== 'string'
    || typeof data.web_url !== 'string') {
    throw new GitLabApiError(502, 'GitLab returned an invalid project record.');
  }
  return data;
}

export async function listGitLabMergeRequests(
  projectId,
  token,
  fetchImpl,
  { maxPages = 5 } = {},
) {
  const id = requirePositiveInteger(projectId, 'GitLab project ID');
  const pageLimit = requirePositiveInteger(maxPages, 'Maximum page count');
  const mergeRequests = [];
  let page = 1;

  while (page <= pageLimit) {
    const query = new URLSearchParams({
      state: 'all',
      per_page: '100',
      page: String(page),
      order_by: 'updated_at',
      sort: 'desc',
    });
    const { data, response } = await requestJson(
      `/projects/${id}/merge_requests?${query.toString()}`,
      token,
      fetchImpl,
    );

    if (!Array.isArray(data)) {
      throw new GitLabApiError(502, 'GitLab returned an invalid merge request collection.');
    }

    mergeRequests.push(...data);
    const nextPage = response.headers?.get?.('x-next-page');
    if (!nextPage) {
      return { mergeRequests, complete: true };
    }

    const parsedNextPage = Number(nextPage);
    if (!Number.isSafeInteger(parsedNextPage) || parsedNextPage <= page) {
      return { mergeRequests, complete: false };
    }
    page = parsedNextPage;
  }

  return { mergeRequests, complete: false };
}

export async function fetchGitLabMergeRequest(projectId, mergeRequestIid, token, fetchImpl) {
  const id = requirePositiveInteger(projectId, 'GitLab project ID');
  const iid = requirePositiveInteger(mergeRequestIid, 'Merge request IID');
  const { data } = await requestJson(
    `/projects/${id}/merge_requests/${iid}`,
    token,
    fetchImpl,
  );
  return data;
}

export async function fetchGitLabPipeline(projectId, pipelineId, token, fetchImpl) {
  const id = requirePositiveInteger(projectId, 'GitLab project ID');
  const pipeline = requirePositiveInteger(pipelineId, 'GitLab pipeline ID');
  const { data } = await requestJson(
    `/projects/${id}/pipelines/${pipeline}`,
    token,
    fetchImpl,
  );
  return data;
}

export async function listGitLabPipelineJobs(projectId, pipelineId, token, fetchImpl) {
  const id = requirePositiveInteger(projectId, 'GitLab project ID');
  const pipeline = requirePositiveInteger(pipelineId, 'GitLab pipeline ID');
  const query = new URLSearchParams({
    include_retried: 'true',
    per_page: '100',
    page: '1',
  });
  const { data, response } = await requestJson(
    `/projects/${id}/pipelines/${pipeline}/jobs?${query.toString()}`,
    token,
    fetchImpl,
  );
  if (!Array.isArray(data)) {
    throw new GitLabApiError(502, 'GitLab returned an invalid pipeline job collection.');
  }
  return {
    jobs: data,
    complete: !response.headers?.get?.('x-next-page'),
  };
}

export async function fetchGitLabTestReportSummary(projectId, pipelineId, token, fetchImpl) {
  const id = requirePositiveInteger(projectId, 'GitLab project ID');
  const pipeline = requirePositiveInteger(pipelineId, 'GitLab pipeline ID');
  const { data } = await requestJson(
    `/projects/${id}/pipelines/${pipeline}/test_report_summary`,
    token,
    fetchImpl,
  );
  return data;
}
