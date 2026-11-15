# Full Apply Assistant v1.4.3 — Oracle Receiver Fix

## What was repaired

This complete Chrome Manifest V3 extension is built from the **user-uploaded v1.4.2 availability-audit source**, not from a reconstruction. It fixes the missing Oracle receiver-to-controller delivery bridge and wires the **verified production Stage 3/5E protocol**:

- Auth first over encrypted WSS: `authenticate` containing locally stored `receiver_id` and device token.
- The actual server broadcasts `new_job_detected` / `job_card_changed` with `signal_id` (e.g. `sig-61`), `job_id`, `content_version` and `detected_at`; it does not send the originally assumed `event_id` or `detector_id`.
- Normalize the real `signal_id` into the receiver's existing event-dedup identity, **without inventing the originating detector ID**.
- Offscreen Worker → offscreen document → service worker → *durable local queue result* → Worker → `{"type":"ack","signal_id":"sig-61"}`.
- Oracle `ack_result` is visible in the receiver popup when the server confirms it. A failed/overflowed persistence result is **not acknowledged** and can be retried by Oracle.
- Respond with `{"type":"pong"}` to server pings. Avoid processing duplicate frames while a local write is in flight.
- A newly stored signal triggers the existing Oracle-mode immediate Recommended-page refresh and full job/shift workflow. Further events are queued while an application is active.
- Preserve the working application click order, verified pre-hire stop, job/shift preferences, CAPTCHA/login protections, optional FAST/SLOW mode, existing Telegram Relay integration, local audit, and five separate receiver credentials.
- Update popup version label from stale v1.4.1 to actual v1.4.3.

## Installation — preserve keys and extension identity

1. **Do not replace the Oracle server** with anything in this ZIP. Do not transfer any production key into the ZIP.
2. In the existing Full Apply Assistant v1.4.2 Chrome profile, stop Receiver Mode. Copy the existing unpacked extension folder to a safe backup location.
3. Extract the ZIP, then copy its contents **into that same original unpacked extension folder**, overwriting the existing source files. Preserve the original directory path. Do not remove the extension or create a second copy with Load unpacked.
4. Open `chrome://extensions`, click **Reload** on the existing Full Apply Assistant, and confirm **v1.4.3** appears. The extension ID should stay the same when the unpacked directory remains the same.
5. Open the logged-in Amazon **Recommended** listings page. Check saved preferences and `Refresh → Oracle Signal Only`, `receiver-01`, its assigned key and the existing WSS URL.
6. Run **Test connection**. This only authenticates; it intentionally does **not** start job checking.
7. **Before pressing Start**, review pending Oracle signals: old queued events can trigger job processing immediately once connected. Do not clear cutoffs, credentials, or signal history without a separate decision.
8. When safe, press **Start** to maintain the live WSS connection. A fresh job signal should set PROCESSING, request one immediate refresh, run the existing job/shift checks and return to WAITING/AVAILABLE on no match. On reaching pre-hire, stop the automation and leave appointment booking to the user.
9. In `Refresh → Oracle Signal Receiver`, check **WebSocket ACK: sig-N confirmed by Oracle**. This is *receipt acknowledgement*, not proof of an application.

## Live Oracle read-only ACK diagnostic

Run on Oracle Ubuntu, with no credentials displayed:

```bash
python3 - <<'PYCODE'
import sqlite3
p='/home/ubuntu/.local/state/amazon-jobs-signal-hub/registry.sqlite3'
with sqlite3.connect('file:'+p+'?mode=ro',uri=True) as db:
    for row in db.execute("""SELECT outbox_id,send_attempts,
          sent_at IS NOT NULL,acked_at IS NOT NULL
          FROM receiver_deliveries WHERE receiver_id='receiver-01'
          ORDER BY outbox_id DESC LIMIT 12"""):
        print('Signal:',row[0],'Attempts:',row[1],'Sent:',bool(row[2]),'ACK:',bool(row[3]))
PYCODE
```

**Caution:** With a backlog, the receiver can begin the existing application workflow as soon as it starts. Validate pending signals and that the browser is logged in before enabling live mode. An ACK only confirms local acceptance, not successful shift selection or pre-hire.

## Test boundaries

`npm test` passes the simulated Oracle message, persistence bridge, ACK and ping/pong checks as well as the pre-existing controller/shift regression suite. Synthetic DOM browser fixtures pass. The headless full-Chromium extension test could not see a service worker in this environment, so **live Oracle + Chrome end-to-end operation is NOT verified**. Use one receiver only until you see a new ACK in the real registry. No real Amazon interaction occurred during these tests.

This package is based on the uploaded v1.4.2 ZIP. Any unshared changes in the live installation newer than that source are not included. Keep its backup until comparing those versions.
