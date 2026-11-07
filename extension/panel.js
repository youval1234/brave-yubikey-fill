import { httpsOrigin, SUGGESTIONS } from "./shared.js";
const status = document.getElementById("status");
status.textContent = "Automatic OTP offers are active. On a recognized login page, click Fill code beside the code field.";
const read = document.getElementById("read");
read.textContent = "Refresh key accounts";
read.addEventListener("click", async () => {
  read.disabled = true;
  status.textContent = "Refreshing your key accounts…";
  try {
    const result = await chrome.runtime.sendMessage({ kind: "panel-discover" });
    if (!result?.ok) throw new Error(result?.message || "Could not read the key.");
    await chrome.storage.local.remove(SUGGESTIONS);
    await chrome.storage.session.set({ inventory: { sites: result.preview, expires: Date.now() + 60000 } });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && httpsOrigin(tab.url)) {
      await chrome.tabs.sendMessage(tab.id, { kind: "pairing-updated" }, { frameId: 0 }).catch(() => {});
    }
    status.textContent = "Accounts refreshed. Return to the login page.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    read.disabled = false;
  }
});
