export const HOST = "com.youval1234.brave_yubikey_fill";

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

export const errors = {
  cancelled: "OATH password entry was cancelled.",
  password: "The YubiKey rejected the OATH password.",
  device: "Connect exactly one YubiKey with USB smart card (CCID) enabled.",
  touch: "The credential no longer requires touch or is unavailable.",
  expired: "The code expired. Click again and touch the key promptly.",
  hardware: "The YubiKey did not return a code. Check the key and touch again.",
  timeout: "The helper timed out. Click again and touch the key when it flashes.",
  host: "The Windows helper could not start. Check the setup instructions.",
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
