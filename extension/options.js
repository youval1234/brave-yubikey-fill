import { httpsOrigin, requestHost, siteKey } from "./shared.js";

const form = document.querySelector("#pair");
const site = document.querySelector("#site");
const account = document.querySelector("#account");
const read = document.querySelector("#read");
const save = document.querySelector("#save");
const status = document.querySelector("#status");
const sites = document.querySelector("#sites");
let accounts = [];

async function renderSites() {
  const values = await chrome.storage.local.get(null);
  sites.replaceChildren();
  for (const [key, value] of Object.entries(values).sort()) {
    if (!key.startsWith("site:")) continue;
    const item = document.createElement("li");
    item.textContent = key.slice(5) + " — " + value.label;
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await chrome.storage.local.remove(key);
      await renderSites();
    });
    item.append(remove);
    sites.append(item);
  }
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
  if ((await chrome.storage.local.get(key))[key]
      && !confirm("Replace the approved account for " + origin + "?")) return;
  await chrome.storage.local.set({ [key]: entry });
  status.textContent = "Approved " + origin + ".";
  await renderSites();
});

await renderSites();
