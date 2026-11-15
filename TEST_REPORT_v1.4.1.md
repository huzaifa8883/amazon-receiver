# Test report — v1.4.1 Receiver compatibility candidate

## Completed

- 105/105 Node.js controller, signal, rules, Telegram and regression tests passed.
- 11/11 Playwright synthetic DOM tests passed, including Poole/Plymouth cards, generic Step 2, security screen, login/logout, shift parsing, return via top-left logo and dynamically inserted cards.
- Local TLS WSS mock handshake passed with `type=authenticate`, `receiver_id` and `token`; direct sample signal received. Self-signed test certificate never used for production.
- Syntax validation of all JavaScript modules and Python fixtures passed.
- Manifest JSON and popup element IDs validated.
- Bytewise comparison with the v1.4.0 ZIP confirms adapter, job/shift ranking, Telegram relay and all outbound event schema modules are unchanged.
- Added targeted regression tests for: one signal -> one refresh; duplicate signal suppression; no clicking while waiting; safe busy queue; persisted inbox; mode switch rejected during an application; read-only connection test; **Option A stop at pre-hire, no automatic restart**.

## Not completed (must not be treated as passed)

- Actual Oracle Stage 3 WebSocket delivery envelope and ACK protocol: server source is not attached; no ACK invented.
- Live authenticated WSS connection, receiving a real Oracle event and server-side delivery confirmation: not exercised.
- Full installed-extension controller browser test: Debian Chromium / Playwright MV3 service worker did not initialise in both headless and Xvfb headed harnesses. The full workflow is **not certified in installed Chrome**.
- Continuous reception during browser suspension/sleep and user login/application on real Amazon: not exercised.
- Existing proposed lossless, short-lived shift card snapshot improvement was **not** merged, per this receiver-only request.

## Before pilot

1. Review exact production server protocol in the three Stage 3 Python files.
2. Implement and validate its exact ACK frame *only after the server source establishes the format*. Persist before acknowledging, then test retry/replay.
3. Verify handshake and live connection with receiver-01 and a real assigned key in Chrome, never copy the key into logs.
4. Confirm genuine signal event validation and processing on a non-application fixture; do not create unwanted real applications.
5. Confirm one no-match cycle -> AVAILABLE; one pre-hire completion -> SUCCESS_STOPPED; human verification and logout -> PAUSED/STOPPED.
6. Verify the original private Telegram relay and CSV reports independently.
7. Only then distribute to receiver-02 through receiver-05 with unique keys.
