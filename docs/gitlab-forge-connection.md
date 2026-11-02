# Aftercare GitLab.com connection

**Implementation status:** read-only GitLab API connection and per-issue evidence collection are implemented in this branch. It is not live in the installed Jira development app until the new storage and external-fetch permissions are approved through a Forge app upgrade and a GitLab credential is configured in Aftercare.

## Connection model

- One GitLab.com project is configured for the Jira project.
- A Jira project administrator supplies the numeric GitLab project ID and a GitLab access token with the `read_api` scope.
- Aftercare validates the token by reading the selected project from GitLab before saving anything.
- The token is stored with Forge KVS `kvs.setSecret`, encrypted and inaccessible through ordinary KVS queries. It expires from Aftercare storage after 90 days; GitLab may expire it earlier.
- The normal project configuration stores only the GitLab project ID, name, namespace path, URL and connection timestamp.
- Only Jira project administrators can configure, disconnect, refresh or inspect the connected GitLab evidence.
- The app sends authenticated requests only to `https://gitlab.com`. GitLab self-managed instances are not supported by this first connection.
- Disconnecting deletes the stored token and project configuration.

Use a project access token with the minimum `read_api` permission where GitLab allows it. Do not paste access tokens into chat, issues, merge requests or repository files.

## Evidence collection

For a Jira issue, Aftercare:

1. Checks that the Jira issue is visible to the current user and belongs to the current Jira project.
2. Reads the configured GitLab project's merge requests and links only an MR with exactly one explicit Jira issue key in its title, description or source branch.
3. Refuses ambiguous associations, multiple MRs for one issue, incomplete pagination or an MR with no full head commit SHA.
4. Reads the merge request's head pipeline, CI jobs and pipeline test-report summary.
5. Compares pipeline, job and test-report commit identifiers with the exact merge-request head SHA.
6. Applies a 24-hour freshness policy by default. Old or mismatched results are stale, never passing evidence.
7. Requires pipeline, test-report and security-scan-job-execution evidence for an `evidence_current` summary. Missing, unavailable, not-run, failed, cancelled, skipped, stale or conflicting records keep the result at `needs_review`.

A job named `security_scan` is recorded as **security-scan execution evidence only**. A successful job does not prove that the scan found zero vulnerabilities. Parsing and validating scanner reports is a separate future step.

The current integration uses manual, user-initiated refresh. It reads at most five pages of merge requests (100 per page) and one page of pipeline jobs (100 jobs). If the result is truncated, Aftercare refuses to make an absence or green conclusion.

## Data and decision boundaries

The app stores the latest evidence snapshot per Jira issue. This is not yet an immutable audit log or a human decision record. It does not inspect source diffs, parse vulnerability findings, retrieve deployment evidence, authorize production release, merge changes or deploy code.

## Forge permission and eligibility trade-off

This connection adds the `storage:app` scope and backend egress to `https://gitlab.com`. Existing installations must approve the new permissions through a Forge app upgrade before the feature can run. External egress may affect eligibility for Runs on Atlassian; the deployment workflow must report the actual Forge eligibility result rather than assuming it remains eligible.

## Verification boundary

Automated tests cover token-safe API requests, project validation, pagination, explicit Jira issue association, exact commit matching, test-report interpretation, missing evidence and stale evidence. Live end-to-end verification still requires the Jira app upgrade, an authorized GitLab token configured in the Aftercare UI, and a Jira issue whose GitLab merge request explicitly references its key.
