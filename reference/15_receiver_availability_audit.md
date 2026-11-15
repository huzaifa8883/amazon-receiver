> **Historical v1.4.1–v1.4.2 note:** the missing broadcast/ACK contract below is resolved in v1.4.3. See `../README_START_v1.4.3.md`.

# 15 — Receiver availability signals and local audit records (v1.4.2)

## Scope and compatibility

This adds RECEIVER-ONLY instrumentation to the working v1.4.1 receiver integration. It does **not** alter `src/adapter.js`, `src/rules.js`, `src/telemetry.js`, `src/relay.js`, normal-mode refresh, job-click order, shift-ranking decisions, Telegram event schema, or CSV formatting.

Oracle remains the decision authority for confirmed job reappearance and meaningful content changes. The extension does **not** infer global disappearance from a single computer's Amazon tab. A validated, previously unseen actionable signal starts a fresh per-signal attempt cycle and allows unsuccessful jobs to be reconsidered. A repeated delivery ID never restarts the same cycle. Existing completed-job exclusion is preserved.

## Production types and future availability episodes

The currently configured local listener accepts direct `new_job_detected` and existing changed-job aliases `changed_job_detected` / `job_card_changed` when the normal Stage 3 envelope validates. This retains the v1.4.1 direct event contract; the precise production envelope must still be checked against Oracle Stage 3 source before deployment.

A signal is identified by a unique `event_id`, with existing required `job_id`, `detector_id` and `detected_at` fields. The optional `job_key`, `content_version`, and `appearance_episode` fields are retained only if Oracle actually supplies valid values. None is inferred, posted or required of today's server. The future `job_reappeared` type is **disabled in production** until the exact Oracle schema is provided. Tests exercise the optional parsing path with an explicitly enabled future flag; this is not a deployed server capability.

Four concepts are distinct:

- **Job identity**: permanent Oracle `job_key` if supplied, otherwise the known `job_id`.
- **Content version**: an Oracle-defined meaningful card version, if supplied.
- **Appearance episode**: a new, server-confirmed availability period, if supplied.
- **Delivery signal**: the unique `event_id` used for duplicate protection.

A new actionable `event_id` can reconsider an old unsuccessful job even when text is unchanged, while `triedKeys` still prevents repeated clicks within the same active signal cycle. An identical redelivery is ignored even after reconnection. Successfully completed jobs remain excluded from automatic reapplication.

## Receiver audit queue

Module: `src/receiver_audit.js`; storage key: `oracleReceiverAuditV1` in `chrome.storage.local` (not sync). Every local record includes:

- `schema_version: 1`, unique local `event_id`, epoch `at` and millisecond-precision UTC `occurred_at`;
- `event_type`, `signal_id`, `receiver_id`, job key, content version and appearance episode where known;
- current state, application phase, job title/location, visit/shift identity, decisions, reasons and counts where available;
- elapsed processing time where measured and explicit `delivery.oracle_acknowledged: false` (there is no verified Stage 3 acknowledgement API in this source).

Instrumented events include receipt, deduplication, queueing, persistence, cycle start/end, connection change, search start, card evaluation/selection, application stage/click, shift visit start/cards/outcome, no-shift outcomes, return to search, recovery/error and manual/success/security stop. Audit events are *actual local observations*; a click accepted by a DOM handler is labelled as such, **not** proof of a successful application. We never fabricate a shift, a server ACK, or a missing event.

Recording schedules a serial asynchronous Chrome local-storage write and does not wait for it before performing a job or shift action. Audit write failures are counted (in memory until the service worker restarts) and do not interrupt application processing. Records are limited to 1,200 entries or approximately 1.5 MB, whichever is smaller; older items are evicted with an explicit cumulative eviction counter. At most 200 queued local write promises are allowed; further events are dropped with a separate visible overload counter rather than permitting unbounded memory growth. Records expire from the local queue after **7 days**, but note that expiration cleanup is opportunistic on subsequent writes; it is not a separate background purge. Secret-like text and email addresses in free-form fields are redacted. Credentials, applicant data, raw passwords and session tokens are not stored.

This seven-day local retention is NOT the proposed **90-day central Oracle retention**. The latter requires a separate future Oracle Stage 5D service and validated upload protocol. `ORACLE_AUDIT_UPLOAD_ENABLED` is deliberately `false`; no upload URL, credentials, alarms or network calls have been implemented. `serializeFutureOracleAuditBatch` provides an offline versioned serializer only. The local outbox should be connected to a production server only after the exact Stage 5D schema, authentication, response semantics and idempotency are tested. Until then it is a bounded diagnostic buffer, not guaranteed 90-day archival.

## Receiver connection and acknowledgement limitation

The previous `src/signal_socket.js` and `offscreen.js` are preserved. The only server handshake known from the provided documents is:

```json
{"type":"authenticate","receiver_id":"receiver-01","token":"<receiver-specific-secret>"}
```

Oracle's `receiver_api.py`, `receiver_store.py`, and `serve_receiver.py` under `/home/ubuntu/amazon-jobs-receiver-stage3/source/` have **not** been provided in this local build. Therefore this release does **not** invent websocket acknowledgement frames, heartbeat requirements, server signal wrappers, or delivery retries. The production signal and ACK protocol is **still to be verified**. Do not treat the local audit event `signal_persisted` as an Oracle ACK or successful job application.

## UI

Refresh > Oracle Signal Receiver retains the connection controls and now displays current local audit record count, overflow evictions, write failures and disabled-upload status. No new sensitive settings or credentials are required.

## Remaining known issue deliberately NOT changed

`src/adapter.js` captures shift cards only within its stage recognition window and `src/background.js` records them within its active `shift` phase. Extremely fast-disappearing shift cards may still evade capture. A separate focused capture fix and regression tests should be made without delaying eligible-shift clicks or destabilising Receiver Mode.

## Future Stage 5D integration checklist

1. Verify Oracle's exact signal envelope, ACK request/response, redelivery, IDs, heartbeat and disconnected-client semantics from its Stage 3 source.
2. Publish the exact Stage 5D HTTPS endpoint, accepted audit record version, receiver authentication, batch size and response/ACK shape.
3. Decide idempotency semantics using unique local audit-event ID and receiver ID; support replay without double counting.
4. Confirm backend retention of 90 days, rate limits and privacy protections.
5. Add a separate, opt-in uploader with tested backoff, partial-batch acknowledgement and bounded storage. Never pause an application for a telemetry upload.
6. First deploy on `receiver-01` with fake local signals, and verify timing/ACK and no duplicate applications before enabling all five clients.
