# Part 11 — Telegram Relay v2 Integration (v1.3.2)

The Chrome extension submits all 12 supported event types to the user's existing Oracle relay at `https://145-241-233-33.sslip.io/v1/events` without changing Oracle Cloud or Telegram infrastructure. The relay's Pydantic v2 event models were checked against the provided `Amazon_Jobs_Relay_Backup/source/app.py` and are mapped in `src/relay_schema.js`.

## Strict event envelope

`{ "event_id": crypto.randomUUID(), "event_type": "...", "occurred_at": new Date().toISOString(), "data": { ... } }`

For `Send test notification`, emit **only**:

```json
{
  "event_type": "automation_stopped",
  "data": {
    "stage": "relay_test",
    "reason": "TEST ONLY - Telegram connection check"
  }
}
```

The complete request must also contain the generated `event_id` and `occurred_at`. No other `data` keys are accepted. The button sends this test directly, awaits a real HTTP response, and does not stop the Amazon automation.

## Allowed data shapes

- `job_selected`: `job_id`, `title`, `location` (all required).
- `previously_attempted_job_changed`: `job_id`, `newly_added_text` (required), optional `title`.
- `shift_card_detected`: `visit_id`, `card` (required), optional `job_id`.
- `shift_selection_result`: `visit_id`, `decision` (required), optional `shift_id`, `rank`, `reason`. **One decision per card**; do not send a `cards` array for this type.
- `no_shift_cards` and `no_suitable_shifts`: `visit_id` (required), optional `job_id`, `reason`.
- `automation_error`: `stage`, `error` (required), optional `recovery_attempts` (nonnegative integer).
- `account_logged_out` and `human_verification`: `stage` (required), optional `reason`.
- `prehire_appointment`: `job_id` (required), `stage` always `pre_hire_appointment`; optional `title`.
- `automation_stopped`: `stage`, `reason` (required).
- `shift_visit_completed`: `visit_id`, `cards` (required), optional `job_id`, `title`, `selected_shift_id`, `summary`. The relay produces CSV from `cards`.

`ShiftCard` fields: optional `shift_id`; required arrays `dates`, `working_days` and strings `start_time`, `end_time`, `weekly_hours`, `pay`, `location`, `original_shift_card_text`; optional `rank`, `rejection_reason`; `decision` defaults to `unknown` (allowed values: `selected`, `rejected`, `eligible`, `not_selected`, `unavailable`, `unknown`). Up to 150 cards per visit report, subject to 700 KB relay request limit.

Do not spread controller-internal metadata into the event body. Invalid events are rejected locally without transmission, and the popup displays a safe diagnostic. There is no need to update the server's validation models.

## Authentication and delivery

The relay key stays in local extension settings and is sent **only** as an HTTP Authorization Bearer header. Never include Telegram bot credentials or applicant data in event bodies. HTTP 202 means accepted (or duplicate acknowledged by the relay), **not** proof of Telegram delivery. 401/403 mean authorization/origin problems; 413/422 permanent payload errors; 429/503/network errors are retried for queued production events using the same UUID. All production notifications use short-lived durable retry queues and the existing priority scheduling. Direct manual tests provide a real status immediately and may be deduplicated by the relay when repeated within its fingerprint window.

Install in the **same** existing extension directory to preserve the current Chrome extension identity and saved key. After `chrome://extensions` Reload, refresh Amazon pages once to replace content scripts.
