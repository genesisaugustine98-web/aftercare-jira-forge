# GitLab evidence adapter

**Status:** pure GitLab response normalizers, signed webhook ingestion, Forge KVS persistence and revision-bound assessment are implemented in the development branch. The feature is not live in the installed Jira app until the Forge permission upgrade and GitLab webhook setup are complete.

## Pipeline and job normalization

The adapter converts GitLab pipeline and job payloads into canonical Aftercare evidence records. It checks the configured HTTPS GitLab.com origin, the expected GitLab project ID, stable pipeline/job identity and valid provider timestamps. URLs from another host or project are rejected.

- GitLab `success` becomes `passed`.
- `failed` remains failed.
- `canceled` / `cancelled` remains cancelled.
- `skipped` and `manual` remain explicit non-success states.
- Created, waiting, preparing, pending, running and scheduled pipelines/jobs remain not-run; they are never treated as passing.
- Unknown statuses are rejected.
- Missing or abbreviated commit SHAs remain explicit and cannot pass revision assessment.
- Job events use GitLab's `commit.sha` field. The job-hook `commit.id` field is not treated as the source commit SHA.
- Job URLs are derived from the trusted GitLab project URL and job ID when the webhook payload does not include a job URL.

## Jira issue association

The adapter searches the merge request title, description and source branch for explicit Jira issue keys. Exactly one unique key is linkable. No key is missing; multiple keys are conflicting. It does not infer an issue from text similarity or silently select one.

A pipeline event's embedded merge-request summary may establish a candidate association, but it cannot independently confirm the current merge-request head SHA. A merge-request event must confirm that head before the evidence can pass.

## Signed webhook ingestion and persistence

The app uses a static Forge webtrigger and no external GitLab API egress. The receiver validates the project-scoped `X-Gitlab-Token` secret, Jira project key, configured GitLab project ID, event body size and source URLs. It deduplicates event deliveries for seven days, stores MR/pipeline/job records with bounded retention and recomputes issue snapshots when new events arrive.

Only Jira project administrators can configure the webhook or inspect evidence. The webhook secret is stored with Forge KVS secret storage and expires from Aftercare after 90 days. The GitLab project administrator must enable Merge request, Pipeline and Job events in GitLab project settings.

## Aggregate CI evidence

The receiver also accepts an `aftercare_evidence` event from the optional GitLab CI publisher. It carries aggregate JUnit totals, Gatekeeper severity totals and the supervised release-gate flags. The publisher does not send source code, individual findings, file paths or raw report contents.

The required evidence policy distinguishes pipeline status, test-job execution, JUnit report, security-job execution, Gatekeeper security summary and release-gate evidence. A successful scanner job is not treated as proof that vulnerability findings are clear.

## Freshness and limits

Evidence is compared with the exact merge-request head SHA using a 24-hour freshness window. A previous pipeline after a force-push is stale. A snapshot read recalculates freshness against the current clock, so an old green snapshot cannot remain green after the window expires.

Webhook records and snapshots have bounded retention. Historical GitLab events are not backfilled. If a required index overflows, Aftercare marks the result incomplete rather than returning a green outcome.

## Boundary

The integration does not inspect source diffs, parse individual vulnerability findings, retrieve deployment records, create immutable audit decisions, authorize production release, merge changes or deploy code. An `evidence_current` result means the configured evidence set is present, current and passed; it is not release approval.
