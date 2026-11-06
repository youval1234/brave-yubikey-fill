// A provider label is only a hint. The user still approves the exact origin.
const knownHosts = new Map([
  ["amazon", ["amazon.com", "www.amazon.com"]],
  ["discord", ["discord.com", "www.discord.com"]],
  ["ebay", ["ebay.com", "www.ebay.com", "signin.ebay.com"]],
  ["etsy", ["etsy.com", "www.etsy.com"]],
  ["github", ["github.com"]],
  ["google", ["accounts.google.com"]],
  ["linkedin", ["linkedin.com", "www.linkedin.com"]],
  ["openai", ["chatgpt.com", "auth.openai.com", "platform.openai.com"]],
  ["paypal", ["paypal.com", "www.paypal.com"]],
  ["roblox", ["roblox.com", "www.roblox.com"]],
]);

export function matchingAccounts(origin, accounts) {
  if (!origin) return [];
  const url = new URL(origin);
  return accounts.flatMap((entry, index) => {
    // The helper formats an issuer and account as "Issuer · Account".
    // An issuer-less entry may have a descriptive suffix such as "Service (work)".
    const issuer = entry.label.split(" · ", 1)[0].trim().toLowerCase();
    const service = issuer.replace(/\s+\([^()]+\)$/u, "");
    const match = issuer === url.origin || (!url.port
      && (issuer === url.hostname || knownHosts.get(service)?.includes(url.hostname)));
    return match ? [index] : [];
  });
}
