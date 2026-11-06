# Aftercare pilot testing

This document invites independent maintainers and Jira/GitLab practitioners to evaluate the project and gives the maintainer a consistent way to collect useful feedback.

## What is ready to evaluate

The current working capability is a read-only Jira Cloud project dashboard showing project metadata and up to eight recently updated work items visible to the current Jira user.

The GitLab evidence receiver is a development foundation. It requires a Forge permission upgrade and webhook configuration before it can be exercised end to end. It is not yet a production-ready release-assurance system.

## Who should test

- Jira Cloud administrators or project administrators who can provide a non-production development site.
- Engineering or platform teams already using Jira Cloud and GitLab.
- Developers interested in evidence provenance, CI/security results and human-controlled release decisions.

## Safe pilot boundaries

- Use a Jira development or sandbox tenant, never a production tenant for this early pilot.
- Use synthetic projects, issues, merge requests and CI events.
- Do not send customer records, employee personal data, credentials, production tokens or confidential source code.
- Do not rely on Aftercare to authorize, block, approve or execute a real production release.
- Keep all normal Jira and GitLab permission controls enabled.
- Stop testing and report privately if you discover a security issue.

## Suggested evaluation

1. Read the root README and [application README](../aftercare-release-impact/README.md).
2. Follow the development setup and run the local checks in [CONTRIBUTING.md](../CONTRIBUTING.md).
3. Install only in a development Jira site you control.
4. Confirm the dashboard respects the signed-in user's Jira project and issue visibility.
5. Exercise empty projects, inaccessible issues, API errors, refresh behaviour and unusual project names.
6. For the GitLab path, first complete the permission upgrade and setup in [the Forge connection guide](gitlab-forge-connection.md). Send only synthetic signed events. Verify exact MR head SHA binding, duplicate/out-of-order delivery, stale evidence and invalid signatures.
7. Report what worked, what failed, what was confusing and what would prevent your team from adopting it.

## Feedback to provide

A useful report includes:
- Your role (for example, Jira administrator or platform engineer), without personal details.
- The tested commit SHA and whether you used a development tenant.
- Which steps you completed.
- Expected versus observed behaviour.
- A redacted screenshot or minimal synthetic reproduction, if useful.
- Whether you would use the feature again and what must change first.

Do not include secrets, customer information or identifiable employee data.

## What the maintainer will measure

The project will track independently verifiable signals: external issue reports, outside contributions, successful pilot feedback, repeat use reported by pilot teams, and release/upgrade problems. Stars and downloads may be recorded as secondary visibility indicators, not as proof of use or reliability.

No telemetry is currently claimed or required for this pilot. Feedback will be reported publicly only with the contributor's permission and without confidential details.

## Invitation text

> Aftercare is an early-stage, MIT-licensed Jira Forge project exploring evidence-linked change assurance. The current build is a read-only Jira project dashboard; a revision-bound GitLab evidence path is still under development. I am looking for a small number of Jira Cloud + GitLab practitioners willing to test it in development tenants using synthetic data. The goal is to find permission, traceability, freshness and usability failures before expanding the scope. This is not production release authority or a replacement for Jira/GitLab controls. Feedback and reproducible bug reports are welcome.
