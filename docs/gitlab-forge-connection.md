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

The default required evidence kinds are:

- `pipeline`
- `test_suite_execution` (a successful `unit_tests`, `tests` or `test` job)
- `security_scan_execution` (a successful `security_scan` job)

A successful `security_scan` job proves only that the configured job completed successfully. It does **not** prove that vulnerability findings are clear. The current webhook integration does not retrieve test-report counts or parse scanner findings.

Events are collected from the time the webhook is enabled. Historical merge requests, pipelines and jobs are not backfilled. The GitLab webhook event and index limits are bounded; if an index overflows, Aftercare marks the evidence incomplete rather than returning a green result.

## Data and decision boundaries

The app stores the latest evidence snapshot per Jira issue. This is not yet an immutable audit log or a human decision record. It does not inspect source diffs, parse vulnerability findings, retrieve deployment evidence, authorize production release, merge changes or deploy code.

## Verification boundary

Automated tests cover webhook project validation, explicit issue-key linking, ambiguous associations, event ordering, deduplication at the handler boundary, exact commit matching, stale evidence, missing CI jobs, invalid source URLs and safe outcomes. Live end-to-end verification still requires the Forge app upgrade, a GitLab webhook configured with the generated URL and secret, and new GitLab events after setup.
