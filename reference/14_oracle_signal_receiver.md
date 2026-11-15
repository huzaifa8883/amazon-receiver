> **Historical v1.4.1–v1.4.2 note:** the missing broadcast/ACK contract below is resolved in v1.4.3. See `../README_START_v1.4.3.md`.

# Part 14 — Oracle Receiver Mode: v1.4.1 compatibility notes

## Exact details supplied

Incoming receiver WSS endpoint: `wss://145-241-233-33.sslip.io/v1/receivers/ws`.

Separate existing **outbound** Telegram relay: `POST https://145-241-233-33.sslip.io/v1/events`. **Never use the Telegram relay Bearer key for the receiver.**

Five independent identities exist, `receiver-01` through `receiver-05`. Use each computer's existing assigned ID and key; do not regenerate keys or bundle credentials into the extension ZIP.

The server's previously tested authentication request is:

```json
{"type":"authenticate","receiver_id":"receiver-01","token":"ASSIGNED_RECEIVER_KEY"}
```

This ZIP sends exactly that shape (with locally entered credentials) over WSS. It only shows **Connected** after a matching `authenticated` response including the configured `receiver_id`.

## Operating modes

- **Built-in Refresh**: FAST/SLOW schedule and all existing application behaviour, unchanged.
- **Oracle Signal Only**: no automatic search refresh when idle. The existing search controller starts one cycle on an accepted new event, checks available eligible jobs, uses existing shift preferences and click sequence, and returns to AVAILABLE when the cycle is exhausted. Signals while busy are queued. Security screens, logout, manual stop and failed stages retain stop behaviour. The extension does not switch itself to Built-in mode.
- **Option A**: when visible **Schedule pre-hire appointment** is reached, stop application processing, preserve the private Telegram completion notification, disconnect the receiver, and require the user to press Start again. Do not book any appointment automatically.

## Settings and testing

Open Refresh > Oracle Signal Receiver: enter assigned receiver ID and device-specific key, Save receiver connection, then **Test connection**. Test connection authenticates without refreshing or opening any Amazon job. After it passes, choose Oracle mode, Save settings and press Start from an already logged-in Recommended page. The WSS address is preconfigured and editable.

Receiver status shows the authenticated WSS state, the application/receiver stage, the last signal, and queued count. It is **not** a substitute for server-side `/receivers` presence tracking.

A local, bounded journal stores pending incoming events across MV3 worker suspension and browser restart (no key stored in that journal). If an in-flight application was interrupted by a full browser restart, Start requires manual examination and Reset instead of risking an automatic second application. Reset clears the journal and session, not saved preferences or the separate Telegram relay key.

## Production protocol still required

The pasted task specifies the exact authentication request, but **does not supply** actual server-to-client job signal frames, acknowledgement request/response, or heartbeat frames. The illustrative direct messages currently recognised by the extension are `new_job_detected` and `changed_job_detected` with `event_id`, `job_id`, `detected_at` and `detector_id`. These are **local mock assumptions**, not a verified Stage 3 schema.

Do **not** infer that a local mock test proves the live Oracle broadcaster is integrated. To finalise correctly, inspect these existing Oracle files:

```text
/home/ubuntu/amazon-jobs-receiver-stage3/source/receiver_api.py
/home/ubuntu/amazon-jobs-receiver-stage3/source/receiver_store.py
/home/ubuntu/amazon-jobs-receiver-stage3/source/serve_receiver.py
```

Confirm authentication responses, signal envelopes, IDs, acknowledgements, heartbeat, replay semantics and server origin policy. Integrate ACK **only from the actual production contract**. The current build deliberately emits no speculative acknowledgement frames; that is a production blocker for durable signal delivery.

## First controlled pilot

Verify receiver-01 only, through a safe test signal and local job fixture, then test signal dedup, busy queue, return to waiting, stop-on-success, CAPTCHA/logout and outgoing Telegram messages. Do not inject fake listings into the production registry. Keep all other receiver devices in Built-in mode until receiver-01 passes the live protocol and installed Chrome test.
