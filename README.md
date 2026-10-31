# Aftercare — Release Impact

Aftercare is intended to become an evidence-linked change-to-production assurance workspace, surfaced inside Jira.

The Jira Forge source lives in [`aftercare-release-impact/`](aftercare-release-impact/). The current implementation is deliberately limited to a read-only project context dashboard: it reads project metadata and up to eight recent work items visible to the current Jira user. It is not yet a release-readiness engine.

## Product direction

The differentiation is a traceable evidence chain from Jira change scope to source-control revisions, CI/tests, security results, deployments and operational evidence. Missing, stale, skipped, inaccessible and conflicting evidence must remain visible; Aftercare must never turn unknown evidence into a pass or authorize a production release.

See the [product thesis and adversarial validation plan](docs/product-thesis-and-validation.md) for the market pressure test, architecture, threat model, failure scenarios and acceptance gates.

See the [application README](aftercare-release-impact/README.md) for current capabilities, permission scope and development commands.
