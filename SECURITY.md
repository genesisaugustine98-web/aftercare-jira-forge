# Security policy

Aftercare is early-stage software. Do not assume it is suitable for production security decisions or that every planned security control is implemented.

## Reporting a vulnerability

Please do not disclose exploitable details in a public issue or pull request.

Use GitHub's private vulnerability reporting flow if it is enabled for this repository: open the repository's **Security** tab and choose **Report a vulnerability** under Security Advisories. If that option is unavailable, contact the maintainer privately through the contact method listed on the maintainer's public GitHub profile and include the repository name and a safe way to follow up.

Do not send credentials, access tokens, customer records or live transaction data. A minimal reproduction using synthetic data is preferred.

## What to include

- A concise description of the affected component and impact.
- The affected commit, version or deployment context.
- Reproduction steps using a non-production environment.
- Any relevant logs with secrets and personal data removed.
- A suggested mitigation, if known.

## Handling

The maintainer will make a best-effort attempt to acknowledge a private report, verify the issue, assess impact, and coordinate a fix and disclosure. No fixed response or remediation SLA is currently offered. Please allow reasonable time for investigation before public disclosure.

Do not test against systems, tenants or data that you do not own or have explicit permission to assess.

## Scope and safe testing

The application currently provides a read-only Jira project-context dashboard. The GitLab evidence receiver and related features have additional setup and validation requirements documented in the application README. Test only against development tenants and synthetic events unless a separate written test authorization exists.
