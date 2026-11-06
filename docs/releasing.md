# Release process

Aftercare has not yet published a stable tagged release. Do not create a version merely to make the project appear mature. A release should represent a verifiable capability that another team can install and use.

## Release gates

Before publishing a release:

1. Confirm the intended capability is implemented and accurately described in both READMEs.
2. Complete the documented tests, dependency audit, lint and Forge validation.
3. Verify the app in a clean Jira development tenant. For GitLab evidence, verify the permission upgrade, webhook signature validation, event-to-issue mapping, revision binding, replay handling, freshness rules and failure states.
4. Confirm no credentials, customer data, temporary test artefacts or private endpoints are committed.
5. Review open security reports and known high-impact defects.
6. Update `CHANGELOG.md` with user-visible changes, breaking changes, migration steps and known limitations.
7. Align the repository release tag with the Forge app package version and deployment instructions. Do not publish a repository tag that implies a stable app version while the nested package remains an unrelated prerelease.
8. Have the maintainer review the final diff and release notes.

## Versioning

Use semantic versioning once the public installable product has a stable compatibility contract:

- `0.y.z` while the public API and install/migration contract are still evolving.
- Increase the patch version for compatible fixes, the minor version for compatible functionality, and the major version for breaking changes once the project reaches `1.0.0).

Pre-release identifiers such as `-rc.1` may be used for release candidates. Do not use a stable tag for an unvalidated development snapshot.

## Publishing

After all gates pass:

1. Update `CHANGELOG.md` and the app package version.
2. Run the complete release checks from [CONTRIBUTING.md](../CONTRIBUTING.md).
3. Create an annotated tag on the exact reviewed commit.
4. Publish GitHub release notes copied from the changelog, including installation, upgrade, rollback and known-limitations instructions.
5. Verify the release page, tag, package version and installation instructions agree.
6. Keep the previous known-good deployment and document rollback steps.

Releases are maintainer-controlled. CI or Codex output may inform a release, but neither may publish, approve or deploy a production release autonomously.
