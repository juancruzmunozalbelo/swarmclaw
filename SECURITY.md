# Security Policy

NanoClaw takes isolation and least-privilege seriously.

## Supported Versions

Security fixes are provided for the latest `main` branch.

## Reporting a Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Report privately to:

- Email: REPLACE_WITH_YOUR_SECURITY_EMAIL
- Include: impact, reproduction steps, affected commit/version, and logs/screenshots if relevant

You can expect:

- Initial acknowledgement within 72 hours
- Triage and severity assessment
- Coordinated disclosure once a fix is available

## Security Model

Detailed security model and threat boundaries are documented in:

- `docs/SECURITY.md`

Key principles:

- Agent execution is isolated in Linux containers
- Mounts are explicit per group
- Main/admin channel has elevated access and should be protected
- Secrets should never be committed (`.env`, keys, auth stores)
