## Summary

Describe the change and the problem it solves.

## Evidence

- [ ] I linked the issue or explained why no issue is needed.
- [ ] I tested the changed behaviour and included the relevant commands/results.
- [ ] I distinguished implemented behaviour from planned behaviour.
- [ ] I updated documentation and `CHANGELOG.md` where appropriate.

## Security and compatibility

- [ ] No secrets, credentials, customer data or unredacted private logs are included.
- [ ] Jira permissions and provider trust boundaries are preserved.
- [ ] Webhook inputs are treated as untrusted; duplicate, stale and out-of-order events are considered where relevant.
- [ ] Missing, inaccessible, stale and conflicting evidence are not represented as a pass.
- [ ] The change does not create an autonomous merge, deploy, approval or production-release path.

## Checks

- [ ] `npm ci`
- [ ] `npm audit`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `forge lint` (or explain why unavailable)

List any checks not run and why.
