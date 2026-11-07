const RELEASES = "https://github.com/youval1234/brave-yubikey-fill/releases/tag/";

function versionParts(value) {
  if (typeof value !== "string" || !/^\d{1,5}(?:\.\d{1,5}){2,3}$/.test(value)) return null;
  const parts = value.split(".");
  if (parts.some(part => Number(part) > 65535 || (part.length > 1 && part.startsWith("0")))) return null;
  return [...parts.map(Number), ...Array(4 - parts.length).fill(0)];
}

export function releaseDetails(reply, installed) {
  const latest = versionParts(reply?.version), current = versionParts(installed);
  if (reply?.ok !== true || !latest || !current
      || ![RELEASES + reply.version, RELEASES + "v" + reply.version].includes(reply.releaseUrl)) return null;
  let newer = false;
  for (let index = 0; index < 4; index++) {
    if (latest[index] !== current[index]) { newer = latest[index] > current[index]; break; }
  }
  return { newer, version: reply.version, url: reply.releaseUrl };
}
