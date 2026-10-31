import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ISSUE_FIELDS,
  MAX_RECENT_ISSUES,
  buildRecentIssuesPath,
  fetchProjectDashboard,
  formatUpdatedDate,
  getJiraErrorMessage,
  getProjectTypeLabel,
  getStatusAppearance,
} from '../src/frontend/project-dashboard-logic.mjs';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('builds an enhanced JQL query scoped to the selected project', () => {
  const path = buildRecentIssuesPath('AFTER');
  const query = new URL(path, 'https://jira.invalid');

  assert.equal(query.pathname, '/rest/api/3/search/jql');
  assert.equal(query.searchParams.get('jql'), 'project = "AFTER" ORDER BY updated DESC');
  assert.equal(query.searchParams.get('maxResults'), String(MAX_RECENT_ISSUES));
  assert.equal(query.searchParams.get('fields'), ISSUE_FIELDS);
});

test('escapes JQL string delimiters and URL-encodes the query as one parameter', () => {
  const maliciousLookingKey = 'SAFE" OR assignee is not EMPTY';
  const path = buildRecentIssuesPath(maliciousLookingKey);
  const query = new URL(path, 'https://jira.invalid');
  const jql = query.searchParams.get('jql');

  assert.equal(
    jql,
    'project = "SAFE\\" OR assignee is not EMPTY" ORDER BY updated DESC'
  );
  assert.equal(query.searchParams.getAll('jql').length, 1);
  assert.equal(query.searchParams.has('assignee'), false);
});

test('rejects a missing or blank project key before creating a query', () => {
  assert.throws(() => buildRecentIssuesPath(''), TypeError);
  assert.throws(() => buildRecentIssuesPath('   '), TypeError);
  assert.throws(() => buildRecentIssuesPath(null), TypeError);
});

test('maps Jira access, missing-resource, throttling and server failures safely', () => {
  assert.match(getJiraErrorMessage(401, 'project details'), /did not allow access/);
  assert.match(getJiraErrorMessage(403, 'work items'), /did not allow access/);
  assert.match(getJiraErrorMessage(404, 'project details'), /could not find/);
  assert.match(getJiraErrorMessage(429, 'work items'), /rate-limiting/);
  assert.match(getJiraErrorMessage(503, 'work items'), /HTTP 503/);
});

test('maps known Jira project types and handles unknown types', () => {
  assert.equal(getProjectTypeLabel('software'), 'Software project');
  assert.equal(getProjectTypeLabel('business'), 'Business project');
  assert.equal(getProjectTypeLabel('service_desk'), 'Service management project');
  assert.equal(getProjectTypeLabel('future_type'), 'Jira project');
});

test('maps common workflow states to supported semantic lozenge appearances', () => {
  assert.equal(getStatusAppearance('Done'), 'success');
  assert.equal(getStatusAppearance('RESOLVED'), 'success');
  assert.equal(getStatusAppearance('Blocked'), 'danger');
  assert.equal(getStatusAppearance('Failed'), 'danger');
  assert.equal(getStatusAppearance('In Review'), 'information');
  assert.equal(getStatusAppearance('In Progress'), 'information');
  assert.equal(getStatusAppearance('To Do'), 'warning');
  assert.equal(getStatusAppearance('Pending'), 'warning');
  assert.equal(getStatusAppearance('Custom status'), 'neutral');
  assert.equal(getStatusAppearance(undefined), 'neutral');
});

test('formats valid update timestamps and degrades safely for missing or invalid dates', () => {
  assert.equal(formatUpdatedDate(null), 'Update time unavailable');
  assert.equal(formatUpdatedDate('not-a-date'), 'Update time unavailable');
  assert.notEqual(formatUpdatedDate('2026-10-31T09:00:00.000Z'), 'Update time unavailable');
});

test('loads Jira project details and recent items as the current user', async () => {
  const calls = [];
  const project = { id: '10001', key: 'AFTER', name: 'Aftercare', projectTypeKey: 'software' };
  const issues = [{ id: '20001', key: 'AFTER-1', fields: { summary: 'Release change' } }];

  const result = await fetchProjectDashboard('AFTER', async (path, options) => {
    calls.push({ path, options });
    return path.includes('/search/jql') ? response({ issues }) : response(project);
  });

  assert.equal(calls.length, 2);
  assert.ok(calls.some((call) => call.path === '/rest/api/3/project/AFTER'));
  assert.ok(calls.some((call) => call.path.startsWith('/rest/api/3/search/jql?')));
  assert.ok(calls.every((call) => call.options.headers.Accept === 'application/json'));
  assert.deepEqual(result, { project, issues });
});

test('handles an empty or malformed issues collection without inventing work items', async () => {
  const result = await fetchProjectDashboard('AFTER', async (path) => (
    path.includes('/search/jql') ? response({ issues: null }) : response({ key: 'AFTER' })
  ));

  assert.deepEqual(result.issues, []);
});

test('encodes the project path segment in the metadata request', async () => {
  const calls = [];

  await fetchProjectDashboard('SAFE/KEY', async (path) => {
    calls.push(path);
    return path.includes('/search/jql') ? response({ issues: [] }) : response({ key: 'SAFE/KEY' });
  });

  assert.ok(calls.includes('/rest/api/3/project/SAFE%2FKEY'));
});

test('surfaces permission failures rather than presenting partial data as complete', async () => {
  await assert.rejects(
    () => fetchProjectDashboard('AFTER', async (path) => (
      path.includes('/search/jql') ? response({}, 403) : response({ key: 'AFTER' })
    )),
    /did not allow access to recent project work items/
  );
});

test('rejects an invalid Jira project response instead of crashing during rendering', async () => {
  await assert.rejects(
    () => fetchProjectDashboard('AFTER', async (path) => (
      path.includes('/search/jql') ? response({ issues: [] }) : response(null)
    )),
    /invalid project response/
  );
});

test('propagates provider/network failures so the UI can show its retry state', async () => {
  await assert.rejects(
    () => fetchProjectDashboard('AFTER', async () => {
      throw new Error('connection reset');
    }),
    /connection reset/
  );
});
