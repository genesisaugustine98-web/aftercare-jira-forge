# Aftercare product thesis and validation plan

**Review date:** 31 October 2026  
**Status:** Product thesis for the first build; not a claim that the full product is implemented or production-validated.

## Executive judgement

Aftercare should not be positioned as another Jira dashboard, issue-health score, or Jira-only release checklist. Those are already served by Marketplace products. Its defensible opportunity is an **evidence-linked change-to-production assurance workspace**: connect the business change recorded in Jira to the exact code change, pipeline run, security/test results, deployment and operational evidence that support a human release decision.

The current Forge app is only the Jira project-context shell. It does not yet deliver that differentiated capability. This boundary must remain visible in the UI and in all external claims until the integrations and evidence model exist.

## Market pressure test

A close substitute already exists: [Release Readiness for Jira](https://marketplace.atlassian.com/apps/2207519188/release-readiness-for-jira). Its listing describes configurable JQL criteria, accountable owners, linked tests, evidence gaps, time history and a locked decision record. It was listed with a 7 October 2026 release and, at the time of this review, a very small install/review footprint. That small footprint is not evidence of demand or product-market fit, but the feature overlap is direct: a Jira-only readiness checklist is not a strong differentiator.

Other adjacent categories include:
- [Impact Analysis for Jira](https://marketplace.atlassian.com/apps/4251492671/impact-analysis-for-jira), which focuses on Jira configuration dependencies and administrative change impact.
- [Issue, Sprint & Release Delivery Health Check for Jira](https://marketplace.atlassian.com/apps/1679578961/issue-sprint-release-delivery-health-check-for-jira), which focuses on issue/sprint/release flow metrics and AI recommendations.

### What must be different

Aftercare's primary object should be a **release evidence dossier**, not a dashboard score. Each evidence item needs:
- A source identity and immutable source reference (Jira issue/version, GitLab project/MR/commit, pipeline/job, test or security report, deployment/environment, or operational signal).
- Observation time, source update time, collection time and freshness state.
- A relationship to the change/release scope, with the matching rule visible (issue key in MR title/branch, explicit link, configured mapping, or human confirmation).
- A result state that distinguishes pass, fail, not run, missing, inaccessible, stale, conflicting and not applicable.
- A retrievable source link or a clear reason why no link is available.

The product must never silently convert missing evidence into a pass, inaccessible data into a clean result, stale scans into current assurance, or an unlinked pipeline into proof for a release.

## Target user and job

**Primary buyer/user:** engineering manager, release manager, platform/reliability lead or change approver accountable for releases spanning several teams and systems.

**Job to be done:** “Before I accept this change into production, show me exactly what changed, what it could affect, which checks ran against that exact change, what evidence is missing or stale, and who made the decision.”

The Jira project page is the contextual entry point, not the entire system. Start with one focused segment: teams using Jira Cloud and GitLab merge requests/pipelines, where issue keys and MR links can establish traceability without broad discovery heuristics.

## First differentiated release (MVP)

1. **Scope selection:** pick a Jira release/fix version or a bounded set of issues. Display inclusion/exclusion rules and the exact set of work items in scope.
2. **Change traceability:** link each Jira item to GitLab merge requests and commits using explicit Jira links first, then configured issue-key conventions. Ambiguous matches require confirmation; never choose a likely-looking MR silently.
3. **Exact-revision evidence:** bind CI jobs, tests, dependency/security scans and build artifacts to the MR head SHA (and pipeline/run ID). A rerun or changed SHA invalidates the freshness of older evidence.
4. **Impact map:** show changed services/components, dependencies and affected Jira work items. Unknown ownership/dependency data remains unknown; do not infer a full blast radius from file paths alone.
5. **Evidence dossier:** show evidence state, source, timestamp, version/commit and drill-through link. Surface missing, failed, stale, skipped and conflicting evidence separately.
6. **Human decision record:** allow an authorized reviewer to record approve, approve with conditions, or hold, with rationale, conditions, identity, time, policy version and a snapshot of the evidence used. A later decision is a new record; it does not rewrite history.
7. **No autonomous release authority:** Aftercare may advise and preserve evidence, but it must not merge, deploy, bypass a protected branch, override approvals or represent a human decision as a deployment.

The first integration should be GitLab end-to-end rather than many half-integrations. Expand to GitHub and other CI/security providers only after the GitLab traceability and evidence-freshness model is reliable.

## Product architecture

- **Jira Forge surface:** project page for the overview; eventually an issue context module for a change-specific dossier. Use current-user access for Jira reads by default and preserve Jira permissions.
- **Integration service:** backend connector for GitLab OAuth/token exchange and webhooks. Keep credentials server-side, encrypted and scoped per tenant/project. Never put provider secrets in the browser bundle or logs.
- **Canonical evidence model:** normalized records for change, source revision, pipeline execution, test result, security finding, artifact, deployment, environment, dependency relationship and decision.
- **Event and snapshot layer:** idempotent webhook ingestion, source polling/reconciliation, versioned evidence snapshots and append-only decisions. Support delayed/out-of-order webhook delivery and provider re-fetch before a decision snapshot.
- **Policy engine:** explainable rules with provenance. Separate severity/risk, evidence coverage and confidence. Avoid a single opaque “release score” that hides uncertainty.
- **Audit and retention:** tenant-scoped access checks, retention controls, exportable decision history and traceable access to source evidence.

Do not build a broad “AI release manager” first. AI may summarize evidence or explain why two signals conflict, but every generated statement must cite evidence IDs and source links; unsupported inference must be marked as a hypothesis and never become an approval.

## Failure and abuse cases to test

| Scenario | Required behaviour |
|---|---|
| Jira issue has no MR link | Mark code traceability missing; do not invent a match |
| Multiple MRs mention one issue | Show candidates and require a human mapping |
| MR head changes after pipeline success | Mark prior run evidence stale for the new SHA |
| Pipeline was skipped/cancelled | Show skipped/cancelled, not passed |
| Security scan is old or scans another SHA | Mark stale/mismatched and exclude from current assurance |
| Jira issue is hidden by issue security | Respect Jira's user permissions; don't fetch it as the app to bypass visibility |
| Provider token expires or scopes are revoked | Mark source unavailable and show reconnect/action needed; never show a green state |
| Webhooks arrive twice or out of order | Idempotent processing and deterministic latest-source reconciliation |
| GitLab/API is rate-limited or unavailable | Partial dossier with source health and last successful sync time |
| One of several projects is inaccessible | Keep accessible evidence, expose partial coverage; do not imply complete project scope |
| MR is force-pushed after review | Invalidate revision-bound evidence and decision readiness snapshot |
| A build artifact differs from deployed artifact | Show provenance mismatch; do not treat CI success as deployment proof |
| Rollback/monitoring evidence is absent | State “not evidenced”; do not assume operational readiness |
| Issue/MR text contains prompt injection | Treat it as untrusted data; no instructions from source content may alter policies or actions |
| User lacks decision authority | Allow read-only review; do not offer or accept a decision from that user |

## Security and trust requirements

- Least-privilege, provider-specific scopes; no broad admin scopes for convenience.
- User- and tenant-scoped authorization for every read and decision.
- Secrets stored only in Forge secure storage or an appropriately secured backend secret store; redact tokens, headers and sensitive payloads from logs.
- Validate webhook signatures, timestamps and replay windows; process idempotently.
- Treat Jira descriptions, issue comments, commit messages, MR descriptions, CI logs and scanner output as untrusted data.
- Keep evidence provenance and collection failures visible.
- Use exact commit SHA and pipeline/run IDs; do not bind evidence only to branch names.
- Retain an auditable record of policy version, evidence snapshot and human decision.
- Do not claim compliance certification, complete blast-radius analysis or “safe to deploy” unless independently supported and validated.

## Acceptance gates before calling Aftercare release-ready

**Gate A — integration correctness**
- Jira scope matches the user-selected release or issue set exactly.
- Every linked MR/commit match is deterministic or explicitly human-confirmed.
- Every CI/security result is bound to the exact revision and run ID.
- Webhook replay, duplicate delivery, force-push, rerun and out-of-order delivery tests pass.

**Gate B — evidence semantics**
- Pass/fail/skipped/not-run/missing/stale/unknown/unavailable/conflicting are distinct states.
- Partial data never renders a complete green outcome.
- Every finding links to its originating record and timestamp.
- Changed source revisions invalidate the relevant old evidence and decision snapshot.

**Gate C — security**
- Cross-tenant and cross-project access tests pass.
- Revoked tokens and Jira permission changes fail closed.
- Secrets are absent from client bundles, repository history and logs.
- Prompt injection in source metadata cannot modify policy or take actions.

**Gate D — operational reliability**
- Rate-limit handling, retry/backoff, pagination, webhook replay and reconciliation are tested.
- Degraded-provider states are explicit.
- Retention, deletion, access logging and export are documented.
- A human can reconstruct why a decision was made from the saved snapshot.

**Gate E — user value**
- In a pilot, reviewers can identify a missing or mismatched evidence item faster than their current manual process.
- Measure time to assemble a dossier, proportion of changes with complete traceability, stale/missing evidence detected, false-positive links, and reviewer corrections.
- Do not use “risk reduction” as a claim until there is longitudinal incident/near-miss evidence.

## Current implementation: honest status

The present Forge app is a read-only project context foundation: it retrieves project metadata and up to eight recently updated Jira work items visible to the current user. It has no GitLab connection, release/fix-version scope, evidence dossier, security scanner integration, deployment records, policy engine, immutable decision record, or live Jira-site acceptance test yet.

This is intentionally a small, permission-minimal first deployment. It is **not** the differentiated product MVP described above and must not be marketed as release readiness or production risk analysis.
