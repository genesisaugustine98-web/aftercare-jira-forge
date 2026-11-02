/**
 * Canonical evidence states used by Aftercare's release-assurance model.
 *
 * Evidence is only current when it is traceable to the exact source revision
 * being assessed. A green pipeline result for a different commit is stale,
 * not a pass. This module is deliberately provider-neutral so GitLab and
 * future CI/security providers can use the same semantics.
 */

export const EVIDENCE_STATUS = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
  NOT_RUN: 'not_run',
  MISSING: 'missing',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
  CONFLICTING: 'conflicting',
  NOT_APPLICABLE: 'not_applicable',
});

export const EVIDENCE_FRESHNESS = Object.freeze({
  CURRENT: 'current',
  STALE: 'stale',
  UNKNOWN: 'unknown',
});

const ALLOWED_STATUSES = new Set(Object.values(EVIDENCE_STATUS));
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

/**
 * Normalize commit identifiers without accepting branch names or arbitrary
 * strings. Only full SHA-1 or SHA-256 identifiers are accepted so a prefix
 * collision can never be mistaken for proof of an exact revision.
 */
export function normalizeCommitSha(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return SHA_PATTERN.test(normalized) ? normalized : null;
}

function parseTimestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Validate the minimum provenance needed to preserve an evidence record.
 * Provider payloads should be adapted to this shape before they are stored.
 */
export function validateEvidenceRecord(record) {
  const errors = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: ['Evidence record must be an object.'] };
  }

  if (typeof record.id !== 'string' || !record.id.trim()) {
    errors.push('Evidence record requires a stable id.');
  }

  if (typeof record.kind !== 'string' || !record.kind.trim()) {
    errors.push('Evidence record requires a kind.');
  }

  if (!ALLOWED_STATUSES.has(record.status)) {
    errors.push('Evidence record has an unsupported status.');
  }

  if (typeof record.source !== 'string' || !record.source.trim()) {
    errors.push('Evidence record requires a source name.');
  }

  const sourceLinkOptional = [EVIDENCE_STATUS.MISSING, EVIDENCE_STATUS.NOT_RUN,
    EVIDENCE_STATUS.UNAVAILABLE].includes(record.status);
  if (record.sourceUrl == null || record.sourceUrl === '') {
    if (!sourceLinkOptional) {
      errors.push('Evidence record requires an HTTPS source URL.');
    }
  } else if (typeof record.sourceUrl !== 'string' || !isSafeHttpsUrl(record.sourceUrl)) {
    errors.push('Evidence source URL must use HTTPS.');
  }

  if (record.commitSha != null && !normalizeCommitSha(record.commitSha)) {
    errors.push('Commit SHA must be a hexadecimal commit identifier.');
  }

  if (record.observedAt != null && parseTimestamp(record.observedAt) == null) {
    errors.push('Observed time must be a valid date or timestamp.');
  }

  return { valid: errors.length === 0, errors };
}

function isSafeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Assess one evidence record against the exact commit under review.
 *
 * Order matters:
 * 1. Invalid or inaccessible evidence never becomes a pass.
 * 2. A different commit always makes evidence stale for this revision.
 * 3. Explicit non-success states remain distinct.
 * 4. A pass requires a matching commit and a trustworthy observation time.
 */
export function assessEvidence({
  evidence,
  expectedCommitSha,
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000,
}) {
  const validation = validateEvidenceRecord(evidence);

  if (!validation.valid) {
    return assessment(evidence, EVIDENCE_STATUS.UNAVAILABLE, EVIDENCE_FRESHNESS.UNKNOWN,
      validation.errors.join(' '));
  }

  const expectedSha = normalizeCommitSha(expectedCommitSha);
  if (!expectedSha) {
    return assessment(evidence, EVIDENCE_STATUS.UNAVAILABLE, EVIDENCE_FRESHNESS.UNKNOWN,
      'The change under review has no valid commit SHA; revision-specific evidence cannot be verified.');
  }

  if (evidence.status === EVIDENCE_STATUS.NOT_APPLICABLE) {
    return assessment(evidence, EVIDENCE_STATUS.NOT_APPLICABLE, EVIDENCE_FRESHNESS.UNKNOWN,
      'This evidence type was explicitly marked not applicable.');
  }

  if (evidence.status === EVIDENCE_STATUS.MISSING
    || evidence.status === EVIDENCE_STATUS.NOT_RUN
    || evidence.status === EVIDENCE_STATUS.SKIPPED
    || evidence.status === EVIDENCE_STATUS.UNAVAILABLE
    || evidence.status === EVIDENCE_STATUS.CONFLICTING
    || evidence.status === EVIDENCE_STATUS.FAILED
    || evidence.status === EVIDENCE_STATUS.CANCELLED) {
    return assessment(evidence, evidence.status, EVIDENCE_FRESHNESS.UNKNOWN,
      evidence.reason || defaultReason(evidence.status));
  }

  const evidenceSha = normalizeCommitSha(evidence.commitSha);
  if (!evidenceSha) {
    return assessment(evidence, EVIDENCE_STATUS.UNAVAILABLE, EVIDENCE_FRESHNESS.UNKNOWN,
      'The source did not provide a commit SHA, so this result cannot prove the current revision.');
  }

  // Exact equality is required. Prefix matches are not proof of identity.
  if (expectedSha !== evidenceSha) {
    return assessment(evidence, EVIDENCE_STATUS.STALE, EVIDENCE_FRESHNESS.STALE,
      'Evidence belongs to a different commit than the revision currently under review.');
  }

  const observedAt = parseTimestamp(evidence.observedAt);
  const nowTimestamp = parseTimestamp(now);

  if (observedAt == null || nowTimestamp == null || observedAt > nowTimestamp) {
    return assessment(evidence, EVIDENCE_STATUS.UNAVAILABLE, EVIDENCE_FRESHNESS.UNKNOWN,
      'Evidence observation time is missing, invalid, or in the future.');
  }

  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    return assessment(evidence, EVIDENCE_STATUS.UNAVAILABLE, EVIDENCE_FRESHNESS.UNKNOWN,
      'Evidence freshness policy is invalid.');
  }

  if (nowTimestamp - observedAt > maxAgeMs) {
    return assessment(evidence, EVIDENCE_STATUS.STALE, EVIDENCE_FRESHNESS.STALE,
      'Evidence is older than the configured freshness window.');
  }

  return assessment(evidence, EVIDENCE_STATUS.PASSED, EVIDENCE_FRESHNESS.CURRENT,
    'Evidence matches the reviewed commit and is within the freshness window.');
}

function assessment(evidence, status, freshness, reason) {
  return {
    evidenceId: typeof evidence?.id === 'string' ? evidence.id : null,
    kind: typeof evidence?.kind === 'string' ? evidence.kind : 'unknown',
    source: typeof evidence?.source === 'string' ? evidence.source : 'unknown',
    sourceUrl: typeof evidence?.sourceUrl === 'string' ? evidence.sourceUrl : null,
    commitSha: normalizeCommitSha(evidence?.commitSha),
    pipelineId: evidence?.pipelineId == null ? null : String(evidence.pipelineId),
    observedAt: evidence?.observedAt ?? null,
    details: evidence?.details && typeof evidence.details === 'object' ? evidence.details : null,
    status,
    freshness,
    reason,
  };
}

function defaultReason(status) {
  const reasons = {
    [EVIDENCE_STATUS.FAILED]: 'The source reports that this check failed.',
    [EVIDENCE_STATUS.CANCELLED]: 'The source reports that this check was cancelled before a successful result.',
    [EVIDENCE_STATUS.SKIPPED]: 'The source reports that this check was skipped.',
    [EVIDENCE_STATUS.NOT_RUN]: 'This check has not run.',
    [EVIDENCE_STATUS.MISSING]: 'No evidence was supplied for this requirement.',
    [EVIDENCE_STATUS.UNAVAILABLE]: 'The evidence source is unavailable.',
    [EVIDENCE_STATUS.CONFLICTING]: 'Sources disagree about the result or its provenance.',
  };

  return reasons[status] || 'The evidence is not a successful current result.';
}

/**
 * Summarize evidence without collapsing unknown or missing states into green.
 * A complete result requires at least one record for every required kind.
 */
export function summarizeEvidence(assessments, requiredKinds = []) {
  const counts = Object.fromEntries(
    Object.values(EVIDENCE_STATUS).map((status) => [status, 0]),
  );

  for (const item of assessments || []) {
    if (item && Object.hasOwn(counts, item.status)) {
      counts[item.status] += 1;
    }
  }

  const nonCoverageStatuses = new Set([
    EVIDENCE_STATUS.MISSING,
    EVIDENCE_STATUS.NOT_RUN,
    EVIDENCE_STATUS.UNAVAILABLE,
  ]);
  const presentKinds = new Set((assessments || [])
    .filter((item) => item && !nonCoverageStatuses.has(item.status))
    .map((item) => item.kind)
    .filter(Boolean));
  const missingKinds = [...new Set(requiredKinds)].filter((kind) => !presentKinds.has(kind));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const hasBlockingEvidence = [
    EVIDENCE_STATUS.FAILED,
    EVIDENCE_STATUS.CANCELLED,
    EVIDENCE_STATUS.MISSING,
    EVIDENCE_STATUS.STALE,
    EVIDENCE_STATUS.UNAVAILABLE,
    EVIDENCE_STATUS.CONFLICTING,
    EVIDENCE_STATUS.SKIPPED,
    EVIDENCE_STATUS.NOT_RUN,
  ].some((status) => counts[status] > 0) || missingKinds.length > 0;

  return {
    total,
    counts,
    missingKinds,
    coverage: requiredKinds.length === 0 ? 'unknown' : (missingKinds.length === 0 ? 'present' : 'incomplete'),
    outcome: requiredKinds.length === 0
      ? 'unknown'
      : (hasBlockingEvidence || counts[EVIDENCE_STATUS.PASSED] === 0
        ? 'needs_review'
        : 'evidence_current'),
    hasBlockingEvidence,
  };
}
