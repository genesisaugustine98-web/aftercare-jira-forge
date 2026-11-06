# Changelog

All notable changes to Aftercare are recorded here. This project has not yet published a stable tagged release. Until a release is cut, changes remain under **Unreleased**.

The repository-level changelog covers the overall project. The Forge app's internal package version is maintained separately in `aftercare-release-impact/package.json`; keep the two versioning decisions consistent when preparing a public release.

## [Unreleased]

### Added
- Read-only Jira project-context dashboard showing project metadata and up to eight recently updated work items visible to the current Jira user.
- Development foundation for signed, revision-bound GitLab merge-request and CI evidence received through a Forge webtrigger.
- Automated validation workflow for dependency audit, tests, linting and authenticated Forge validation when credentials are configured.
- Weekly CodeQL security-extended analysis for JavaScript and TypeScript, including safe SARIF upload handling for fork pull requests.
- Explicitly authorized development installation and permission-upgrade workflows.
- Contributor guidance, security reporting policy, code of conduct, issue templates and pull-request checklist.
- Optional, manually triggered, read-only Codex maintainer review workflow (requires an `OPENAI_API_KEY` repository Actions secret).

### Scope notes
- The Jira dashboard is not a release-readiness engine.
- GitLab evidence functionality is not considered live merely because its code is present; the required Forge permission upgrade, webhook configuration and end-to-end verification must be completed.
- Source-diff impact analysis, deployment evidence, immutable decision history and production-release authorization are not implemented.
- No stable release or external adoption metrics are claimed yet.
