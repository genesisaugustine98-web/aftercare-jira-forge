# Codex-assisted maintenance

Aftercare includes an optional, manually triggered Codex review workflow at `.github/workflows/codex-maintainer-review.yml`.

## What it does

The workflow checks out the trusted `main` branch and asks Codex to inspect security boundaries, evidence correctness, tests, dependency/workflow maintenance and documentation accuracy. It publishes the final report as a GitHub Actions artifact with a 30-day retention period.

It is advisory only. It does not edit files, create commits, open or approve pull requests, triage or close issues, publish releases, deploy Forge, or authorize production changes.

## Enable it

1. Create an OpenAI API key for automation and review its billing/usage limits.
2. In GitHub, open **Settings → Secrets and variables → Actions** for this repository.
3. Add the secret named `OPENAI_API_KEY`. Never put the key in source code, workflow inputs, issues or logs.
4. Open **Actions → Codex maintainer review → Run workflow** and run it from `main`.
5. Inspect the resulting `aftercare-codex-maintainer-review` artifact. Verify each finding independently before changing code.

The workflow does not run on pull-request events and refuses to run its review job when dispatched from a branch other than `main`. It grants Codex read-only repository access and gives the workflow no repository-content write permission. The artifact publication job receives only the generated report.

## Cost and limits

The workflow requires an OpenAI API key. It can incur API usage charges or consume credits associated with that key. It is not automatically enabled by ChatGPT Pro, and it does not assume that this repository has been accepted into any OpenAI programme. Run it deliberately and monitor usage.

## Human control

Codex output is a review suggestion, not an approval, security certification or release decision. A maintainer must reproduce and assess findings, run the required tests, review the diff and make all merge/release/deployment decisions.
