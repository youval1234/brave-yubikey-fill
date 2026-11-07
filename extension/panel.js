import { httpsOrigin, SUGGESTIONS } from "./shared.js";
import { releaseDetails } from "./updates.js";
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

const installed = chrome.runtime.getManifest().version;
document.getElementById("installed-version").textContent = "v" + installed;
const updateButton = document.getElementById("check-updates");
const updateStatus = document.getElementById("update-status");
const releaseLink = document.getElementById("release-link");
updateButton.addEventListener("click", async () => {
  updateButton.disabled = true;
  updateButton.textContent = "Checking…";
  updateStatus.hidden = false;
  updateStatus.textContent = "Checking the private GitHub repository…";
  releaseLink.hidden = true;
  releaseLink.href = "https://github.com/youval1234/brave-yubikey-fill/releases/latest";
  try {
    const reply = await chrome.runtime.sendMessage({ kind: "panel-update-check" });
    const release = releaseDetails(reply, installed);
    if (!release) throw new Error("Could not check here. Update the Windows helper and check GitHub CLI sign-in, or view releases on GitHub.");
    updateStatus.textContent = release.newer
      ? "Version " + release.version + " is available. Download it from the release page, then reload the extension."
      : "You're up to date. Installed: v" + installed + ".";
    releaseLink.href = release.url;
    releaseLink.hidden = !release.newer;
  } catch {
    updateStatus.textContent = "Could not check here. Update the Windows helper and check GitHub CLI sign-in, or view releases on GitHub.";
    releaseLink.hidden = false;
  } finally {
    updateButton.disabled = false;
    updateButton.textContent = "Check for updates";
  }
});
