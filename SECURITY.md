# Security policy

This project is under active development. Security fixes target the latest release. The repository remains private pending further review; the checks documented here are not an independent security certification.

## Reporting an issue

Do not post OTPs, seeds, recovery codes, account labels, browser profiles, GitHub tokens or exploit details in public issues. Use GitHub's private vulnerability-reporting feature if available, or an established private channel with the maintainer. A dedicated private reporting channel must be verified before public distribution.

Report the affected release, minimal reproduction using dummy accounts, expected/actual behavior and impact. Do not extract or send a real hardware secret to demonstrate an issue.

## Security boundaries

The extension checks exact HTTPS origins, active top-level documents, focused windows, permissions, the selected key/credential and a trusted click before inline filling. Preview is an explicit hover feature and generates a current OTP without a click for eligible no-touch, unlocked accounts. Native touch/password policies are preserved.

A filled code is available to the receiving website. Content-script previews share a renderer with the website; shadow DOM does not provide a confidentiality boundary. Account metadata and saved pairings are local sensitive data. Local malware, browser compromise, compromised legitimate sites and hardware/firmware attacks are outside this project's isolation guarantees.

Native Messaging origin checks restrict browser callers; a local program can imitate command-line arguments. They do not authenticate an executable against malware running as the same Windows user. GitHub CLI is an optional trusted local dependency for private release checks; its credentials are not copied into the extension.

## Before public distribution

Obtain an independent review, verify a private reporting channel and support policy, review publisher-account protections, and choose a signed/attested distribution strategy. ZIP hashes detect corruption against a trusted published checksum; they are not a digital signature and do not protect against a compromised publisher account. Do not describe this project as vulnerability-free or phishing-resistant.

See [the current review](docs/SECURITY-REVIEW.md) for tested controls, findings, scope and limits.
