# Regional and grouped-field support — v0.7.4

Matching does not inspect the user's IP, VPN, physical location or page language. A VPN can lead a service to use a different regional login host; that host must still match the provider's exact approved origin. Existing saved pairings remain scoped to their exact origin and particular key. A recognized regional origin with a unique key-account match can offer first-use filling automatically.

## Domain coverage

eBay's marketplace domains cover the US, Canada, UK, Australia, Austria, Belgium, France, Germany, Italy, Netherlands, Spain, Switzerland, Hong Kong, Ireland, Malaysia, Philippines, Poland and Singapore. The map enumerates the root, `www`, `signin` and `accounts` hosts for each domain, including `accounts.ebay.ch`. No suffix wildcard or substring match is used.

Amazon's storefront map covers the US, Canada, Mexico, Brazil, Ireland, Spain, UK, France, Belgium, Netherlands, Germany, Italy, Sweden, South Africa, Poland, Egypt, Turkey, Saudi Arabia, UAE, India, Singapore, Australia and Japan. Only the exact root and `www` hosts are included. Other supported providers keep their reviewed login hosts, which generally use the same origins across regions.

Provider references: [eBay marketplace sites](https://www.developer.ebay.com/develop/guides/sell/using-ebay-restful-apis), [eBay eligible domain list](https://pages.ebay.com/securitycenter/security_researchers_eligible_domains.html), [Amazon marketplace countries](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids), [Amazon Business marketplace URLs](https://docs.business.amazon.com/docs/amazon-business-urls). The exact allowlist is in `extension/matching.js`. A new or changed regional domain may require a map update; arbitrary sites bearing a provider's name are rejected.

## Field handling and security

The detector supports standard OTP autocomplete, recognized field names, existing single-field challenge heuristics and an unambiguous six/eight-box OTP group. Generic groups require one-character boxes and OTP semantics. eBay's `pin-boxes` group is recognized structurally because its individual digit inputs advertise a maximum length of six rather than one. Hovering any member offers the card; the worker and click marker use the group's stable first input as the anchor.

All boxes must be visible, enabled, empty and associated with the same form (or all have no form). Same-origin form actions and submit overrides remain checked. The one-use fill token captures every original input in order. The returned code must have the exact group length. Each digit uses the native input setter and dispatches an input event; all identities, values, current URL, expiry and destinations are checked again before the next digit. A page that replaces a later box or changes its destination stops further filling. A stopped fill may leave the already-entered prefix for the user to clear.

In v0.7.4, form submission remained with the website/user. From v0.7.6, the trusted **Fill & submit** action also requests submission of the same verified form, or sends Enter events to a form-less widget. Sites can also verify automatically in their own input handlers. See [submission safeguards](SUBMISSION-AND-LATENCY.md). Tests use dummy credentials and intercept submissions to prevent live login attempts.

## Validation

The isolated Brave regression includes the observed six-box Swiss eBay structure with German text, hover over the fifth digit, preview eligibility, synthetic-click rejection, six-digit filling, automatic focus movement and refresh recovery. Regional Amazon is exercised with non-English text and standard OTP markup. Unit tests include regional hosts, country-suffix/lookalike rejection, mixed forms, duplicate groups, partial values, eight-digit groups, code-length mismatch, replacement controls and destination changes during input events. The metadata-cache format was versioned so old maps cannot suppress newly supported regional origins after an update.

The user also confirmed that the live Swiss eBay login worked after reloading v0.7.4. No real account labels, codes, session URLs or login screenshots were added to the repository or release assets.

No helper changes or new permissions are required. These additions supplement the v0.7.3 internal security review; they do not constitute independent certification or universal support for every site's custom login controls.
