# YubiKey Fill for Brave

A Windows and Brave extension that offers to fill a time-based OATH code beside the code field on an approved site. Click **Fill code**, touch the YubiKey when it flashes, then review and submit the form.

## Set up

1. Keep this checkout in a location writable only by you. Open `brave://extensions`, enable **Developer mode**, select **Load unpacked**, and choose this checkout's `extension` folder. Copy the extension ID shown by Brave.
2. In PowerShell from this checkout, run `./Install.ps1 -ExtensionId YOUR_EXTENSION_ID`. The helper needs x64 Python 3.14 with Tk and Windows .NET Framework. Use `-Python 'C:\path\to\python.exe'` if needed. Setup installs hash-pinned wheels in a private environment under your Windows profile and registers the helper for your user. If the folder moves and Brave assigns a different ID, rerun setup with the new ID.
3. Plug in one USB YubiKey with the smart-card interface enabled. Click **YubiKey Fill** on an unpaired login page to open setup for that origin, or right-click the toolbar button and choose **Options** to enter an origin yourself. Select **Read YubiKey accounts**, choose the matching touch-enabled TOTP entry, and select **Approve site**. When Brave asks, allow access to that host if you want an inline prompt. If you paired the site in an earlier version, use **Enable prompt** next to the site in Options.
4. Refresh the code challenge and focus its code field. Click **Fill code** in the card and touch the key when it flashes. The toolbar button and **Alt+Shift+Y** still work with temporary active-tab access. Hover over **!** on the toolbar for errors. You can change the shortcut at `brave://extensions/shortcuts`.

The extension supports a single visible, empty, top-level input marked `autocomplete="one-time-code"` or matching a known Amazon verification field. Split inputs, embedded frames and other unmarked fields use manual entry. Existing credentials without the YubiKey's **Require touch** policy are ineligible. If OATH is password-protected, enter the password in the local **YubiKey Fill** dialog when prompted. Return focus to the same Brave tab before touching the key if needed. The helper never changes the YubiKey configuration.

## Security model

- The toolbar action uses temporary active-tab access. Inline prompts use optional permissions granted one HTTPS host at a time. Brave's permission pattern covers the hostname across ports, while the extension checks the exact approved origin, including port, before offering or filling. You can turn off the prompt or remove the pairing from Options.
- The prompt lives in a closed shadow root and requires a trusted browser click before asking the helper for a code. The extension checks the sender, active tab, original document, exact field, form destinations, approval and code expiry. Each origin has one account binding in local extension storage. The page can imitate the prompt's appearance, so the approval and hardware touch checks remain important.
- The helper runs on demand and accepts only the configured extension origin through Brave's Native Messaging registration. It binds approvals to the particular key's OATH device ID and exact credential ID. It checks the hardware touch policy using the YubiKey's bulk response with a long-expired challenge, then requests a current code for just the approved credential. The expired responses remain inside the short-lived helper process.
- TOTP seeds stay on the YubiKey. Codes and passwords are handled transiently, with no app logs, clipboard use, remote service, or persistent password cache. The website can read a code once it is in its form. The local helper and extension trust the user's Windows account and browser installation. Malware or a compromised approved site can still capture a live code.
- TOTP remains relayable. Use a FIDO2 security key or passkey for supported accounts.

For a first trial, use a disposable account with a touch-required TOTP credential. Keep site approvals, credential labels, OTP seeds, and recovery codes out of Git.

## Verify and remove

Run the regression tests with `node --test tests/extension.test.mjs` and `python -m unittest discover -s tests` from an environment with the pinned host requirements installed. They exercise dummy codes and a fake YubiKey session.

Version 0.2 updates the pinned Yubico SDK and cryptography package. To apply the helper update on another Windows machine, rerun `./Install.ps1 -ExtensionId YOUR_EXTENSION_ID` and reload the extension in Brave.

Run `./Uninstall.ps1` to unregister the helper. Remove the extension in Brave to erase its local approvals. The uninstall script prints the path to the local helper files for optional removal.
