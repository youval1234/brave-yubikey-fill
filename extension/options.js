import { hostPattern, httpsOrigin, requestHost, siteKey } from "./shared.js";

const form = document.querySelector("#pair");
const site = document.querySelector("#site");
const account = document.querySelector("#account");
const read = document.querySelector("#read");
const save = document.querySelector("#save");
const inline = document.querySelector("#inline");
const status = document.querySelector("#status");
const sites = document.querySelector("#sites");
let accounts = [];
let approved = {};
site.value = httpsOrigin(new URLSearchParams(location.search).get("site")) || "";

async function releasePermission(origin) {
  const pattern = hostPattern(origin);
  const values = await chrome.storage.local.get(null);
  const stillUsed = Object.entries(values).some(([key, value]) =>
    key.startsWith("site:") && value.prompt && hostPattern(key.slice(5)) === pattern);
  if (!stillUsed) await chrome.permissions.remove({ origins: [pattern] });
}

async function renderSites() {
  approved = await chrome.storage.local.get(null);
  const rows = [];
  for (const [key, value] of Object.entries(approved).sort()) {
    if (!key.startsWith("site:")) continue;
    const origin = key.slice(5);
    const permission = { origins: [hostPattern(origin)] };
    const enabled = value.prompt && await chrome.permissions.contains(permission);
    const item = document.createElement("li");
    item.textContent = origin + " — " + value.label;
    const toggle = document.createElement("button");
    toggle.textContent = enabled ? "Turn off prompt" : "Enable prompt";
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      try {
        const prompt = !enabled && await chrome.permissions.request(permission);
        const { [key]: current } = await chrome.storage.local.get(key);
        if (current) await chrome.storage.local.set({ [key]: { ...current, prompt } });
        if (!prompt || !current) await releasePermission(origin);
        status.textContent = prompt && current
          ? "Prompt enabled. Refresh the login page and focus its code field."
          : enabled ? "Inline prompt turned off." : "Site access was not granted.";
      } catch {
        status.textContent = "Could not change site access. Try again.";
      } finally {
        await renderSites();
      }
    });
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await chrome.storage.local.remove(key);
      await releasePermission(origin);
      await renderSites();
    });
    item.append(toggle, remove);
    rows.push(item);
  }
  sites.replaceChildren(...rows);
}

read.addEventListener("click", async () => {
  accounts = [];
  account.replaceChildren();
  read.disabled = account.disabled = save.disabled = true;
  status.textContent = "Reading the key. Enter the OATH password if prompted.";
  try {
    ({ accounts } = await requestHost({ op: "accounts" }));
    for (const [index, entry] of accounts.entries()) {
      account.add(new Option(entry.label, index));
    }
    account.disabled = save.disabled = !accounts.length;
    status.textContent = accounts.length
      ? "Choose an account and verify the full login origin before approving."
      : "No touch-enabled TOTP accounts found on this YubiKey.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    read.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const typed = site.value.trim();
  const origin = httpsOrigin(typed);
  if (!origin || (typed !== origin && typed !== origin + "/")) {
    status.textContent = "Enter the exact HTTPS origin, with no path, wildcard or query.";
    return;
  }
  const entry = accounts[account.selectedIndex];
  if (!entry) return;
  const key = siteKey(origin);
  if (approved[key]
      && !confirm("Replace the approved account for " + origin + "?")) return;
  save.disabled = true;
  try {
    const prompt = inline.checked && await chrome.permissions.request({ origins: [hostPattern(origin)] });
    await chrome.storage.local.set({ [key]: { ...entry, prompt } });
    if (!prompt) await releasePermission(origin);
    status.textContent = prompt
      ? "Approved. Refresh the login page and focus its code field."
      : "Approved for the toolbar button or shortcut. You can enable the inline prompt below.";
    await renderSites();
  } catch {
    status.textContent = "Could not save the site. Try again.";
  } finally {
    save.disabled = !accounts.length;
  }
});

await renderSites();
