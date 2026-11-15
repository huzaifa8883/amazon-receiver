# Part 12 — Telegram manual tests, truthful status, and light-green popup

Applies to v1.3.3 onward.

## Manual test event
- Keep Oracle v2 compatibility: event_type=automation_stopped, data.stage=relay_test.
- data.reason MUST start `TEST ONLY - Telegram connection check` and contain a fresh crypto.randomUUID() test identifier and the actual click's UTC timestamp.
- Include the current extension state and phase in data.reason as a human-readable annotation; this is NOT a genuine stop event and MUST NOT stop the controller.
- Generate a fresh, valid event_id (crypto.randomUUID) on EVERY click. event_id and occurred_at alone do not bypass Oracle fingerprint dedup; the reason changes as well.
- The popup must display Test queued ONLY for relay HTTP 202 with `status=queued`, and display Duplicate for `status=duplicate`. HTTP 202 without a receipt is accepted but not a guarantee of queuing; network/HTTP errors must not claim success.
- Fingerprint dedup stays unchanged for real events.

## Periodic status
- Every 20 minutes while enabled and Chrome runs, send a status message showing actual phase/state. This includes stopped and manual-paused states as well as running states.
- Use new event_type=automation_status, with strict `data={stage, state, detail}`. `state` is running/stopped/paused/completed. The event uses standard event_id and occurred_at.
- Scheduling is via chrome.alarms (20 min repeating), not popup timers or ad-hoc frequent page refreshes. Status checks do not click buttons, navigate pages, or interfere with automation.
- This thirteenth event type requires the separately supplied compatible Oracle relay patch. Old strict v2 rejects it with HTTP 422; on that event, disable the status-only schedule and show instructions in the popup. Normal existing 12 events remain unaffected.
- Status updates are opt-in via the Telegram tab and are initially OFF until the Oracle server patch is installed; saving the existing relay key is not necessary.

## Presentation
- Light-green popup inspired by the user's Auto Refresh Plus screenshot, retaining all original settings and actions in tabs: Overview, Jobs, Shifts, Refresh and Telegram.
- No full-page refresh is added to job search or application logic.
- The relay server's compatibility patch also labels manual relay tests as `TEST ONLY - TELEGRAM CONNECTION CHECK` instead of `AUTOMATION STOPPED`; no live server changes are performed by the extension build.
