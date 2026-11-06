import { httpsOrigin, hostPattern } from "./shared.js";

const SCRIPT_ID = "yubikey-inline";
let pendingSync = Promise.resolve();

async function sync() {
  const [values, registered] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }),
  ]);
  const patterns = [...new Set(Object.entries(values).flatMap(([key, value]) => {
    const origin = key.startsWith("site:") ? httpsOrigin(key.slice(5)) : null;
    return origin && value?.prompt === true ? [hostPattern(origin)] : [];
  }))].sort();
  const granted = await Promise.all(patterns.map((origin) =>
    chrome.permissions.contains({ origins: [origin] })));
  const matches = patterns.filter((_, index) => granted[index]);
  if (!matches.length) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } else if (registered.length) {
    if (JSON.stringify(registered[0].matches) !== JSON.stringify(matches)) {
      await chrome.scripting.updateContentScripts([{ id: SCRIPT_ID, matches }]);
    }
  } else {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID, matches, js: ["field.js", "prompt.js"], runAt: "document_idle",
      allFrames: false, persistAcrossSessions: true,
    }]);
  }
}

export function syncPrompts() {
  const operation = pendingSync.then(sync);
  pendingSync = operation.catch(() => {});
  return operation;
}
