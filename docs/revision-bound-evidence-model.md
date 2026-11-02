# Revision-bound evidence model

**Status:** implemented as a provider-neutral domain module; not yet connected to GitLab or persisted in Jira/Forge storage.

## Purpose

Aftercare must prove that a check applies to the exact source revision under review. A green pipeline result for a different commit is stale evidence, not a pass.

## Canonical evidence record

Provider adapters should normalize source data into this shape:

| Field | Meaning |
|---|---|
| `id` | Stable evidence identity from the source |
| `kind` | Evidence category, such as `pipeline`, `test_suite`, or `security_scan` |
| `source` | Provider name, currently designed for GitLab first |
| `sourceUrl` | HTTPS link to the source record |
| `commitSha` | Immutable commit identifier tested or scanned |
| `pipelineId` | Provider execution identifier, where applicable |
| `observedAt` | Time the provider reports the result was observed |
| `status` | One of the explicit states below |

## Evidence states

- `passed`: successful, exact-revision evidence within the freshness window.
- `failed`: source reports a failed check.
- `cancelled`: source reports that the check was cancelled before a successful result.
- `skipped`: source reports a skipped check.
- `not_run`: required check has not run.
- `missing`: no evidence supplied for a requirement.
- `stale`: evidence belongs to another commit or exceeds the freshness window.
- `unavailable`: source/provenance cannot be verified, or the provider cannot be reached.
- `conflicting`: sources disagree about result or provenance.
- `not_applicable`: explicitly excluded by a recorded applicability decision.

These states are not interchangeable. In particular, missing, skipped, stale, and unavailable must never be rendered as passed.

## Assessment rules

1. Validate the evidence identity, kind, source and HTTPS source link.
2. Require a valid immutable SHA for the change under review.
3. Require a valid SHA on any evidence that is to count as current.
4. Compare the evidence SHA with the reviewed SHA. A mismatch is stale.
5. Require a valid observation time; future or absent timestamps are unavailable.
6. Apply a configurable freshness window; old evidence is stale even if the SHA matches.
7. Preserve explicit failed, cancelled, skipped, not-run, missing, unavailable, conflicting and not-applicable states.
8. Summaries report coverage separately from outcome. No configured requirements means coverage and outcome are unknown, even if individual evidence records pass. A non-empty policy with no passing evidence remains needs-review.

Only full 40-character SHA-1 or 64-character SHA-256 identifiers are accepted. Abbreviated hashes are rejected because prefix matching cannot prove exact revision identity.

## Current implementation boundary

The pure JavaScript module `src/frontend/evidence-model.mjs` implements validation, revision matching, freshness assessment and conservative summaries. Its tests cover mismatched revisions, old results, missing provenance, future timestamps, explicit non-success states, missing records without source links, abbreviated SHA rejection and unconfigured policy.

This module does not yet call GitLab, collect pipelines, persist evidence, or produce a release decision. Those capabilities require the next integration and storage steps.
