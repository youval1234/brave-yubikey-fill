// Issuers are hints; match exact reviewed hosts, never a brand substring or
// an arbitrary country suffix. No location or IP lookup is needed.
const regionalHosts = (domains, prefixes) => domains.flatMap(domain => prefixes.map(prefix => prefix + domain));
// Official marketplace/domain references are recorded in docs/REGIONAL-SUPPORT.md.
const ebayDomains = [
  "ebay.com", "ebay.ca", "ebay.co.uk", "ebay.com.au", "ebay.at", "ebay.be",
  "ebay.fr", "ebay.de", "ebay.it", "ebay.nl", "ebay.es", "ebay.ch",
  "ebay.com.hk", "ebay.ie", "ebay.com.my", "ebay.ph", "ebay.pl", "ebay.com.sg",
];
const amazonDomains = [
  "amazon.com", "amazon.ca", "amazon.com.mx", "amazon.com.br", "amazon.ie",
  "amazon.es", "amazon.co.uk", "amazon.fr", "amazon.com.be", "amazon.nl",
  "amazon.de", "amazon.it", "amazon.se", "amazon.co.za", "amazon.pl",
  "amazon.eg", "amazon.com.tr", "amazon.sa", "amazon.ae", "amazon.in",
  "amazon.sg", "amazon.com.au", "amazon.co.jp",
];
const knownHosts = new Map([
  ["amazon", regionalHosts(amazonDomains, ["", "www."])],
  ["discord", ["discord.com", "www.discord.com"]],
  ["electronic arts", ["www.ea.com", "accounts.ea.com", "signin.ea.com"]],
  ["ebay", regionalHosts(ebayDomains, ["", "www.", "signin.", "accounts."])],
  ["etsy", ["etsy.com", "www.etsy.com"]],
  ["epic games", ["www.epicgames.com", "accounts.epicgames.com"]],
  ["github", ["github.com"]],
  ["google", ["accounts.google.com"]],
  ["hp", ["account.hp.com"]],
  ["linkedin", ["linkedin.com", "www.linkedin.com"]],
  ["nvidia", ["www.nvidia.com", "login.nvgs.nvidia.com", "profile.nvgs.nvidia.com"]],
  ["openai", ["chatgpt.com", "auth.openai.com", "platform.openai.com"]],
  ["paypal", ["paypal.com", "www.paypal.com"]],
  ["razer", ["www.razer.com", "razerid.razer.com"]],
  ["roblox", ["roblox.com", "www.roblox.com"]],
  ["rockstar games", ["www.rockstargames.com", "signin.rockstargames.com", "socialclub.rockstargames.com"]],
  ["samsung account", ["account.samsung.com"]],
  ["surfshark", ["my.surfshark.com"]],
]);

function accountOrigins(entry) {
  // The helper formats an issuer and account as "Issuer · Account".
  const issuer = entry.label.split(" · ", 1)[0].trim().toLowerCase();
  const service = issuer.replace(/\s+\([^()]+\)$/u, "");
  const hosts = knownHosts.get(service);
  if (hosts) return hosts.map((host) => "https://" + host);

  // A custom issuer may explicitly name its exact host or HTTPS origin.
  const value = issuer.startsWith("https://") ? issuer : "https://" + issuer;
  try {
    const url = new URL(value);
    if (url.hostname.includes(".") && value === url.origin) return [url.origin];
  } catch {
    // The issuer is a service label with no known hostname.
  }
  return [];
}

export function matchingAccounts(origin, accounts) {
  return accounts.flatMap((entry, index) => accountOrigins(entry).includes(origin) ? [index] : []);
}

export function suggestionsForAccounts(accounts) {
  const suggestions = {};
  for (const entry of accounts) {
    for (const origin of accountOrigins(entry)) {
      (suggestions[origin] ??= []).push(entry);
    }
  }
  return suggestions;
}
