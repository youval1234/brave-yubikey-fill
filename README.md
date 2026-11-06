# YubiKey Fill for Brave

A Windows and Brave extension that fills one time-based OATH code from your YubiKey after you click the toolbar button or press **Alt+Shift+Y**. You touch the key when it flashes, then review and submit the form.

## Set up

1. Keep this checkout in a location writable only by you. Open `brave://extensions`, enable **Developer mode**, select **Load unpacked**, and choose this checkout's `extension` folder. Copy the extension ID shown by Brave.
2. In PowerShell from this checkout, run `./Install.ps1 -ExtensionId YOUR_EXTENSION_ID`. The helper needs x64 Python 3.14 with Tk and Windows .NET Framework. Use `-Python 'C:\path\to\python.exe'` if needed. Setup installs hash-pinned wheels in a private environment under your Windows profile and registers the helper for your user. If the folder moves and Brave assigns a different ID, rerun setup with the new ID.
3. Plug in one USB YubiKey with the smart-card interface enabled. Right-click **YubiKey Fill** on the toolbar and choose **Options**. Enter the exact HTTPS login origin, select **Read YubiKey accounts**, choose the matching touch-enabled TOTP entry, and select **Approve site**. Use the origin where the code is entered, which can differ from the site's home page.
4. Open that site's code challenge and click the toolbar button or press **Alt+Shift+Y**. Touch the key when it flashes. If the button shows **!**, hover over it for details. You can change the shortcut at `brave://extensions/shortcuts`.

The first version supports one visible, empty, top-level input marked `autocomplete="one-time-code"` per page. Sites using unmarked fields, split inputs, or embedded frames still need manual entry. Existing credentials without the YubiKey's **Require touch** policy are ineligible. If OATH is password-protected, enter the password in the local **YubiKey Fill** dialog when prompted. Return focus to the same Brave tab before touching the key if needed. The helper never changes the YubiKey configuration.

## Security model

- The extension has temporary active-tab access. It matches an exact approved HTTPS origin, records the document and field before requesting a code, and checks again before filling. Each origin has one account binding, stored in Brave's local extension storage.
- The helper runs on demand and accepts only the configured extension origin through Brave's Native Messaging registration. It binds approvals to the particular key's OATH device ID and exact credential ID. It checks the hardware touch policy using the YubiKey's bulk response with a long-expired challenge, then requests a current code for just the approved credential. The expired responses remain inside the short-lived helper process.
- TOTP seeds stay on the YubiKey. Codes and passwords are handled transiently, with no app logs, clipboard use, remote service, or persistent password cache. The website can read a code once it is in its form. The local helper and extension trust the user's Windows account and browser installation. Malware or a compromised approved site can still capture a live code.
- TOTP remains relayable. Use a FIDO2 security key or passkey for supported accounts.

For a first trial, use a disposable account with a touch-required TOTP credential. Keep site approvals, credential labels, OTP seeds, and recovery codes out of Git.

## Verify and remove

Run the regression tests with `node --test tests/extension.test.mjs` and `python -m unittest discover -s tests` from an environment with the pinned host requirements installed. They exercise dummy codes and a fake YubiKey session.

Run `./Uninstall.ps1` to unregister the helper. Remove the extension in Brave to erase its local approvals. The uninstall script prints the path to the local helper files for optional removal.
