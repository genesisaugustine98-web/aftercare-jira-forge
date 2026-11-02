# GitLab evidence adapter

**Status:** provider response normalization and explicit Jira-key association are implemented as pure functions. Live GitLab API access, credentials, webhook ingestion and persistence are not yet connected.

## Pipeline normalization

The adapter converts a GitLab pipeline response into the canonical Aftercare evidence record. It checks the configured HTTPS GitLab origin, the expected GitLab project ID, a stable pipeline ID and a valid provider timestamp. Pipeline URLs from another host or project are rejected.

- GitLab `success` becomes `passed`.
- `failed` remains failed.
- `canceled` / `cancelled` remains cancelled.
- `skipped` and `manual` remain skipped.
- Created, waiting, preparing, pending, running and scheduled pipelines remain not-run; they are never treated as passing.
- Unknown statuses are rejected.
- Missing commit SHA remains explicit and cannot pass revision assessment.

## Jira issue association

The adapter searches the merge request title, description and source branch for explicit Jira issue keys. Exactly one unique key is linkable. No key is missing; multiple keys are conflicting. It does not infer an issue from text similarity or silently select one.

## Boundary

This adapter does not call GitLab, store credentials, receive webhooks, or persist records. The next integration step must use a server-side credential flow, least-privilege GitLab read access, secure secret storage, and idempotent ingestion before any live evidence is shown.

## Job and test-report normalization

GitLab CI jobs can be normalized as execution evidence only when the caller supplies an explicit evidence category. This avoids treating an arbitrary job name as proof that a security scanner or test suite ran. Each job must belong to the configured project, link to a pipeline, use a trusted GitLab URL and carry a full commit ID before it can pass revision assessment.

GitLab's aggregate test-report summary is handled separately from the pipeline's overall status. A non-zero count with every test successful can pass; failed tests or suite errors fail; skipped tests remain skipped; zero tests are missing; inconsistent aggregate counts are conflicting. A green pipeline alone is not substituted for a test report.
