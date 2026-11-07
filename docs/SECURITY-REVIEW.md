# Security and privacy review — 2026-11-07

Publication note, 2026-11-08: the owner authorized publishing the repository as an experimental public preview. Visibility observations below describe the earlier private review, not the current access policy. The current security policy links to private vulnerability reporting. Independent review and signed/attested releases remain outstanding.

Scope: v0.7.3 source, the preceding 12 reachable commits (114 distinct blobs), two unreachable local blobs, project files and images, GitHub repository settings, local helper registration, dependencies and release packaging. This is an internal source review and automated regression pass, not an independent penetration test or assurance that no vulnerabilities exist.

## Repository and privacy findings

- Repository visibility is private. Only the owner is listed as a collaborator. Pages, Wiki and Discussions are disabled. The account's two-factor-authentication status could not be established through the available API.
- At review start there were no releases, forks, issue/PR conversations, Actions runs/artifacts, deploy keys or webhooks. The v0.7.3 private release is being added with committed-source packages and checksums.
- Pattern scans across history and local orphan blobs found no access tokens, private keys, personal email addresses, personal Windows user paths, OTP seed URIs or long live-auth query values. Commit email addresses use GitHub noreply. The necessary GitHub owner/repository name is an intentional identifier, not a secret.
- Tracked images are the generic toolbar preview and icon variants. Representative full-size historical/current icons and the screenshot were visually reviewed and have no PNG text/EXIF chunks. No user login screenshots, real OTPs or account lists are included.
- Runtime manifests, local CLI-path configuration, helper executables/environments, browser profiles and temporary reports are outside release packages. Additional ignore rules protect common credential and generated-file names. Ignore rules do not protect files already committed; history was reviewed separately.

## Hardening in this release

| Area | Result |
| --- | --- |
| Popup native requests | Both metadata refresh and update checks now require the exact extension ID and popup URL. Added a regression for foreign senders and website callers. |
| Extension page policy | Explicit CSP permits local scripts/styles/images and blocks remote connections, objects, frames, base overrides and form navigation. |
| Private release check | Exact input schema, fixed read-only GitHub endpoint, resolved local CLI path, no shell, no interactive login, 15-second timeout, discarded stderr, strict stable-version parsing. Only version and a constructed repository release URL leave the helper. |
| Release link display | Numeric version comparison, exact owner/repository/tag agreement, text-only feedback and safe navigation attributes. No remote code is downloaded or executed. |
| Release packaging | Only committed files are archived; the extension ZIP has its manifest at root. Source ZIP includes installer/helper source rather than local runtime directories. SHA-256 checksums accompany the ZIPs. |

No confirmed critical/high-severity remotely exploitable defect was identified in the reviewed paths. The sender and CSP changes are defense in depth; this statement is limited by the scope and tests below.

## Controls reviewed and tested

- HTTPS/exact-origin matching; lookalike and unexpected-port rejection; URL credentials rejected.
- Top-level active document, same-document redirects, foreground/focus and permission rechecks before/after a native operation.
- One-use trusted-click marker tied to the original field; replaced fields, unsafe form destinations and imminent expiry rejected; form submission remains manual.
- Native request/response size limits, exact operation schema, origin allowlist, generic errors, password unlock flow and exact key/credential selection under an exclusive smart-card connection.
- Touch policy cannot silently downgrade; HOTP credentials excluded; discovery uses an expired challenge; preview respects touch/password policies.
- Private-worker context isolation, no automatic private pairing persistence, safe dynamic text rendering and no app clipboard/logging/telemetry paths.
- Hover-out preview cancellation, cleared code display, stopped idle observer and preserved interactive/timer behavior.
- Update metadata rejects malformed, prerelease, draft and mismatched versions/URLs; no untrusted command arguments or credential values are returned.
- A real isolated Brave popup blocks remote fetches and injected inline scripts under the new policy. Current/newer/unavailable/malicious release-result UI states pass, with no update request before clicking. The normal hover/fill browser regressions also pass.

The helper directory was not writable by Everyone, the standard Users group or Authenticated Users in the inspected ACL. Same-user write access remains expected. `pip check` reported no broken requirements. OSV query-batch checks returned no known advisories for the 17 exact pinned packages on the review date. Packages remain hash-pinned; this is not a supply-chain or zero-day guarantee.

## Data flows and residual risks

Normal OTP operations are local USB plus Native Messaging. The explicit update action contacts GitHub using the existing CLI sign-in; GitHub sees the request, account and normal connection information. The request contains a constant repository path, with no OTP, account label, credential ID or browsing URL. Package installation contacts PyPI. Browsing a release is ordinary GitHub navigation.

Normal-window local storage contains site/account associations and account metadata, accessible to this extension's trusted contexts. This is not encrypted vault storage and must not be committed or uploaded. Session metadata expires; private fills do not save new pairings. Explicit options edits affect shared settings in both browsing modes.

An attacker controlling an approved website can read a code filled there. Treat previews as available to a compromised renderer; a closed shadow root is not a security boundary. Stored issuer labels are not cryptographically verified domain identities. A malicious local process can access no-touch, unlocked OATH accounts independently, impersonate native-host arguments, read same-user files or alter installed code. The extension does not extract seed secrets through its APIs, but this review does not assess firmware or physical extraction attacks. TOTP remains susceptible to phishing/relay; use FIDO/passkeys where appropriate.

There is no signed updater or store-distributed package in this release. Updates are checked, downloaded by the user and manually applied. Hash files are not signatures. At review time, keeping the repository private was recommended pending independent review, private vulnerability reporting, account-protection checks and signed/attested distribution decisions. The owner subsequently authorized an experimental public preview; that publication does not resolve the outstanding assurance and signing work.
