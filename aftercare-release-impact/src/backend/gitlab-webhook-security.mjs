import { createHash, timingSafeEqual } from 'node:crypto';

export function getHeader(headers, headerName) {
  const match = Object.entries(headers || {}).find(
    ([name]) => name.toLowerCase() === headerName.toLowerCase(),
  );
  if (!match) return '';
  const value = match[1];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export function getQueryValue(queryParameters, name) {
  const value = queryParameters?.[name];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export function safeSecretEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string'
    || !provided || !expected) {
    return false;
  }
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function fingerprintGitLabEvent(eventKind, body, eventUuid = '') {
  const source = eventUuid ? `${eventKind}:${eventUuid}` : `${eventKind}:${body}`;
  return createHash('sha256').update(source).digest('hex');
}
