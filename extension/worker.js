import { otpField } from "./field.js";
import { httpsOrigin, requestHost, siteKey } from "./shared.js";

let filling = false;

async function status(tabId, text, title) {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setTitle({ tabId, title }),
  ]).catch(() => {}); // The tab may have closed.
}

export async function fill(tab) {
  if (!tab?.id || filling) return;
  filling = true;
  const tabId = tab.id;
  let pageChanged = false;
  const onUpdated = (id, changes) => {
    if (id === tabId && (changes.url || changes.status === "loading")) pageChanged = true;
  };
  const onActivated = ({ tabId: activeId, windowId }) => {
    if (windowId === tab.windowId && activeId !== tabId) pageChanged = true;
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onActivated.addListener(onActivated);
  try {
    const origin = httpsOrigin(tab.url);
    if (!origin || tab.incognito) throw new Error("Open an approved HTTPS login page.");
    const key = siteKey(origin);
    const { [key]: binding } = await chrome.storage.local.get(key);
    if (!binding) throw new Error("Site is not approved. Right-click YubiKey Fill and choose Options.");

    const marker = crypto.randomUUID();
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: otpField,
      args: [tab.url, marker],
    });
    if (pageChanged || !probe?.result || !probe.documentId) {
      throw new Error("No single empty one-time-code field was found.");
    }
    await status(tabId, "KEY", "Touch your YubiKey when it flashes. Enter the OATH password if prompted.");
    const result = await requestHost({ op: "code", device: binding.device, id: binding.id });
    if (!/^[0-9]{6,8}$/.test(result.code) || !Number.isSafeInteger(result.expiresAt)) {
      throw new Error("The helper returned an invalid code.");
    }

    const [current, browserWindow, saved] = await Promise.all([
      chrome.tabs.get(tabId), chrome.windows.get(tab.windowId), chrome.storage.local.get(key),
    ]);
    if (pageChanged || !current.active || !browserWindow.focused || current.url !== tab.url
        || current.pendingUrl || saved[key]?.device !== binding.device || saved[key]?.id !== binding.id) {
      throw new Error("The page or approval changed. Click again.");
    }

    const [filled] = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [probe.documentId] },
      func: otpField,
      args: [tab.url, marker, result.code, result.expiresAt],
    });
    if (!filled?.result) throw new Error("The field changed or the code expired. Click again.");
    await status(tabId, "OK", "Code filled. Review the form and submit.");
  } catch (error) {
    await status(tabId, "!", error.message || "Could not fill the one-time code.");
  } finally {
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onActivated.removeListener(onActivated);
    filling = false;
  }
}

chrome.action.onClicked.addListener(fill);
