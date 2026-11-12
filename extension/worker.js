import { hostPattern, httpsOrigin, requestHost, siteKey, SUGGESTIONS, INVENTORY_VERSION } from "./shared.js";
import { suggestionsForAccounts } from "./matching.js";

let filling = false;
let inventoryRequest;
let previewing = false;

function sameContext(tab) {
  return Boolean(tab?.incognito) === Boolean(chrome.extension?.inIncognitoContext);
}

async function preview(tab, documentId) {
  if (previewing) return { ok: false };
  previewing = true;
  try {
    const origin = httpsOrigin(tab.url);
    const key = siteKey(origin);
    const { [key]: binding } = await chrome.storage.local.get(key);
    const matches = binding ? [binding] : await suggestions(origin);
    if (matches.length !== 1 || binding?.prompt === false) return { ok: false };
    const selected = matches[0];
    if (selected.touchRequired !== false) return { ok: false, protected: true };
    const target = { tabId: tab.id, documentIds: [documentId] };
    const validContext = async () => {
      const [current, browserWindow, allowed] = await Promise.all([
        chrome.tabs.get(tab.id), chrome.windows.get(tab.windowId),
        chrome.permissions.contains({ origins: [hostPattern(origin)] }),
      ]);
      if (!sameContext(current) || !current.active || !browserWindow.focused || current.url !== tab.url || current.pendingUrl || !allowed) return false;
      const [probe] = await chrome.scripting.executeScript({
        target, func: (url) => globalThis.yubiKeyFillField?.previewProbe(url), args: [tab.url],
      });
      return probe?.result === true;
    };
    if (!await validContext()) return { ok: false };
    const result = await requestHost({ op: "preview", device: selected.device, id: selected.id, requireTouch: false });
    const { [key]: saved } = await chrome.storage.local.get(key);
    const currentMatches = saved ? [saved] : await suggestions(origin);
    if (saved?.prompt === false || currentMatches.length !== 1 || !sameAccount(currentMatches[0], selected)
        || !await validContext()) return { ok: false };
    if (typeof result.code !== "string" || !/^[0-9]{6,8}$/.test(result.code)
        || !Number.isSafeInteger(result.expiresAt) || !Number.isSafeInteger(result.startsAt)
        || result.expiresAt <= Date.now() || result.startsAt >= result.expiresAt) return { ok: false };
    return { ok: true, code: result.code, expiresAt: result.expiresAt, startsAt: result.startsAt };
  } catch {
    return { ok: false };
  } finally {
    previewing = false;
  }
}

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

async function suggestions(origin) {
  const saved = await chrome.storage.local.get(SUGGESTIONS);
  if (saved[SUGGESTIONS]?.[origin]) return saved[SUGGESTIONS][origin];
  const { inventory } = await chrome.storage.session.get("inventory");
  if (inventory?.version === INVENTORY_VERSION && inventory.expires > Date.now()) return inventory.sites[origin] || [];
  if (!inventoryRequest) {
    inventoryRequest = requestHost({ op: "discover" }).then(async ({ accounts }) => {
      const sites = suggestionsForAccounts(accounts);
      await chrome.storage.session.set({ inventory: { version: INVENTORY_VERSION, sites, expires: Date.now() + 60000 } });
      return sites;
    }).catch(async () => {
      await chrome.storage.session.set({ inventory: { version: INVENTORY_VERSION, sites: {}, expires: Date.now() + 5000, retry: true } });
      return {};
    }).finally(() => { inventoryRequest = undefined; });
  }
  return (await inventoryRequest)[origin] || [];
}

function sameAccount(current, expected) {
  return current?.device === expected.device && current?.id === expected.id
    && current?.touchRequired === expected.touchRequired;
}

export async function fill(tab, inlineDocument, enroll = false, choice) {
  if (!tab?.id || filling) return { ok: false, message: "A code request is already in progress." };
  tab = {...tab}; // Preserve the original browser snapshot across async stages.
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
    if (!origin || !sameContext(tab)) throw new Error("Open an approved HTTPS login page.");
    const key = siteKey(origin);
    const { [key]: savedBinding } = await chrome.storage.local.get(key);
    const matches = enroll && inlineDocument && !savedBinding ? await suggestions(origin) : [];
    const index = Number.isInteger(choice) ? choice : matches.length === 1 ? 0 : -1;
    const selected = matches[index];
    const binding = enroll && selected ? { ...selected, prompt: true } : savedBinding;
    if (!binding || (enroll && savedBinding)) throw new Error("Open YubiKey Fill to choose an account for this site.");

    let documentId = inlineDocument;
    if (inlineDocument) {
      const [current, browserWindow, allowed] = await Promise.all([
        chrome.tabs.get(tabId), chrome.windows.get(tab.windowId), canPrompt(origin, binding),
      ]);
      if (!sameContext(current) || !allowed || pageChanged || !current.active || !browserWindow.focused
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

    await status(tabId, "KEY", "Reading your YubiKey. Touch it if it flashes. Enter the OATH password if prompted.");
    if (pageChanged) throw new Error("The page changed. Try again.");
    const request = { op: "code", device: binding.device, id: binding.id };
    // Existing pairings were touch-only. Only a newly selected no-touch entry
    // can opt out, so a changed credential cannot silently downgrade them.
    if (binding.touchRequired === false) request.requireTouch = false;
    const result = await requestHost(request);
    if (typeof result.code !== "string" || !/^[0-9]{6,8}$/.test(result.code)
        || !Number.isSafeInteger(result.expiresAt)) throw new Error("The helper returned an invalid code.");

    const [current, browserWindow, saved] = await Promise.all([
      chrome.tabs.get(tabId), chrome.windows.get(tab.windowId), chrome.storage.local.get(key),
    ]);
    const currentBinding = saved[key];
    const currentMatches = enroll ? await suggestions(origin) : [];
    const stillApproved = enroll
      ? !currentBinding && sameAccount(currentMatches[index], binding)
      : sameAccount(currentBinding, binding);
    const inlineAllowed = !inlineDocument || await canPrompt(origin, enroll ? binding : currentBinding);
    if (!sameContext(current) || pageChanged || !current.active || !browserWindow.focused || current.url !== tab.url
        || current.pendingUrl || !stillApproved || !inlineAllowed) {
      throw new Error("The page or approval changed. Try again.");
    }

    const [filled] = await chrome.scripting.executeScript({
      target,
      func: (url, token, code, expiry) => globalThis.yubiKeyFillField?.fill(url, token, code, expiry),
      args: [tab.url, marker, result.code, result.expiresAt],
    });
    if (!filled?.result) throw new Error("The field changed or the code expired. Try again.");
    if (enroll && !tab.incognito) {
      // storage.local is shared with normal windows. A private login must not
      // leave a persistent record of the site/account pairing.
      // Keep any account explicitly paired in the toolbar while this request was in flight.
      const { [key]: alreadyPaired } = await chrome.storage.local.get(key);
      if (!alreadyPaired) await chrome.storage.local.set({ [key]: binding });
    }
    let submitted = false;
    // Filling can itself navigate or start verification. Do not send an extra
    // submission into another document, an inactive tab or a revoked pairing.
    const [submitTab, submitWindow, submitSaved, submitPermission] = await Promise.all([
      chrome.tabs.get(tabId), chrome.windows.get(tab.windowId), chrome.storage.local.get(key),
      chrome.permissions.contains({ origins: [hostPattern(origin)] }),
    ]);
    const submitBinding = submitSaved[key];
    const submitMatches = enroll && !submitBinding ? await suggestions(origin) : [];
    const submitApproved = submitBinding ? sameAccount(submitBinding, binding)
      : enroll && sameAccount(submitMatches[index], binding);
    if (!pageChanged && sameContext(submitTab) && submitTab.active && submitWindow.focused
        && submitTab.url === tab.url && !submitTab.pendingUrl && submitPermission && submitApproved
        && (!inlineDocument || (submitBinding || binding).prompt === true)) {
      try {
        const [attempt] = await chrome.scripting.executeScript({
          target, func: (url, token) => globalThis.yubiKeyFillField?.submit(url, token), args: [tab.url, marker],
        });
        submitted = attempt?.result === true;
      } catch { /* A website may already be navigating after handling the code. */ }
    }
    const message = submitted ? "Code filled and submission requested." : "Code filled. Submit on the page if needed.";
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
      || !sender.documentId || !sender.tab?.id || !sameContext(sender.tab)) return { ok: false };
  // MessageSender.url can describe the document's initial route after a
  // history.pushState/replaceState redirect. Use the browser's current URL
  // and keep the sender's exact origin and documentId as the trust boundary.
  const current = await chrome.tabs.get(sender.tab.id);
  if (!sameContext(current) || !current.active || httpsOrigin(current.url) !== origin || current.pendingUrl) {
    return { ok: false, retryAfterMs: 1000 };
  }
  const key = siteKey(origin);
  if (message.kind === "prompt-preview") return preview(current, sender.documentId);
  if (message.kind === "prompt-status") {
    // Showing an offer only reads metadata. Foreground focus is enforced by
    // fill() when the user clicks, before generating and releasing a code.
    const { [key]: binding } = await chrome.storage.local.get(key);
    if (binding) return { ok: Boolean(await canPrompt(origin, binding)) };
    if (!await chrome.permissions.contains({ origins: [hostPattern(origin)] })) return { ok: false };
    const matches = await suggestions(origin);
    if (matches.length === 1) return { ok: true, setup: "unique" };
    if (matches.length > 1) return {
      ok: true, setup: "choose",
      choices: matches.map((entry) => entry.label.replace(/([\w.+-])[\w.+-]*@/g, "$1…@")),
    };
    const { inventory } = await chrome.storage.session.get("inventory");
    return inventory?.retry ? { ok: false, retryAfterMs: 5000 } : { ok: false };
  }
  if (message.kind === "prompt-fill" || message.kind === "prompt-enroll") {
    return fill(current, sender.documentId, message.kind === "prompt-enroll", message.choice);
  }
  return { ok: false };
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "fill-code") void fill(tab);
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const fromPanel = sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("panel.html");
  if (message?.kind === "panel-update-check" && fromPanel) {
    requestHost({ op: "update-check" }).then(reply,
      () => reply({ ok: false, message: "Could not check here. Update the Windows helper and check GitHub CLI sign-in, or view releases on GitHub." }));
    return true;
  }
  if (message?.kind === "panel-discover" && fromPanel) {
    requestHost({ op: "accounts" }).then(async ({ accounts }) => {
      // A native password dialog can close the toolbar popup. Keep the
      // preview in trusted session storage so it is ready when reopened.
      const preview = suggestionsForAccounts(accounts);
      await chrome.storage.session.set({ preview });
      reply({ ok: true, preview });
    }).catch((error) => reply({ ok: false, message: error.message }));
    return true;
  }
  if (!["prompt-status", "prompt-fill", "prompt-enroll", "prompt-preview"].includes(message?.kind)) return;
  handlePrompt(message, sender).then(reply, () => reply({ ok: false }));
  return true;
});

function removeLegacyRegistration() {
  chrome.scripting.unregisterContentScripts({ ids: ["yubikey-inline"] }).catch(() => {});
}

export async function injectOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://*/*"] });
  await Promise.allSettled(tabs.filter(sameContext).map((tab) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["field.js", "prompt.js"] })));
}

function activateOffers() {
  removeLegacyRegistration();
  injectOpenTabs().catch(() => {});
}
chrome.runtime.onInstalled.addListener(activateOffers);
chrome.runtime.onStartup.addListener(activateOffers);
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.sendMessage(tabId, { kind: "retry-offer" }, { frameId: 0 }).catch(() => {});
});
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
