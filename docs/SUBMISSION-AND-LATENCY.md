# Submission and latency — v0.7.6

## One click to fill and submit

The explicit **Fill & submit** click generates/fills the selected code and then authorizes one submission attempt. The worker checks the original document, URL, active/focused context, permissions and account approval again after filling. It sends the same one-use marker to the original document only.

The page-side token records the original input nodes, expected values and form. It expires after 1.5 seconds if unused. A bounded wait of at most 50 ms lets input handlers and rendering updates settle. Before submission, visibility, focus, code expiry, identities and values are rechecked. The form's exact destination, method, target, default submitter and submitter overrides must still match the pre-fill snapshot. Named controls cannot shadow the native form method. Disabled/hidden submitters and changed/replaced controls prevent the attempt.

Standard forms use native `requestSubmit`, preserving browser validation and submit handlers. A temporary listener observes the original form so an input handler's automatic submission is not repeated. Form-less widgets receive an Enter keydown/keyup sequence on the last filled input, after focusing it and revalidating the field. There is no OS-wide keypress, extra native-helper command or debugger permission.

Synthetic keyboard events do not have a browser default submission action and cannot impersonate trusted hardware input. Custom widgets that reject them, or forms that become unsafe/disabled, may still require manual submission. The extension does not interpret a request as proof that login succeeded. It cannot reliably detect every site's private JavaScript/XHR verification routine; disabled controls, navigation and observed form submissions are honored to avoid an extra attempt.

The input values are already available to the receiving page after filling. The short-lived submission record stays in memory, is consumed once and is not logged or persisted. This supplements the existing internal review; it is not an independent security certification.

## Faster offers without polling

- Hover dwell is 120 ms, down from 280 ms; the existing entry animation and reduced-motion behavior remain.
- Account metadata discovery starts during that dwell instead of afterward. Current-code previews still require the offer, hover and foreground checks.
- Moving among digit boxes preserves one group timer rather than restarting the dwell for each box.
- The content script starts at `document_end` instead of `document_idle`, so slow trailing page resources do not postpone listener registration.
- Metadata remains cached for up to one minute. No USB watcher, background discovery loop, persistent native process or longer-lived OTP cache was added.

## Measurements and regression coverage

A comparative isolated Brave run used the committed v0.7.5 extension and the new version with the same dummy metadata, fixture pages and 75 ms test polling interval. Cached Swiss eBay offer latency was 315 ms versus 160 ms. With a simulated 500 ms cold metadata request while the pointer moved across six boxes, offer latency was 1,138 ms versus 528 ms. These are illustrative local fixture measurements, not hardware/website latency guarantees. Real key discovery still depends on USB, the local SDK and hardware policy.

The test asserts one discovery request for the moving-pointer scenario and that discovery overlaps the hover interval. Idle DOM/pointer activity still schedules zero extension animation frames and performs zero field scans. Browser regressions cover a standard form, an input-driven automatic verification, a form-less Enter handler, safe filling, preview expiry, CSS reveal, login redirects and key reconnection. Forms are intercepted and credentials are dummy values.

Additional unit tests cover one-use submission, duplicate prevention, named-control clobbering, changes to URL/destination/submitter/node/value/form/focus, disabled submitters, and worker permission/pairing revocation between filling and submission.
