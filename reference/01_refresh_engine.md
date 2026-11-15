# Part 1 — Refresh Engine

**Purpose:** Schedule page refreshes on the UK local clock, independent of Amazon-specific click operations.

## Time zone

- Use UK time: `Europe/London`, automatically following GMT/BST.
- Refresh times are aligned with the UK clock, not counted from the last refresh or the time the extension started.

## Release checkpoints

- Default: `00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00`.
- All release checkpoint times must be editable in settings.

## FAST mode

- Default window: **2 minutes before** each checkpoint until **30 minutes after** it.
- Default refresh seconds within every minute of a FAST window: **02, 08, 15, 25, 35, 45**.
- Before/after durations and each refresh second are editable; an empty second means skip it.
- If no FAST seconds are configured, use SLOW mode only.
- FAST overrides SLOW during a FAST window; do not run both schedules together.

Example around a 03:00 checkpoint: FAST window `02:58:00` through (but not including) `03:30:00`, with refreshes at `02:58:02`, `02:58:08` and so forth.

## SLOW mode

- Default: every **2 minutes**, on UK clock minute multiples of 2, at **second 05**.
- Refresh interval (minutes) and second (00–59) are both adjustable.
- For 2 minutes / second 05: `12:00:05`, `12:02:05`, `12:04:05`, ...
- For other minute intervals, anchor the schedule to UK midnight (e.g. 3 minutes at second 12 = `12:00:12`, `12:03:12`, `12:06:12`, ...).

## Starting and waiting

- Pressing **Start** while on the job-search page refreshes immediately, then follows the clock schedule.
- **Manual Refresh** on job search refreshes immediately and starts/continues automation.
- When no eligible job cards remain, **do not do an extra refresh**; wait for the next scheduled FAST/SLOW refresh.
- When an application is in progress, **pause scheduled job-search refreshes**. Ignore the Manual Refresh button until the application ends.
- Changing refresh settings while automation is running takes effect at the **next scheduled refresh**.
- On Chrome restart, do not automatically start automation again.

## Implementation boundaries

- The clock engine schedules reloads; `MutationObserver` does **not** generate clock ticks or survive a full reload.
- After every reload, the page detection engine reinitialises.
- Browser throttling or website/network latency can cause slight delays; no promise of exact-second completion is possible.
