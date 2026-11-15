# v1.4.3 — Production Oracle Receiver Protocol

Updated from user-supplied v1.4.2 availability-audit source.

- `src/signal_rules.js`: verified `signal_id`-based Stage 3 broadcast normalization and strict validation; legacy direct-event tests remain supported.
- `src/signal_socket.js`: production `ping`/`pong`, ACK only after successful durable controller result, retry without ACK on failure, ACK result status and coalescing in-flight duplicates.
- `src/signal_worker.js` & `offscreen.js`: asynchronous request/response bridge ensuring local Chrome persistence completes before sending Oracle ACK.
- `src/background.js`: request a prompt job-refresh cycle without withholding persisted signal receipt, and expose server-confirmed ACK state.
- `popup.js`, `popup.html`, `manifest.json`: ACK visibility and consistent version v1.4.3.
- Regression coverage: live protocol samples and bridge tests, unchanged application logic and Telegram Relay. No Oracle server files or secrets included.

Unmodified modules: `src/adapter.js`, `src/rules.js`, `src/relay.js`, `src/relay_schema.js`, `src/telemetry.js`, `src/receiver_audit.js`.
