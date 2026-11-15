# v1.4.0 Oracle Signal Receiver — Changelog

Base: original unmodified v1.3.7 source archive.

## Application changes

- `src/rules.js`: backwards-compatible `refreshMode: 'builtin'` default and migration.
- `src/background.js`: Oracle-mode state machine, incoming event authentication boundary, persisted dedup and pending queue, signal cycle coordination, pause/stop semantics, 7-day compact attempt history, suppression of scheduled refreshes, original tab ownership preserved. Full application stages remain unchanged.
- `src/signal_rules.js` (new): incoming WSS URL, receiver config, event schema, dedup/queue helpers and cycle-settle rules.
- `src/signal_socket.js` (new): isolated authenticated WSS client with 20-second application heartbeat and bounded reconnection.
- `src/signal_worker.js` (new): dedicated Web Worker for WSS lifecycle.
- `offscreen.js`, `offscreen.html`: add Worker host to the existing audio document; retain existing audible alerts.
- `popup.html`, `popup.js`: Refresh Mode switch, endpoint/receiver ID/credential inputs, save/remove actions and receiver status, pending count and last-signal time.
- `manifest.json`: version 1.4.0 and description; existing permissions retained (including `offscreen` and HTTPS host access).
- `reference/14_oracle_signal_receiver.md` (new): documented broadcast contract, security, storage and cycle behaviour.

## Tests

- `tests/oracle_signal.test.js` (new): schema, security validation, duplicate queues, authenticated transport and cycle settlement.
- `tests/oracle_controller.test.js` (new): starts idle, no searches before signal, one refresh per valid event, ignores replay, queues busy signals, prevents pre-reload clicks, reconsideration on new event, STOP and mode isolation.
- `tools/mock_oracle_broadcast.py` (new): standalone local TLS broadcast fixture.
- `tests/mock_wss_protocol_smoke.py` (new): local network handshake/pong/signal test.
- `tests/security_dom_smoke.py`: update an obsolete strict-dictionary assertion to tolerate the existing v1.3.7 `publicJobSearch` field; **no change to security detection code**.

## Explicitly unchanged

`src/adapter.js`, `src/relay.js`, `src/relay_schema.js`, `src/telemetry.js`, the full click-pattern reference, existing Telegram formatting, FAST/SLOW algorithms, shift ranking/filtering, CAPTCHA/logout detection, the 3-second recovery grace, themes and existing notification API.

## Known limitation

The new WSS listener can be fully connected only when a separate Oracle broadcast service implements the documented protocol. The currently configured HTTPS `/v1/events` Telegram notification endpoint is **not** that service. This ZIP does not contain any live Oracle secrets or a broadcast server.
