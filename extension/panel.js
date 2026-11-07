import { hostPattern, httpsOrigin, siteKey, SUGGESTIONS } from "./shared.js";

const elements = Object.fromEntries([
  "current", "origin", "chooser", "account", "use", "fill", "status", "sites",
  "summary", "domains", "enable", "read", "disable",
].map((id) => [id, document.getElementById(id)]));
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const origin = httpsOrigin(tab?.url);
let values = await chrome.storage.local.get(null);
let { preview: discovered } = await chrome.storage.session.get("preview");
let sites = values[SUGGESTIONS] || {};
const patterns = (origins) => [...new Set(origins.map(hostPattern))];

function note(message) {
  elements.status.textContent = message;
}

function renderSites(suggestions) {
  const origins = Object.keys(suggestions).sort();
  elements.sites.hidden = !origins.length;
  elements.summary.textContent = "Matched sites (" + origins.length + ")";
  elements.domains.replaceChildren(...origins.map((origin) => {
    const item = document.createElement("li");
    item.textContent = origin;
    return item;
  }));
}

async function releaseUnused(previous, next) {
  const retained = new Set(patterns([
    ...Object.keys(next),
    ...Object.keys(values).filter((key) => key.startsWith("site:") && values[key]?.prompt)
      .map((key) => key.slice(5)),
  ]));
  const unused = patterns(Object.keys(previous)).filter((pattern) => !retained.has(pattern));
  if (unused.length) await chrome.permissions.remove({ origins: unused });
}

function renderCurrent() {
  const binding = origin && values[siteKey(origin)];
  const matches = origin && !binding && sites[origin] || [];
  elements.current.hidden = !binding && matches.length < 2;
  elements.origin.textContent = origin || "";
  elements.fill.hidden = !binding;
  elements.chooser.hidden = elements.use.hidden = matches.length < 2;
  if (matches.length < 2) return;
  const placeholder = new Option("Choose the account you sign in with", "", true, true);
  placeholder.disabled = true;
  elements.account.replaceChildren(placeholder, ...matches.map((entry, index) => new Option(entry.label, index)));
  elements.use.disabled = true;
}

async function currentTab() {
  if (!tab?.id || !origin) return null;
  const current = await chrome.tabs.get(tab.id);
  return current.active && !current.pendingUrl && httpsOrigin(current.url) === origin ? current : null;
}

elements.read.addEventListener("click", async () => {
  elements.read.disabled = true;
  elements.enable.hidden = true;
  note("Reading the key. Enter the OATH password if prompted.");
  try {
    const result = await chrome.runtime.sendMessage({ kind: "panel-discover" });
    if (!result?.ok) throw new Error(result?.message || "Could not read your YubiKey.");
    discovered = result.preview;
    renderSites(discovered);
    elements.enable.hidden = !Object.keys(discovered).length;
    note(elements.enable.hidden ? "No recognized websites were found on this key."
      : "Review the matched sites and allow Brave to show offers on them.");
  } catch (error) {
    note(error.message);
  } finally {
    elements.read.disabled = false;
  }
});

elements.enable.addEventListener("click", async () => {
  if (!discovered) return;
  elements.enable.disabled = true;
  try {
    // Start the permission request in the click handler to preserve user activation.
    const [, allowed] = await Promise.all([
      chrome.storage.session.set({ grantIntent: Date.now() }),
      chrome.permissions.request({ origins: patterns(Object.keys(discovered)) }),
    ]);
    if (!allowed) {
      await chrome.storage.session.remove("grantIntent");
      note("Site access was declined.");
      return;
    }
    await chrome.storage.local.set({ [SUGGESTIONS]: discovered });
    await chrome.storage.session.remove(["preview", "grantIntent"]);
    values = await chrome.storage.local.get(null);
    await releaseUnused(sites, discovered);
    sites = discovered;
    elements.enable.hidden = true;
    elements.disable.hidden = false;
    elements.read.textContent = "Refresh matched sites";
    renderCurrent();
    note("Offers are enabled. Return to the code field to try it.");
    const current = await currentTab();
    if (current && sites[origin]) {
      await chrome.scripting.executeScript({ target: { tabId: current.id }, files: ["field.js", "prompt.js"] })
        .catch(() => {}); // Future visits use the registered content script.
    }
  } catch {
    note("Could not enable offers. Try again.");
  } finally {
    elements.enable.disabled = false;
  }
});

elements.disable.addEventListener("click", async () => {
  elements.disable.disabled = true;
  try {
    await chrome.storage.local.remove(SUGGESTIONS);
    await chrome.storage.session.remove(["preview", "grantIntent"]);
    discovered = undefined;
    values = await chrome.storage.local.get(null);
    await releaseUnused(sites, {});
    sites = {};
    elements.disable.hidden = true;
    elements.read.textContent = "Find sites on my YubiKey";
    renderSites(sites);
    elements.enable.hidden = true;
    renderCurrent();
    note("Automatic offers for new sites are off. Existing pairings are still available.");
  } catch {
    note("Could not update site access. Try again.");
  } finally {
    elements.disable.disabled = false;
  }
});

elements.account.addEventListener("change", () => {
  elements.use.disabled = elements.account.value === "";
});
elements.use.addEventListener("click", async () => {
  const entry = elements.account.value === "" ? undefined : sites[origin]?.[Number(elements.account.value)];
  if (!entry) return;
  elements.use.disabled = true;
  try {
    const current = await currentTab();
    if (!current || !await chrome.permissions.contains({ origins: [hostPattern(origin)] })) {
      throw new Error("The login tab or its site access changed.");
    }
    await chrome.storage.local.set({ [siteKey(origin)]: { ...entry, prompt: true } });
    await chrome.tabs.sendMessage(current.id, { kind: "pairing-updated" }, { frameId: 0 }).catch(() => {});
    window.close();
  } catch (error) {
    note(error.message);
    elements.use.disabled = false;
  }
});

elements.fill.addEventListener("click", async () => {
  elements.fill.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ kind: "panel-fill", tabId: tab.id, origin });
    if (result?.ok) window.close();
    else note(result?.message || "Could not fill the code.");
  } catch {
    note("Could not fill the code. Return to the login page and try again.");
  } finally {
    elements.fill.disabled = false;
  }
});

renderSites(discovered || sites);
renderCurrent();
if (Object.keys(sites).length) {
  elements.disable.hidden = false;
  elements.read.textContent = "Refresh matched sites";
} else {
  note("Find matching sites once to get an offer beside their code fields.");
}
if (discovered && Object.keys(discovered).length) {
  elements.enable.hidden = false;
  note("Review the matched sites and allow Brave to show offers on them.");
}
