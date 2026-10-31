export const MAX_RECENT_ISSUES = 8;
export const ISSUE_FIELDS = 'summary,status,issuetype,priority,updated,assignee';

export function getJiraErrorMessage(status, resource) {
  if (status === 401 || status === 403) {
    return `Jira did not allow access to ${resource}. Confirm that you can browse this project and that the Aftercare app has been granted its read permission.`;
  }

  if (status === 404) {
    return `Jira could not find ${resource}, or your account cannot view it.`;
  }

  if (status === 429) {
    return `Jira is rate-limiting requests for ${resource}. Wait briefly and refresh.`;
  }

  return `Aftercare could not load ${resource} (HTTP ${status}). Please try again.`;
}

export function buildRecentIssuesPath(projectKey) {
  if (typeof projectKey !== 'string' || projectKey.trim().length === 0) {
    throw new TypeError('A non-empty Jira project key is required.');
  }

  // Escape JQL string delimiters before URL-encoding the complete expression.
  const escapedProjectKey = projectKey
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  const jql = `project = "${escapedProjectKey}" ORDER BY updated DESC`;

  const query = [
    ['jql', jql],
    ['maxResults', String(MAX_RECENT_ISSUES)],
    ['fields', ISSUE_FIELDS],
  ]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return `/rest/api/3/search/jql?${query}`;
}

export function getProjectTypeLabel(projectTypeKey) {
  const labels = {
    software: 'Software project',
    business: 'Business project',
    service_desk: 'Service management project',
  };

  return labels[projectTypeKey] || 'Jira project';
}

export function getStatusAppearance(status) {
  const normalizedStatus = (status || '').toLowerCase();

  if (['done', 'closed', 'resolved'].includes(normalizedStatus)) {
    return 'success';
  }

  if (['blocked', 'failed'].includes(normalizedStatus)) {
    return 'danger';
  }

  if (['in progress', 'in review', 'in development'].includes(normalizedStatus)) {
    return 'information';
  }

  if (['to do', 'open', 'selected for development', 'pending'].includes(normalizedStatus)) {
    return 'warning';
  }

  return 'neutral';
}

export function formatUpdatedDate(value) {
  if (!value) {
    return 'Update time unavailable';
  }

  const updatedDate = new Date(value);

  if (Number.isNaN(updatedDate.getTime())) {
    return 'Update time unavailable';
  }

  return updatedDate.toLocaleString();
}
