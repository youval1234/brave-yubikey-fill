export const HOST = "com.youval1234.brave_yubikey_fill";
export const SUGGESTIONS = "recognized-sites";
export const INVENTORY_VERSION = 2;

export function httpsOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) {
      return url.origin;
    }
  } catch {
    // Invalid browser or settings URL.
  }
  return null;
}

export const siteKey = (origin) => "site:" + origin;
export const hostPattern = (origin) => "https://" + new URL(origin).hostname + "/*";

export const errors = {
  locked: "Unlock the OATH application in Yubico Authenticator to discover its accounts.",
  cancelled: "OATH password entry was cancelled.",
  password: "The YubiKey rejected the OATH password.",
  device: "Connect exactly one YubiKey with USB smart card (CCID) enabled.",
  credential: "This account is unavailable on the connected key. Pair it again in Options.",
  touch: "This pairing requires touch, but the account's touch policy changed. Review the pairing in Options.",
  expired: "The code expired. Click again.",
  hardware: "The YubiKey did not return a code. Check that it is connected and try again.",
  timeout: "The helper timed out. Click again and touch the key if it flashes.",
  host: "The Windows helper could not start. Check the setup instructions.",
  updates: "Could not check private releases. Check the helper setup and GitHub CLI sign-in, or view releases on GitHub.",
};

export async function requestHost(request) {
  let response;
  try {
    response = await chrome.runtime.sendNativeMessage(HOST, request);
  } catch {
    throw new Error(errors.host);
  }
  if (response?.ok !== true) {
    throw new Error(Object.hasOwn(errors, response?.error) ? errors[response.error] : errors.host);
  }
  return response;
}
