# Oracle Signal Receiver v1.4.0 — Test Report

Test environment: local Linux container, Node.js 22.x, Python 3.13, Chromium installed. No live Oracle broadcast endpoint, applicant account, or Telegram credentials were used.

## Passed

- **96/96 Node JavaScript tests** (`npm test`), including the original 80 and 16 new tests covering incoming signal validation, secure WSS configuration, auth-before-delivery, duplicate suppression, per-signal job-history reset, safe busy queuing, signal-triggered refresh, stale-page click prevention, Stop and mode isolation.
- **11/11 synthetic Amazon DOM browser fixture tests**, including job-card selection, shift-card parsing, no-shift page navigation, security detection and public-search logout detection.
- **Local WSS TLS protocol test** (`python tests/mock_wss_protocol_smoke.py`): authenticated handshake, one mock detection event, and ping/pong heartbeat.
- JavaScript syntax checks for all app/popup/worker modules; manifest and popup control-ID checks; Python fixture syntax checks.
- Independent code/hash comparison confirms the existing app adapter, selection/ranking, outbound Telegram relay, event schema and telemetry code are unchanged from the original v1.3.7 archive.

## Not verified in this environment

- A real Oracle **broadcast** server was not supplied. The existing HTTPS `/v1/events` Telegram-notification endpoint is outbound only and is not assumed to broadcast signals. Actual production event reception cannot yet be verified.
- Full Chrome extension service-worker smoke test: the available headless Chromium/Playwright harness timed out waiting for the Manifest V3 extension service worker. This is a harness/environment limitation, not a passing test.
- Continuous reception during actual browser idle/sleep, real Amazon navigation, and live Oracle->Telegram delivery have not been tested. Test these with an authorised browser session and the eventual WSS broadcast endpoint before relying on unattended operation.

## Acceptance checklist with your live WSS broadcaster

1. Back up your existing extracted extension and make sure v1.4.0 loads into the **same folder/extension ID**.
2. Confirm Built-in Refresh behaves exactly as before and Oracle signals do nothing in that mode.
3. Save `wss://...` broadcast endpoint, per-device receiver ID and receiver credential; select Oracle Signal Only and save. Start from a manually authenticated Recommended page.
4. Verify status becomes **WAITING FOR ORACLE SIGNAL**, connection becomes **connected**, and no FAST/SLOW alarms refresh the search page.
5. Send one new authenticated `new_job_detected` event. Exactly one search refresh should occur, followed by the usual ranking/selection/application logic.
6. Redeliver the same `event_id`; it must not refresh a second time. Send a new `event_id` referencing the same job; previously rejected jobs may be reconsidered.
7. Send a signal during Step 2/shift selection. The active application must not be interrupted, and the new signal must remain queued.
8. Verify the receiver returns to waiting after checking all available matching jobs without success; no scheduled refresh resumes.
9. Test logout and manual human verification. They must stop all search/app actions and wait for manual Start. Successful pre-hire stage must also stop.
10. Confirm existing Telegram shift reports, CSV files, urgent alerts, and 20-minute status notifications still work. The Oracle WSS receiver must remain separate from the Telegram relay Bearer key.

## Explicitly out of scope

The previously proposed v1.3.8 fast-disappearing-shift-card snapshot fix has **not** been merged. This upgrade deliberately changes only the search trigger and support plumbing to minimise risk to the established application engine.
