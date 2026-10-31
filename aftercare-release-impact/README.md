# Aftercare — Release Impact

Aftercare is a Jira Cloud Forge app that provides a project-level workspace for release-impact review.

## Current capability: project context dashboard

The first implementation replaces the Forge Hello World screen with a read-only Jira project dashboard. It:

- Reads the current project key from Forge's `useProductContext` hook.
- Retrieves project metadata from Jira Cloud REST API v3.
- Retrieves up to eight recently updated work items through the enhanced JQL search endpoint.
- Shows each returned work item's key, summary, status, issue type, priority, assignee and update time.
- Handles asynchronous context loading, API failures, empty results and manual refresh.

The Jira requests are made through `requestJira` from `@forge/bridge`, which executes as the currently signed-in user. Jira project permissions and issue-security rules continue to apply.

## Explicit scope boundary

This dashboard is a project-context foundation, not yet a release-readiness engine. It does not currently inspect source-control changes, merge requests, CI/CD pipelines, security scans, build artifacts or deployment environments. It does not write to Jira, approve changes or authorize production releases.

Those capabilities require separate integrations, evidence models and human-review controls. They must be implemented and tested before Aftercare presents any release-impact conclusion.

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

## Development

Requirements:

- Node.js 24
- npm
- Atlassian Forge CLI authenticated to the target Atlassian site

Install dependencies and run the available checks:

```bash
npm install
npm audit
npm run lint
forge lint
```

The Forge CLI bundles the UI Kit application when it is deployed or run through a tunnel.

## Application structure

```text
manifest.yml
src/
  frontend/
    index.jsx
eslint.config.mjs
package.json
package-lock.json
```

The current dashboard uses UI Kit and the Jira Bridge API directly. A backend resolver is not needed for this read-only stage. Backend processing and Forge storage can be introduced when the assessment and evidence-history features are designed.
