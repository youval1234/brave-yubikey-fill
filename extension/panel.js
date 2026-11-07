import { httpsOrigin, SUGGESTIONS } from "./shared.js";
const status = document.getElementById("status");
const title = document.getElementById("status-title");
const guide = document.getElementById("guide");
const hint = document.getElementById("hint");
const read = document.getElementById("read");
const readLabel = document.getElementById("read-label");
function feedback(heading, message, state) {
  title.textContent = heading;
  status.textContent = message;
  guide.dataset.state = state;
  hint.hidden = true;
}
read.addEventListener("click", async () => {
  read.disabled = true;
  readLabel.textContent = "Refreshing accounts…";
  guide.setAttribute("aria-busy", "true");
  feedback("Reading your key…", "Keep your YubiKey connected while its accounts refresh.", "loading");
  try {
    const result = await chrome.runtime.sendMessage({ kind: "panel-discover" });
    if (!result?.ok) throw new Error(result?.message || "Could not read the key.");
    await chrome.storage.local.remove(SUGGESTIONS);
    await chrome.storage.session.set({ inventory: { sites: result.preview, expires: Date.now() + 60000 } });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && httpsOrigin(tab.url)) {
      await chrome.tabs.sendMessage(tab.id, { kind: "pairing-updated" }, { frameId: 0 }).catch(() => {});
    }
    feedback("You're all set.", "Accounts refreshed. Return to your login page and hover over its code field.", "success");
  } catch (error) {
    feedback("Let's check your key.", error.message, "error");
  } finally {
    guide.setAttribute("aria-busy", "false");
    readLabel.textContent = "Refresh key accounts";
    read.disabled = false;
  }
});
