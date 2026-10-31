import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ISSUE_FIELDS,
  MAX_RECENT_ISSUES,
  buildRecentIssuesPath,
  formatUpdatedDate,
  getJiraErrorMessage,
  getProjectTypeLabel,
  getStatusAppearance,
} from '../src/frontend/project-dashboard-logic.mjs';

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
