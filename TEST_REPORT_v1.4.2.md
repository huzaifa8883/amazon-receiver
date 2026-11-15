# Test report — Amazon Full Apply Assistant v1.4.2

## Local automated tests

- `npm test`: **118/118 passed** (Node.js), including 12 new receiver identity/audit cases and the existing v1.4.1 regression suite.
- Receiver-specific cases: valid actionable event aliases, guarded future reappearance event, new Oracle episode with unchanged text, changed content version, duplicate `event_id`, successful-job exclusion, millisecond UTC timestamps, secret sanitisation, crash/restart queue persistence, concurrent records, bounds/overflow/backpressure, seven-day expiry, simulated storage-write failure and no audit HTTP transport.
- The existing mock WebSocket TLS handshake test passed (local fake service only).
- The following synthetic browser-page tests passed: adapter DOM, fast job-card detection, Plymouth card, job identity, no-shift page, Poole card, public-search logout, Telegram-related adapter parsing, return-logo, security checks and Step-2 regression.
- **Full browser-extension harness not passed:** `tests/browser_smoke.py` timed out waiting for Chromium's Manifest V3 `serviceworker` event (15 seconds). No claims about live Amazon application or Oracle Stage 3 delivery/ACK are made.

## Scope and caveats

The synthetic DOM fixtures do not establish the correctness of Amazon's changing production HTML. The current Stage 3 acknowledgement and signal-envelope schema were not supplied, so exact Oracle integration and 90-day backend audit uploads are not verified. The immediate short-lived-shift-card capture improvement remains a separate known issue, as explicitly required by the source brief.

## Suggested controlled verification

Install into the SAME unpacked extension directory (to preserve extension ID), confirm the existing settings, use **Receiver connection Test** against the existing Oracle service, and pilot **one authorised receiver**. Verify AVAILABLE -> one signal -> one job-evaluation cycle -> AVAILABLE on no match. Test an actual pre-hire stop only under authorised circumstances and do not automatically book an appointment. Inspect the popup's local Audit count and eviction metrics. Do not switch all five receivers until the exact Stage 3 signalling and ACK contract has been confirmed.
