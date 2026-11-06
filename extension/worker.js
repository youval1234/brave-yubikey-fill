import { hostPattern, httpsOrigin, requestHost, siteKey } from "./shared.js";
import { syncPrompts } from "./prompts.js";

let filling = false;

async function status(tabId, text, title) {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setTitle({ tabId, title }),
  ]).catch(() => {}); // The tab may have closed.
}

function canPrompt(origin, binding) {
  return binding?.prompt === true
    && chrome.permissions.contains({ origins: [hostPattern(origin)] });
}

export async function fill(tab, inlineDocument, openSetup = false) {
  if (!tab?.id || filling) return { ok: false, message: "A code request is already in progress." };
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
    if (!binding) {
      if (openSetup && !pageChanged) {
        const options = new URL(chrome.runtime.getURL("options.html"));
        options.searchParams.set("site", origin);
        await chrome.tabs.create({ url: options.href });
      }
      throw new Error("Site is not approved. Open YubiKey Fill Options.");
    }

    let documentId = inlineDocument;
    if (inlineDocument) {
      const [current, browserWindow, allowed] = await Promise.all([
        chrome.tabs.get(tabId), chrome.windows.get(tab.windowId), canPrompt(origin, binding),
      ]);
      if (!allowed || pageChanged || !current.active || !browserWindow.focused
          || current.url !== tab.url || current.pendingUrl) {
        throw new Error("The page or its inline permission changed. Try again.");
      }
    } else {
      const [installed] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["field.js"],
      });
      documentId = installed?.documentId;
    }

    if (pageChanged || !documentId) throw new Error("The page changed. Try again.");
    const target = { tabId, documentIds: [documentId] };
    const marker = crypto.randomUUID();
    const [probe] = await chrome.scripting.executeScript({
      target,
      func: (url, token, inline) => globalThis.yubiKeyFillField?.probe(url, token, inline),
      args: [tab.url, marker, Boolean(inlineDocument)],
    });
    if (pageChanged || !probe?.result) throw new Error("No single empty one-time-code field was found.");

    await status(tabId, "KEY", "Touch your YubiKey when it flashes. Enter the OATH password if prompted.");
    if (pageChanged) throw new Error("The page changed. Try again.");
    const result = await requestHost({ op: "code", device: binding.device, id: binding.id });
    if (typeof result.code !== "string" || !/^[0-9]{6,8}$/.test(result.code)
        || !Number.isSafeInteger(result.expiresAt)) throw new Error("The helper returned an invalid code.");

    const [current, browserWindow, saved] = await Promise.all([
      chrome.tabs.get(tabId), chrome.windows.get(tab.windowId), chrome.storage.local.get(key),
    ]);
    const currentBinding = saved[key];
    const inlineAllowed = !inlineDocument || await canPrompt(origin, currentBinding);
    if (pageChanged || !current.active || !browserWindow.focused || current.url !== tab.url
        || current.pendingUrl || currentBinding?.device !== binding.device
        || currentBinding?.id !== binding.id || !inlineAllowed) {
      throw new Error("The page or approval changed. Try again.");
    }

    const [filled] = await chrome.scripting.executeScript({
      target,
      func: (url, token, code, expiry) => globalThis.yubiKeyFillField?.fill(url, token, code, expiry),
      args: [tab.url, marker, result.code, result.expiresAt],
    });
    if (!filled?.result) throw new Error("The field changed or the code expired. Try again.");
    const message = "Code filled. Review the form and submit.";
    await status(tabId, "OK", message);
    return { ok: true, message };
  } catch (error) {
    const message = error.message || "Could not fill the one-time code.";
    await status(tabId, "!", message);
    return { ok: false, message };
  } finally {
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onActivated.removeListener(onActivated);
    filling = false;
  }
}

export async function handlePrompt(message, sender) {
  const origin = httpsOrigin(sender.url);
  if (sender.id !== chrome.runtime.id || !origin || sender.origin !== origin
      || sender.frameId !== 0 || sender.documentLifecycle !== "active"
      || !sender.documentId || !sender.tab?.id || sender.tab.incognito) return { ok: false };
  const key = siteKey(origin);
  if (message.kind === "prompt-status") {
    const { [key]: binding } = await chrome.storage.local.get(key);
    return { ok: Boolean(await canPrompt(origin, binding)) };
  }
  if (message.kind === "prompt-fill") return fill({ ...sender.tab, url: sender.url }, sender.documentId);
  return { ok: false };
}

chrome.action.onClicked.addListener((tab) => { void fill(tab, undefined, true); });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.kind !== "prompt-status" && message?.kind !== "prompt-fill") return;
  handlePrompt(message, sender).then(reply, () => reply({ ok: false }));
  return true;
});

function refreshPrompts() {
  syncPrompts().catch(() => {}); // A subsequent change or startup retries registration.
}
chrome.runtime.onInstalled.addListener(refreshPrompts);
chrome.runtime.onStartup.addListener(refreshPrompts);
chrome.permissions.onAdded.addListener(refreshPrompts);
chrome.permissions.onRemoved.addListener(refreshPrompts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some((key) => key.startsWith("site:"))) refreshPrompts();
});
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
