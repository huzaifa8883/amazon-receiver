# Amazon Full Apply Assistant v1.4.1 — Receiver compatibility and reliability changes

**Baseline:** v1.4.0 Oracle Signal Receiver. Original v1.3.7 backup remains untouched.

## Changed

- `src/signal_socket.js`: corrected the authentication request to the **tested** Oracle Stage 3 shape `{ "type": "authenticate", "receiver_id": "...", "token": "..." }`; removed invented `credential`, `protocol_version` and unsolicited JSON ping requirements. Added bounded backoff, authentication-failure stop, and a separate read-only connection probe. The actual Stage 3 heartbeat and ACK protocols remain to be verified from the server source.
- `src/signal_worker.js`: handles a connection test independently of application signals.
- `offscreen.js`: forwards connection-test results without launching the application engine.
- `src/signal_rules.js`: accepts strictly validated direct `new_job_detected` and `changed_job_detected` fixture events; this is a **provisional assumed delivery format**, not evidence of the actual Oracle Stage 3 envelope.
- `src/background.js`: preconfigures the documented WSS URL, adds connection testing and separate receiver state reporting, prevents unsafe mid-application mode switches, persists a bounded signal journal in `chrome.storage.local`, prevents automatic replay of an interrupted in-flight signal after browser restart, and explicitly clears a successful receiver's active signal at pre-hire. Preserves existing application controller phases, preferences, settings, outbound Telegram payloads, shift ranking and click targets.
- `popup.html`, `popup.js`: displays v1.4.1 and adds **Test connection**, accurate receiver operation state, current stage and job; no redesign of the other sections.
- `tools/mock_oracle_broadcast.py` and `tests/mock_wss_protocol_smoke.py`: updated the local mock to the tested authentication request.
- `tests/oracle_signal.test.js`, `tests/oracle_controller.test.js`: added tests for the auth shape, read-only test connection, local signal queue, safe mode switching and stop-on-prehire Option A.
- `reference/14_oracle_signal_receiver.md`: updated to distinguish the tested authentication contract from the **unverified** production event and ACK contract.

## Unchanged application components (byte-for-byte relative to v1.4.0)

`src/adapter.js`, `src/rules.js`, `src/telemetry.js`, `src/relay.js`, `src/relay_schema.js`, `popup.css` and `offscreen.html`.

## Deployment status

**Development / integration candidate.** Production acknowledgement and delivery envelope cannot yet be certified because the user did not supply the Stage 3 server implementation (`receiver_api.py`, `receiver_store.py`, `serve_receiver.py`). The extension deliberately does **not** emit an invented ACK frame. A test authenticated connection proves only connectivity and credentials, not end-to-end receipt or durable server acknowledgement. No live Oracle or Amazon endpoints were accessed.
