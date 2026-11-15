# Part 6 — Settings & Interface

**Purpose:** Provide a simple Chrome-extension popup for configuration, status, buttons, and audible alerts. General UI framework reusable.

## Visible controls

- **Start**, **Stop**, and **Manual Refresh** buttons.
- **Live status:** Stopped; Running—FAST; Running—SLOW; Checking Cards; Applying (show stage); Completed; Failed after 3 retries.
- Reopening the popup shows the current status; closing the popup does not stop automation.

## Refresh settings (editable)

- UK release checkpoints (defaults `00:00`, `03:00`, `06:00`, `09:00`, `12:00`, `15:00`, `18:00`, `21:00`).
- FAST minutes before checkpoint: **2** by default.
- FAST minutes after checkpoint: **30** by default.
- FAST refresh seconds: **02, 08, 15, 25, 35, 45** by default; entries individually editable/removable.
- SLOW interval: **2 minutes** by default.
- SLOW refresh second: **05** by default, adjustable `00` through `59`.

## Location selection settings

- One sortable / ordered keyword list (examples: Peterborough, Tilbury, Bow).
- One mode selector for the complete list: **Required** or **Priority**.
- Keyword matching is partial and case-insensitive.
- No postcode is needed; distance comes from the job cards.
- **Empty keyword list:** select the nearest job regardless of Required/Priority mode, subject to the Maximum miles setting below. (v1.0.2)
- **Maximum miles (v1.0.3):** editable numerical setting, default **`10`**. The rule is **strictly below the entered limit** (`< 10` miles by default, not `<= 10`).
- Apply Maximum miles **only when the keyword list is empty**. With an active limit, skip jobs lacking readable mileage. When one or more keywords exist, **ignore the limit completely**, including Priority-mode nearest fallback.
- Allow the Maximum miles field to be **left blank** to disable the limit. Clearly label its scope: **“Only applies when no keywords are entered.”**
- Persist the Maximum miles setting alongside all other settings.

## URL settings

- Editable job-search URL, default:
  `https://www.jobsatamazon.co.uk/app#/jobSearch`
- Save changes and use the saved URL for reopening the controlled search tab if it closes during a running session.

## Save and timing of settings

- Automatically persist preferences through Chrome close/restart.
- Settings changed while running become effective on the **next scheduled refresh**.
- Reopening Chrome does not automatically restart automation.

## Beep sound

- Success: beep immediately, then **once every minute for 10 minutes**.
- Failure after 3 retries: use the same alert schedule.
- Login/CAPTCHA/security block: use the same alert schedule.
- Pressing **Stop** silences current audio and cancels remaining beeps.
- **No Chrome desktop notifications**; sound only.

## Notes for source-code phase

- Reliable alerts while the popup is closed may require an extension background/offscreen audio approach, rather than audio owned only by the popup.
- Accessibility: clear labels and easy-to-understand status wording.
