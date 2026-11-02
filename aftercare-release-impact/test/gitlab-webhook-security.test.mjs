import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerprintGitLabEvent,
  getHeader,
  getQueryValue,
  safeSecretEqual,
} from '../src/backend/gitlab-webhook-security.mjs';

test('reads GitLab headers case-insensitively from Forge header arrays', () => {
  assert.equal(
    getHeader({ 'X-Gitlab-Token': ['secret-value'] }, 'x-gitlab-token'),
    'secret-value',
  );
  assert.equal(getHeader({ 'x-gitlab-event': ['Pipeline Hook'] }, 'X-Gitlab-Event'), 'Pipeline Hook');
  assert.equal(getHeader({}, 'x-gitlab-token'), '');
});

test('reads the first project key from Forge query parameter arrays', () => {
  assert.equal(getQueryValue({ projectKey: ['VAN'] }, 'projectKey'), 'VAN');
  assert.equal(getQueryValue({}, 'projectKey'), '');
});

test('compares webhook secrets safely and rejects missing or different values', () => {
  assert.equal(safeSecretEqual('same-secret', 'same-secret'), true);
  assert.equal(safeSecretEqual('wrong-secret', 'same-secret'), false);
  assert.equal(safeSecretEqual('short', 'same-secret'), false);
  assert.equal(safeSecretEqual('', 'same-secret'), false);
  assert.equal(safeSecretEqual('same-secret', undefined), false);
});

test('uses GitLab event UUID for stable retry deduplication', () => {
  const first = fingerprintGitLabEvent('pipeline', '{"status":"running"}', 'event-uuid-1');
  const retry = fingerprintGitLabEvent('pipeline', '{"status":"success"}', 'event-uuid-1');
  const next = fingerprintGitLabEvent('pipeline', '{"status":"success"}', 'event-uuid-2');

  assert.equal(first, retry);
  assert.notEqual(first, next);
});

test('falls back to a content fingerprint when GitLab supplies no event UUID', () => {
  const first = fingerprintGitLabEvent('build', '{"id":10,"status":"success"}');
  const duplicate = fingerprintGitLabEvent('build', '{"id":10,"status":"success"}');
  const changed = fingerprintGitLabEvent('build', '{"id":10,"status":"failed"}');

  assert.equal(first, duplicate);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});
