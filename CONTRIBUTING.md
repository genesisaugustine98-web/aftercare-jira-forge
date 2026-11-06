# Contributing to Aftercare

Thank you for taking an interest in Aftercare. The project is early-stage, and contributions that improve correctness, security, accessibility, documentation and reproducibility are especially useful.

## Start with the current scope

Read the root [README](README.md), the [application README](aftercare-release-impact/README.md), and the [product thesis](docs/product-thesis-and-validation.md).

The current Jira app is a read-only project-context dashboard. The revision-bound GitLab evidence path is still under development and requires its documented Forge permission upgrade and webhook configuration. Do not describe the application as a complete release-readiness or production-authorization system.

## Before opening a pull request

For changes to the Forge app, run these commands from `aftercare-release-impact/`:

```bash
npm ci
npm audit
npm test
npm run lint
forge lint
```

If Forge credentials or a Jira development site are unavailable, say which checks you could not run. Never include credentials, private customer data, or unredacted logs in a contribution.

For documentation-only changes, check links, commands, file paths and statements about current capability. Keep intended functionality clearly separate from implemented functionality.

## Contribution workflow

1. Open or find an issue describing the problem. For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
2. Create a focused branch from `main`.
3. Make the smallest change that addresses the issue.
4. Add or update tests for changed behaviour, including failure and boundary cases.
5. Update documentation and `CHANGELOG.md` when user-visible behaviour changes.
6. Open a pull request using the repository template and explain the evidence behind the change.

Use clear commit messages such as `fix: reject stale evidence`, `feat: add evidence source link`, or `docs: clarify development installation`.

## Engineering principles

- Preserve Jira's own permission model; never broaden access merely to make a demo work.
- Keep provider credentials server-side and out of source, logs, browser bundles and issue reports.
- Bind evidence to an explicit source identity and exact revision where applicable.
- Distinguish pass, fail, missing, stale, skipped, inaccessible, conflicting and not-applicable states. Unknown is not pass.
- Treat webhook delivery as untrusted, potentially duplicated and out of order.
- Do not turn Aftercare into an automatic merge, deploy, approval or production-release authority.
- Prefer auditable, deterministic behaviour over opaque scores.
- Do not add telemetry or collect customer data without a documented purpose, disclosure and appropriate consent.

## Review and response expectations

The project is maintained by its primary maintainer. Reviews are best-effort; no response-time or support SLA is promised. A pull request is not accepted merely because CI passes. The maintainer may request tests, threat analysis, documentation or a narrower scope.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
