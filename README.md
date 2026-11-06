# Aftercare — Release Impact

[![Aftercare validation](https://github.com/genesisaugustine98-web/aftercare-jira-forge/actions/workflows/aftercare-validation.yml/badge.svg)](https://github.com/genesisaugust98-web/aftercare-jira-forge/actions/workflows/aftercare-validation.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Aftercare is an early-stage, open-source Jira Cloud Forge project exploring an evidence-linked change-to-production assurance workspace.

The Jira Forge source lives in [`aftercare-release-impact/`](aftercare-release-impact/). The current implemented capability is deliberately limited to a read-only project-context dashboard: it reads project metadata and up to eight recent work items visible to the current Jira user. It is not yet a complete release-readiness engine.

## Current status — read before evaluating

**Implemented:** read-only Jira project context, project/work-item display, loading/error/empty states, manual refresh, unit/edge-case tests and CI validation.

**Development foundation:** signed GitLab merge-request and CI evidence ingestion through a Forge webtrigger, with evidence assessed against an exact merge-request head SHA.

**Still required before the GitLab evidence path is considered live:** the documented Forge `storage:app` permission upgrade, project-scoped secret setup, GitLab webhook configuration and end-to-end verification in a development tenant.

**Not implemented:** full source-diff impact analysis, deployment evidence, immutable decision history, a complete release dossier or production-release authorization. Aftercare does not merge, deploy, approve or authorize production changes.

Use only a Jira development/sandbox tenant and synthetic data while evaluating the project. Do not rely on this early-stage software for production release decisions.

## Product direction

The product thesis is a traceable evidence chain from Jira change scope to source-control revisions, CI/tests, security results, deployments and operational evidence. Missing, stale, skipped, inaccessible and conflicting evidence must remain visible; unknown evidence must never become a pass.

See the [product thesis and adversarial validation plan](docs/product-thesis-and-validation.md) for the market pressure test, architecture, threat model, failure scenarios and acceptance gates.

## Maintainer and contributor resources

- [Contributing guide](CONTRIBUTING.md) — development setup, checks and contribution workflow.
- [Security policy](SECURITY.md) — private vulnerability reporting and safe testing.
- [Code of Conduct](CODE_OF_CONDUCT.md) — expectations for project participation.
- [Pilot testing guide](docs/pilot-testing.md) — how independent teams can evaluate the current build safely.
- [Release process](docs/releasing.md) and [changelog](CHANGELOG.md) — release gates, versioning and project history.
- [Codex-assisted maintenance](docs/codex-maintenance.md) — optional manual read-only review workflow.

## Application documentation

See the [application README](aftercare-release-impact/README.md) for current functionality, permissions, Forge development commands, GitLab evidence setup boundaries and known limitations.

## Maintenance

The repository uses CI for dependency auditing, tests, linting and authenticated Forge validation when its GitHub Actions secrets are configured. Dependabot proposes weekly npm and GitHub Actions dependency updates. These are proposals only and require maintainer review.

The optional Codex maintenance workflow is manually triggered from `main`, requires an `OPENAI_API_KEY` Actions secret, runs with read-only repository access and publishes an advisory report. It does not edit code, merge pull requests, publish releases or deploy the app.
