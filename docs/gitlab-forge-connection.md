# Aftercare GitLab webhook connection

**Implementation status:** signed, inbound GitLab webhook processing is implemented in this branch. It is not live in the installed Jira development app until the Forge app upgrade is approved and the webhook is configured in GitLab.

## Why webhooks instead of GitLab API egress

Aftercare uses a **static Forge webtrigger**. GitLab sends merge-request, pipeline and job events into the Forge installation. Aftercare does not call the GitLab API, send Jira issue data to GitLab, or require a GitLab personal/project access token.

Static webtriggers are eligible for Runs on Atlassian; dynamic webtriggers and external egress are not. The app still needs the `storage:app` scope for project-scoped webhook secrets and evidence snapshots. The upgrade workflow runs Forge eligibility validation after deployment rather than assuming eligibility.

## Connection model

- One GitLab.com project is configured per Jira project.
- The project ID is checked against the `project.id` in every incoming GitLab event.
- Aftercare generates a 256-bit random webhook secret and obtains the installation-specific static webtrigger URL from Forge.
- The URL includes the Jira project key. The secret is stored with Forge KVS `kvs.setSecret`, encrypted and inaccessible through ordinary KVS queries. It expires from Aftercare storage after 90 days.
- The secret is shown to the Jira project administrator once, when generated. If lost or expired, generate a new secret and update the GitLab webhook.
- Only Jira project administrators can configure, rotate, disconnect or inspect this project's evidence.
- The webhook handler checks the `X-Gitlab-Token` header using a constant-time comparison, validates the project ID, limits request size, and deduplicates events for seven days using GitLab's event UUID where available.
- No GitLab access token is collected or stored.
- Disconnecting deletes the Forge webhook secret and configuration. The administrator must also remove the webhook from GitLab project settings to stop GitLab retry attempts.

## GitLab setup

In the GitLab project:

1. Open **Settings → Webhooks**.
2. Paste the webhook URL displayed by Aftercare.
3. Paste the one-time secret token displayed by Aftercare.
4. Enable **Merge request events**, **Pipeline events** and **Job events**.
5. Leave SSL verification enabled and save the webhook.

Aftercare shows the last accepted event time and event kind. GitLab events are processed automatically; the Jira page's **Load GitLab evidence** button reads the latest stored snapshot.

## Evidence collection

Aftercare processes these inbound event types:

- Merge request events: explicit Jira issue-key association, source/target branch, MR URL, state and current head SHA.
- Pipeline events: pipeline ID, status, commit SHA, branch/ref, URL and timestamps.
- Job events: job ID, name, stage, status, pipeline ID, commit SHA, URL and timestamps.

Only a merge request with exactly one Jira issue key in its title, description or source branch is linked. Ambiguous references, multiple merge requests for one issue, mismatched project IDs, untrusted source URLs and invalid pipeline/job associations are not treated as passing evidence.

The evidence snapshot compares the selected pipeline and its job records with the exact merge-request head SHA. The default freshness window is 24 hours. Older or mismatched results are stale, never passing evidence.

The required evidence kinds are:

- `pipeline`
- `test_suite_execution` (a successful `unit_tests`, `tests` or `test` job)
- `test_report` (JUnit totals, failures, errors and skipped tests)
- `security_scan_execution` (a successful `security_scan` job)
- `security_report` (Gatekeeper severity totals and blocking-finding count)
- `release_gate` (the pipeline's explicit human-review decision and confirmation that production was not approved)

The `aftercare_evidence` event can be sent by a GitLab CI publisher after the existing test, security and release-evidence jobs complete. It sends only aggregate JUnit counts, Gatekeeper severity totals and the release-gate flags—not source code or individual finding evidence. The publisher uses the same webhook URL and secret as masked GitLab CI/CD variables `AFTERCARE_WEBHOOK_URL` and `AFTERCARE_WEBHOOK_TOKEN`.

A successful `security_scan` job proves only that the configured job completed successfully. The Gatekeeper summary adds severity counts and its configured HOLD/review decision, but it does **not** prove that the application is vulnerability-free. A separate GitLab CI publisher change is required to send the detailed aggregate evidence; without it, Aftercare keeps the relevant evidence kinds missing and the result remains `needs_review`.

Events are collected from the time the webhook is enabled. Historical merge requests, pipelines and jobs are not backfilled. The GitLab webhook event and index limits are bounded; if an index overflows, Aftercare marks the evidence incomplete rather than returning a green result.

## Data and decision boundaries

The app stores the latest evidence snapshot per Jira issue. This is not yet an immutable audit log or a human decision record. It does not inspect source diffs, parse vulnerability findings, retrieve deployment evidence, authorize production release, merge changes or deploy code.

## Verification boundary

Automated tests cover webhook project validation, explicit issue-key linking, ambiguous associations, event ordering, secret comparison, event fingerprinting for retries, exact commit matching, stale evidence, missing CI jobs, invalid source URLs and safe outcomes. Live end-to-end verification still requires the Forge app upgrade, a GitLab webhook configured with the generated URL and secret, and new GitLab events after setup.
