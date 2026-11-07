# YubiKey Fill for Brave

A Windows and Brave extension that offers to fill a time-based OATH code beside the code field on an approved site. Click **Fill code**, touch the YubiKey if it flashes, then review and submit the form.

## Set up

1. Keep this checkout in a location writable only by you. Open `brave://extensions`, enable **Developer mode**, select **Load unpacked**, and choose this checkout's `extension` folder. Copy the extension ID shown by Brave.
2. In PowerShell from this checkout, run `./Install.ps1 -ExtensionId YOUR_EXTENSION_ID`. The helper needs x64 Python 3.14 with Tk and Windows .NET Framework. Use `-Python 'C:\path\to\python.exe'` if needed. Setup installs hash-pinned wheels in a private environment under your Windows profile and registers the helper for your user. If the folder moves and Brave assigns a different ID, rerun setup with the new ID.
3. Plug in one USB YubiKey with the smart-card interface enabled. In the **YubiKey Fill** toolbar popup, click **Find sites on my YubiKey** and then **Allow automatic offers**. Brave asks for access to the matched hosts. You can refresh the list after changing keys or adding accounts.
4. Open or refresh a matched site's code challenge. The card appears beside a recognized code field. Click **Approve & fill** the first time for a unique match, or **Choose account** if several entries match. On future visits, click **Fill code**. Touch the key if it flashes, then review and submit the form. The toolbar popup and **Alt+Shift+Y** also offer fill on approved sites. You can change the shortcut at `brave://extensions/shortcuts`.

For a service whose issuer label does not identify a recognized website, use **Manage pairings** from the toolbar popup to approve an exact origin manually. **Turn off automatic offers** removes discovery for new sites and keeps previously approved pairings available.

The extension supports a single visible, empty, top-level input marked `autocomplete="one-time-code"` or using a recognized OTP field name. Split inputs, embedded frames and unfamiliar markup use manual entry. Existing time-based OATH accounts work with their current touch settings. If OATH is password-protected, enter the password in the local **YubiKey Fill** dialog when prompted and return focus to the same Brave tab if needed. The helper never changes the YubiKey configuration.

## Security model

- The toolbar action uses temporary active-tab access. The discovery popup requests optional access for the exact matched HTTPS hosts. Brave's permission pattern covers each hostname across ports, while the extension checks the exact recognized or approved origin, including port, before offering or filling.
- Discovery uses the key's issuer labels and recognized hostnames. Candidate account details stay in extension storage and the toolbar popup. An inline offer only indicates that the site has a match. A unique match becomes a saved pairing after you click **Approve & fill** and the fill succeeds.
- The prompt lives in a closed shadow root and requires a trusted browser click before asking the helper for a code. The extension checks the sender, active tab, original document, exact field, form destinations, approval and code expiry. Each origin has one account binding in local extension storage.
- The helper runs on demand and accepts only the configured extension origin through Brave's Native Messaging registration. It binds approvals to the particular key's OATH device ID and exact credential ID. It checks the hardware touch policy using the YubiKey's bulk response with a long-expired challenge, then requests a current code for just the approved credential. Pairings that required touch keep that requirement. A newly selected **No touch** account fills after the browser click without confirmation on the key itself.
- TOTP seeds stay on the YubiKey. Codes and passwords are handled transiently, with no app logs, clipboard use, remote service, or persistent password cache. The website can read a code once it is in its form. The local helper and extension trust the user's Windows account and browser installation. Malware or a compromised approved site can still capture a live code.
- TOTP remains relayable. Use a FIDO2 security key or passkey for supported accounts.

For a first trial, use a disposable account. Keep site approvals, credential labels, OTP seeds, and recovery codes out of Git.

## Verify and remove

Run the regression tests with `node --test tests/extension.test.mjs` and `python -m unittest discover -s tests` from an environment with the pinned host requirements installed. They exercise dummy codes and a fake YubiKey session.

Version 0.3 adds support for existing accounts without a touch requirement. To update an earlier installation, rerun `./Install.ps1 -ExtensionId YOUR_EXTENSION_ID` and reload the extension in Brave.

Run `./Uninstall.ps1` to unregister the helper. Remove the extension in Brave to erase its local approvals. The uninstall script prints the path to the local helper files for optional removal.
