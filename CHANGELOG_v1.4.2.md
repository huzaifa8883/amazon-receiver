# v1.4.2 — Receiver availability history and local audit queue

Base: untouched `amazon-full-apply-extension-v1.4.1-receiver-compatibility.zip`.

## Modified files

- `src/signal_rules.js`: existing changed-job aliases, optional received job/content/episode identity metadata, future reappearance parser (not enabled in production), eligibility-cycle identity helpers.
- `src/background.js`: receiver-only lifecycle audit points; per-signal-cycle history reset; serial audit outbox; audit and receiver status diagnostics; explicit distinctions between a signal delivered, persisted, clicked, and an application completed.
- `popup.html` and `popup.js`: small local audit-status line alongside existing receiver settings.
- `manifest.json`: version to `1.4.2`, description updated.
- `tests/oracle_controller.test.js`: audit integration regression.

## New files

- `src/receiver_audit.js`: pure, locally durable, bounded, redacted and nonblocking receiver event recorder; future serializer only, no upload transport.
- `tests/receiver_availability_audit.test.js`: 12 new tests including new episodes, duplicates, persistence, overflow, expiry and storage failure.
- `reference/15_receiver_availability_audit.md`: protocol boundaries and Stage 5D requirements.
- `CHANGELOG_v1.4.2.md` and `TEST_REPORT_v1.4.2.md`.

## Intentionally unchanged

`src/adapter.js`, `src/rules.js`, `src/telemetry.js`, `src/relay.js`, `src/relay_schema.js`, `src/signal_socket.js`, `src/signal_worker.js`, `offscreen.js`, normal-mode refresh, existing click and selection order, Telegram messages and CSV schema, 3-second recovery and human-verification protection.

## Limitations

The server's production Stage 3 signal and ACK schemas remain unverified. Future `job_reappeared` events are not live-enabled. Central Oracle 90-day audit upload is NOT configured. Browser service-worker integration requires a real Chrome installation test.
