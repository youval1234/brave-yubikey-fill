# v0.7.1 performance checks

Measured on Windows with the installed Brave browser on 2026-11-07. Browser fixtures use dummy accounts and codes. These observations are specific to this machine; they are not memory or latency guarantees.

## Page work

The browser regression fixture changes unrelated page content 60 times, at 20 ms intervals, and moves the pointer across unrelated elements. The v0.7.0 baseline scheduled 59 animation frames during the idle mutation workload. The updated version schedules zero frames and performs zero field scans in the idle workload. Assertions enforce the latter behavior.

The page observer now exists only during a relevant hover. The browser test verifies one observer while the card is open and zero after leaving. It also checks that closing clears the displayed code and stops preview requests. Styles are allocated on the first card display, position properties are written only when changed, and unchanged countdown text is not rewritten.

Hover delay, animation, interactive card transitions, preview expiry refresh, trusted-click fill, field detection after a CSS reveal, same-document login redirects, key reconnection and lookalike rejection remain covered by browser regressions. Unit tests cover private-context isolation, non-persistence of private automatic pairings, permission revocation, field replacement and navigation races.

## Memory

Run `node tests/memory-smoke.mjs` to reproduce the fresh-profile comparison. This reports the complete fixture page's JavaScript heap after garbage collection and the sum of working sets in the isolated Brave process tree. It never measures or modifies the user's personal browser profile. Working-set sums include Chromium overhead and can double-count shared memory. The browser test mocks the native helper, whose separate measurement appears below.

| Measurement | No extension | Extension installed |
| --- | ---: | ---: |
| Idle fixture page JavaScript heap | 784 KiB | 1,018 KiB |
| Idle browser process tree, worker awake | 373.2 MiB | 426.0 MiB |
| Card open, page JavaScript heap | — | 1,116 KiB |
| Card open, worker JavaScript heap | — | 455 KiB |
| Card open, browser process tree | — | 460.5 MiB |
| After card closed and worker suspended | — | 446.5 MiB |

Thus this run added about 234 KiB of idle JavaScript heap to one page, and approximately 53–87 MiB to the browser process-tree working-set sum during the measured states. The worker suspended after its debugger disconnected and 35 seconds elapsed. Chromium retained some memory after closing; the process working set did not immediately return to its initial size. These are whole-browser deltas, not exact extension allocation figures or a measured RAM reduction against v0.7.0.

A separate measurement sampled the registered .NET launcher and its Python descendants every 10 ms during three `discover` requests. Discovery uses an expired challenge and does not generate a current OTP. Their peak summed working sets were 62.0, 61.8 and 61.7 MiB; durations were 13,465, 1,169 and 750 ms. The reason for the slower first request was not established. No account metadata was printed or saved, and the processes exited after each request. The native helper is unchanged in this release.

## Test artifacts

Both browser scripts remove the fresh temporary profiles they create, including on assertion failure. Screenshot output is opt-in. The older generated profiles and four obsolete helper installs identified during this update remain: automatic approval review rejected their removal, including a narrower deletion limited to the verified inactive installs. The active helper registration was preserved.
