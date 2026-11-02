# Aftercare — Release Impact

Aftercare is a Jira Cloud Forge app that provides the first project-context surface for an evidence-based release-impact product.

## Current capability: project context dashboard

The first implementation is a read-only Jira project dashboard. It:

- Reads the current project key from Forge's `useProductContext` hook.
- Retrieves project metadata from Jira Cloud REST API v3.
- Retrieves up to eight recently updated work items through Jira's enhanced JQL search endpoint.
- Shows each returned work item's key, summary, status, issue type, priority, assignee and update time.
- Handles asynchronous context loading, API failures, empty results and manual refresh.
- Tests query construction, JQL escaping, status mapping, project type mapping and API error messaging with Node's built-in test runner.

The Jira requests are made through `requestJira` from `@forge/bridge`, which executes as the currently signed-in user. Jira project permissions and issue-security rules continue to apply.

## Explicit scope boundary

This dashboard is a project-context foundation, not yet a release-readiness engine. It does not currently inspect source-control changes, merge requests, CI/CD pipelines, security scans, build artifacts or deployment environments. It does not write to Jira, approve changes or authorize production releases.

The product thesis and adversarial validation plan lives at [`docs/product-thesis-and-validation.md`](../docs/product-thesis-and-validation.md). That plan defines the evidence model, GitLab-first integration sequence, threat model and release-readiness acceptance gates. Those capabilities must be implemented and tested before Aftercare presents any release-impact conclusion.

## Permissions

The manifest declares the classic OAuth scope:

- `read:jira-work` — required for the read-only project and work-item requests.

Users must also have the applicable Jira Browse Projects and issue visibility permissions. The app does not request Jira write scopes.

Because this release adds a permission scope, an existing installation must be redeployed and upgraded after the scope is approved:

```bash
forge lint
forge deploy --non-interactive --e development
forge install --non-interactive --upgrade --site <your-site>.atlassian.net --product jira --environment development
```

Run Forge commands from this app directory. Replace the site placeholder with the Atlassian site where the app is installed.

## Development and checks

Requirements:

- Node.js 24
- npm
- Atlassian Forge CLI authenticated to the target Atlassian site

Run the checks from this directory:

```bash
npm ci
npm audit
npm test
npm run lint
forge lint
```

The automated GitHub Actions workflow runs dependency audit, unit/edge-case tests, ESLint and authenticated Forge lint when the repository secrets are configured.

The Forge CLI bundles the UI Kit application when it is deployed or run through a tunnel.

## Application structure

```text
manifest.yml
src/
  frontend/
    index.jsx
    project-dashboard-logic.mjs
test/
  project-dashboard-logic.test.mjs
eslint.config.mjs
package.json
package-lock.json
```

The current dashboard uses UI Kit and the Jira Bridge API directly. A backend resolver is not needed for this read-only stage. Backend processing, secure provider credentials and Forge storage can be introduced when the integration and evidence-history features are designed.

## Revision-bound GitLab evidence (development)

The app uses a static Forge webtrigger to receive signed GitLab.com merge-request, pipeline and job events. It makes no outbound GitLab API calls and requires no GitLab access token. The webhook secret is project-scoped, stored with Forge KVS secret storage, and manageable only by Jira project administrators.

Evidence is linked only through one explicit Jira issue key and assessed against the exact merge-request head SHA with a 24-hour freshness window. The receiver can also accept an aggregate CI evidence event containing JUnit counts, Gatekeeper severity totals and the supervised release-gate decision. It never needs source code or individual finding details.

The app branch still requires the `storage:app` permission upgrade and GitLab webhook setup before the feature is live. The optional aggregate CI publisher has been merged into the GitLab project's main branch. It remains inactive until the two protected CI/CD variables are configured. Historical events are not backfilled. Source-diff analysis, deployment evidence, immutable decision history and production authorization remain out of scope.

See [the revision-bound evidence model](../docs/revision-bound-evidence-model.md) and [the GitLab webhook setup and verification boundary](../docs/gitlab-forge-connection.md).
