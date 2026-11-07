# YubiKey Fill for Brave

YubiKey Fill detects a supported OTP field on an HTTPS page, matches the exact site to an account on your connected YubiKey, and offers **Fill code** beside the field. Click the offer to calculate and fill the code, then submit the site's form. Multiple matching accounts appear as separate buttons with masked usernames.

## Install or update

Load this checkout's `extension` directory at `brave://extensions`. Run `./Install.ps1 -ExtensionId YOUR_EXTENSION_ID` from this checkout to install the Windows helper. It needs Python 3.14 x64 with Tk and Windows .NET Framework.

Version 0.6 detects fields automatically and requires HTTPS site access. Reload the extension and accept Brave's updated permission request if shown. Refresh existing login pages. The connected key is discovered automatically when a supported OTP field appears. Account metadata is cached in trusted extension session storage for up to one minute.

The toolbar popup offers an optional **Refresh key accounts** action. **Manage pairings** is available for advanced use. Normal login use needs only a click on the inline offer.

## Security and compatibility

- HTTPS site access lets the content script detect OTP fields. Account matching checks exact known login hosts or an issuer that explicitly names an HTTPS origin. It never uses a substring match against a brand name in the site's hostname.
- Passive discovery reads account metadata using an expired challenge and never requests a current code. A password-locked OATH application returns a locked result without opening a password dialog. Unlocking that application requires the user's OATH password.
- A trusted click on the offer is required before requesting a current code. The worker checks the top-level sender, active tab, document, exact field, destination origin, account selection and code expiry. The helper checks the particular key and credential.
- TOTP secrets stay on the hardware. Codes and passwords are handled transiently. There is no app logging, clipboard use, remote service or persistent password cache. The login page can read the code once filled. Malware running as the local Windows user remains within the trust boundary.
- Existing hardware touch policies are preserved. Credentials without a touch requirement fill after the browser click. The extension never changes the key's configuration.
- Supported inputs include standard one-time-code autocomplete fields, common OTP field names, and a single code field in an authentication-app challenge. Unfamiliar markup, split inputs and embedded frames may need further adapters.
- Recognized login hosts are listed in `extension/matching.js`. A service label on a YubiKey does not contain a cryptographically verified website address, so unfamiliar providers require a verified domain mapping.

Keep OTP seeds, recovery codes, account labels and site approvals out of Git. Run `./Uninstall.ps1` to unregister the helper and remove the extension in Brave to clear its local data.

## Verify

Run `node --test tests/extension.test.mjs` and `python -m unittest discover -s tests` from an environment with the pinned host requirements. Run `node tests/browser-smoke.mjs` on Windows to test fresh-profile Brave behavior with intercepted Amazon and NVIDIA fixture pages and dummy credentials. The browser test makes no live login attempt.
