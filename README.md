# YubiKey Fill for Brave

YubiKey Fill detects a supported OTP field on an HTTPS page and matches the exact site to an account on your connected YubiKey. Hover over the field for 280 ms to reveal a green-and-charcoal card. It shows the code and seconds remaining, refreshing the preview when it expires. Click **Fill code**, then submit the site's form. Multiple matching accounts appear as separate buttons with masked usernames.

## Install or update

Load this checkout's `extension` directory at `brave://extensions`. Run `./Install.ps1 -ExtensionId YOUR_EXTENSION_ID` from this checkout to install the Windows helper. It needs Python 3.14 x64 with Tk and Windows .NET Framework.

Version 0.7 adds hover previews and needs the updated Windows helper. Run the installer, reload the extension and refresh existing login pages. The connected key is discovered when the pointer hovers over a supported field. Account metadata is cached in trusted extension session storage for up to one minute.

Version 0.7.1 reduces page work and retained memory: the DOM observer runs only during a relevant hover, unrelated pointer movement skips field scans, popup styles are created on demand, and closing the card clears its code and DOM references. The native helper is unchanged from 0.7.0; no helper reinstall is needed for this update.

Private windows are supported using a separate extension worker. After reloading v0.7.1, open the extension's Details at `brave://extensions` and enable **Allow in Private** once; Brave controls this opt-in. Existing normal-window pairings remain available, but automatic fills in private windows do not save new site/account pairings. Chromium shares extension `storage.local` between normal and private windows, so explicitly changing settings in the extension's options still changes shared settings. Private access uses the same HTTPS, hover, trusted-click, field and origin checks.

The toolbar popup offers an optional **Refresh key accounts** action to reread the key's account list after adding or removing an account. Automatic matching also refreshes expired metadata as needed; this button is not a required sign-in step. A password-locked OATH application may ask for its password when using this action. **Manage pairings** is available for advanced use. Normal login use needs only a click on the inline offer.

## Security and compatibility

- HTTPS site access lets the content script detect OTP fields. Account matching checks exact known login hosts or an issuer that explicitly names an HTTPS origin. It never uses a substring match against a brand name in the site's hostname.
- Passive discovery reads account metadata using an expired challenge and never requests a current code. A password-locked OATH application returns a locked result without opening a password dialog. Unlocking that application requires the user's OATH password.
- Hovering requests a current code for preview only while the field or card is under the pointer in the foreground tab. Preview requests stop when the card closes or the page loses focus. A trusted click is required to fill the form. The worker checks the top-level sender, active tab, document, exact field, destination origin, account selection and code expiry. The helper checks the particular key and credential.
- Previews apply to a uniquely matched account without hardware touch. Password-protected or touch-required accounts keep their protections and use the Fill code action. Codes with a configured length of eight digits retain their full length.
- TOTP secrets stay on the hardware. Codes and passwords are handled transiently. There is no app logging, clipboard use, remote service or persistent password cache. The login page can read the code once filled. Malware running as the local Windows user remains within the trust boundary.
- Existing hardware touch policies are preserved. Credentials without a touch requirement fill after the browser click. The extension never changes the key's configuration.
- Supported inputs include standard one-time-code autocomplete fields, common OTP field names, and a single code field in an authentication-app challenge. Unfamiliar markup, split inputs and embedded frames may need further adapters.
- Recognized login hosts are listed in `extension/matching.js`. A service label on a YubiKey does not contain a cryptographically verified website address, so unfamiliar providers require a verified domain mapping.

Keep OTP seeds, recovery codes, account labels and site approvals out of Git. Run `./Uninstall.ps1` to unregister the helper and remove the extension in Brave to clear its local data.

## Verify

Run `node --test tests/extension.test.mjs` and `python -m unittest discover -s tests` from an environment with the pinned host requirements. Run `node tests/browser-smoke.mjs` on Windows to test fresh-profile Brave behavior with intercepted Amazon and NVIDIA fixture pages and dummy credentials. The browser test makes no live login attempt.

The browser test also checks idle-page work and observer cleanup, then deletes its temporary profile. Set `YUBIKEY_TEST_SCREENSHOT` to an output PNG path only when a dummy preview screenshot is needed.

Run `node tests/memory-smoke.mjs` for an approximate fresh-profile memory comparison. It uses dummy credentials, reports the fixture page's total JavaScript heap and the isolated Brave process tree's working set, then checks memory after the extension worker has had time to suspend. Browser process measurements include Chromium overhead and shared pages; they are not an exact measurement of extension allocations.
