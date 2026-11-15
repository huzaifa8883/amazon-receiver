# IMPORTANT — v1.4.3 upgrade

Start with **README_START_v1.4.3.md**. This release includes production Oracle `signal_id`, ACK and ping/pong integration. Any earlier v1.4.1/v1.4.2 reference claiming that acknowledgements are unimplemented describes the historical baseline only.

---

# Amazon Full Apply Assistant v1.4.2 — Receiver audit build

This update retains Normal Mode and the v1.4.1 Oracle Signal Receiver logic while adding receiver-specific availability episode metadata and bounded local audit events. No changes to the Oracle server, existing Telegram relay, actual Amazon application click engine or shift-ranking rules are included. **Oracle Stage 3 production ACK/envelope and future 90-day Stage 5D audit upload remain unverified/disabled.** See `CHANGELOG_v1.4.2.md`, `TEST_REPORT_v1.4.2.md` and `reference/15_receiver_availability_audit.md` for precise details.

# v1.4.1 receiver update

**Compatibility candidate — production Stage 3 signal envelope and acknowledgement not yet verified.**

Read `CHANGELOG_ORACLE_RECEIVER_v1.4.1.md`, `TEST_REPORT_v1.4.1.md` and `reference/14_oracle_signal_receiver.md` first. All existing application steps, job/shift filtering, recovery and private Telegram notifications are preserved.

# v1.3.7 — Stop on lost Recommended / public job-search fallback

**Fix for the 31 October screenshot:** Amazon can return to a general public search screen headed **“18 jobs found”** with **Search jobs**, **Add filter**, **Sort by** and no **Recommended** tab, without rendering an explicit sign-in form. The older login detector only recognised visible sign-in forms/URLs; this could leave the extension in **“Waiting for Recommended detection”** while refreshes continued.

- The content adapter now reports a `publicJobSearch` flag only when the generic public search layout is confirmed: jobs-found count + visible search input + filter controls + missing Recommended tab/heading. A normal logged-in **All** tab, which still offers Recommended, is not classed as signed-out.
- A brief transition is not enough: the public-search layout must remain visible for around **one second** across checks before the controller stops.
- While this state is being confirmed, **do not click or refresh**. A scheduled/manual refresh also checks for the public search layout and stops immediately if visible.
- A confirmed lost Recommended view **stops the automation**, clears pending job refresh/recovery alarms, and sends the existing `account_logged_out` Telegram event plus `automation_stopped`. The alert explains the observed screen rather than asserting that Amazon revealed the session's authentication state.
- The extension does **not** log in, fill credentials, dismiss a security check or automatically resume. Sign in manually, return to Recommended and press **Start**. **Reset** remains available if a prior session cannot be resumed.
- API key, relay server, Telegram configuration, deduplication, shift selection, job ranking and popup themes are unchanged.

This has been tested with offline synthetic browser fixtures representing the screenshot and normal signed-in views, plus controller regression tests. **Not yet verified against a logged-in/live Amazon account**. These screens can change and may require additional selector adjustments.

## Update an existing unpacked extension

1. Stop the previous version. Replace its files with this v1.3.7 package in the **same installed folder**.
2. Open `chrome://extensions`, click **Reload**, and refresh the Amazon tab (`Ctrl+R`) so the old content script is replaced.
3. Check the popup shows **v1.3.7** and confirm your existing preferences and Telegram key.
4. On the signed-out/public jobs-found screen, press **Start**: it should refuse to run. After signing in manually and returning to Recommended, press **Start**.

---

# Update v1.3.3 — Telegram Test Reliability, Status Reports and Green Popup

**Updated from the existing v1.3.2 extension, without removing any job, shift, refresh, reset, security or application-click behaviour.**

- Manual **Send test notification**: new UUID, new timestamp and new `data.reason` test identifier for every click. The test reason includes actual RUNNING/STOPPED state and phase, and begins `TEST ONLY`. It never stops the extension. The popup distinguishes HTTP 202 `queued`, `duplicate`, and an unspecified receipt.
- Light-green tabbed popup (Overview, Jobs, Shifts, Refresh, Telegram), inspired by the user-provided visual reference. The controls and saved settings remain intact.
- Optional Telegram **20-minute status reports** are scheduled by `chrome.alarms`. These report real stage and running/stopped/paused/completed state, including while the popup is closed, provided Chrome and the relay remain available. The schedule does not control the job refresh interval.
- **Important — one small Oracle compatibility patch is necessary for fully truthful Telegram labels.** Your existing Oracle v2 has exactly 12 event types. The separate patch adds the thirteenth `automation_status` event and gives manual tests a `TEST ONLY` heading instead of `AUTOMATION STOPPED`. No change to the server, API key, deduplication, firewall or CORS has been performed here. The manual test works with existing v2 as-is but will still display the legacy heading on Telegram until the optional patch is installed.
- The status schedule starts **disabled** to avoid HTTP 422 against an unpatched server. After your Oracle chat has installed the companion compatibility patch, enable it in **Telegram → Send current extension stage every 20 minutes**. If the old relay replies HTTP 422 anyway, the extension automatically switches off status reporting; all other notifications continue.
- The `automation_stopped` event for a genuine Stop or terminal failure is unchanged. The existing 3-second stuck recovery, security check stop, reset, job-card history, MutationObserver and shift CSV reports are untouched.

**Update:** replace files in your existing unpacked extension folder, reload it in `chrome://extensions`, then refresh the Amazon page with Ctrl+R. Saved settings and the existing relay API key remain in Chrome local storage. Do not share your API key.

**Testing:** see `tests/relay_integration.test.js`, `tests/relay_schema.test.js`, `tests/controller_flow.test.js`. Tests are local; no live authenticated request to Oracle was made.

---

# Amazon Jobs – Full Apply Assistant v1.3.2 (Telegram Relay v2 Schema Fix)

**This update fixes HTTP 422 notification payloads; it does not change your Oracle server, API key, Telegram bot, Amazon job/shift preferences, click sequence, 3-second recovery timer or human-verification handling.**

### What changed

- Added `src/relay_schema.js`, a strict per-event mapper for all 12 Oracle relay v2 types, based on the supplied relay server `app.py` Pydantic models. Unrecognized extra event fields are no longer transmitted. Locally invalid payloads are reported and not sent.
- **Send test notification** now makes an immediate, actual POST with `automation_stopped` and **exactly** `{ "stage": "relay_test", "reason": "TEST ONLY - Telegram connection check" }`; the four-field envelope includes a fresh UUID and ISO timestamp. The popup reports HTTP 202 acceptance or a specific HTTP error instead of confusing a locally queued test with success. Repeated test events may receive HTTP 202 as `duplicate` within the relay's deduplication window.
- Changed `shift_selection_result` from an unsupported array of card decisions to one event per decision, with `visit_id`, `shift_id`, `rank`, `decision`, `reason`.
- Maps internal shift fields to the required `ShiftCard` fields (`dates`, `working_days`, times, weekly hours, pay, location, original visible text, rank, decision, rejection reason) for `shift_card_detected` and `shift_visit_completed`. The Oracle relay remains responsible for generating the CSV attachment.
- Removes extraneous controller fields from `automation_error`, `account_logged_out`, `human_verification`, `prehire_appointment`, `automation_stopped`, `job_selected` and the other event payloads. Invalid events are blocked locally rather than causing repeated HTTP 422 responses. Queued old payloads are sanitized against the new mapper, retaining UUIDs when recoverable.
- Production queue preserves existing 202/401/403/413/422/429/503 and retry semantics. The relay's optional 202 `duplicate` receipt and sanitized error status are shown without exposing secrets.

### Updating without losing your saved relay key

1. Extract this ZIP **over your existing unpacked extension folder**. Do not use a different folder or different extension ID.
2. Open `chrome://extensions` and click **Reload** on Amazon Jobs Full Apply Assistant. Confirm version `1.3.2`.
3. Refresh any already-open Amazon Jobs tabs with `Ctrl+R` to load the latest content script.
4. Open the popup. The saved relay key and enabled setting should still be present. Do **not** create a new key.
5. Click **Send test notification** and check the popup for `HTTP 202`, then confirm Telegram delivery. If you repeat the test soon after the first, the server might acknowledge it as a duplicate rather than send a second message.

**Test scope:** 71 automated Node tests and 10 synthetic Chromium DOM regressions passed, including the strict test payload, every event model shape, relay error handling, job-card detection, shift cards, security checks and logout detection. Twelve generated event examples were also validated by Pydantic against the server model code in the supplied Oracle relay backup. No live authenticated POST or real Amazon end-to-end application was performed here.

---

# Earlier v1.3.0 integration notes (historical)

**Build scope:** Updated v1.2.6 in place. No Oracle Cloud, Telegram bot or relay infrastructure changes. The extension still follows the full application flow and stops at the pre-hire appointment screen. This section describes the original v1.3.0 state. The relay schema was subsequently verified locally using the supplied relay source, as explained above.

## Connect to your existing Oracle Telegram relay

1. Extract this ZIP over the files in the **same unpacked extension directory** that you used before. Open `chrome://extensions` and reload the existing extension. Do **not** install an entirely new directory unless you intend to change the Chrome extension ID and update the Oracle CORS allowlist.
2. Refresh your open Amazon tabs once (`Ctrl+R`) to replace old content scripts.
3. Open the extension popup, expand the **Telegram relay notifications** section, tick **Enable relay notifications**, enter your existing **relay API key** and select **Save relay connection**. The key is saved in Chrome local extension storage, not in source code, not in synced preferences, and never included in Telegram messages. Do not share your Chrome profile. Use **Remove key** to forget it.
4. Select **Send test notification**. The popup will show whether the test was queued and, after a moment, whether the relay returned HTTP 202. Check Telegram for actual delivery; HTTP 202 only means **accepted into the server queue**.
5. Check that Chrome's extension ID is still `bpagjeejadhdiagaamjaobgnppdmihmi`. If it differs, the Oracle relay's CORS allowlist must be changed independently (not by this extension).
6. Start Amazon monitoring with your saved job and shift settings. Relay network failures **must not stop job selection**.

**Relay:** `https://145-241-233-33.sslip.io/v1/events`; `POST` JSON, `Authorization: Bearer <user-configured API key>`, and `Content-Type: application/json`. Host access is included in manifest. The bot token is never stored in the extension.

## Changes included in v1.3.0

- A service-worker relay client with a persistent, bounded, short-lived outbound queue. Every unique event gets a UUID retained on retries. Successful HTTP 202 removes the event locally. Queue contents expire after 24 hours; it is not a seven-day reporting database. The server itself remains responsible for Telegram delivery, its retry queue, and CSV creation.
- Handles 401/403 with a visible credential/CORS warning, 413/422 with a visible non-retryable schema/size warning, and 429/503/network timeouts with backoff/retry scheduling. Notifications are throttled to ~1.25 seconds apart and urgent events receive priority.
- Sends the twelve requested event names: `job_selected`, `previously_attempted_job_changed`, `shift_card_detected`, `shift_selection_result`, `no_shift_cards`, `no_suitable_shifts`, `automation_error`, `account_logged_out`, `human_verification`, `prehire_appointment`, `automation_stopped`, and `shift_visit_completed`.
- Includes complete shift-card information, original card text, decision/rejection reason, and visit UUID in `shift_visit_completed`. No CSV is generated by Chrome; the relay should generate it from this JSON.
- Re-attempts an unsuccessful job if the same visible card gains meaningful extra text (for example, **Part Time**), without looping over unchanged content or mileage changes. Continues to respect the existing disappear-and-reappear rule.
- Recognises an Amazon sign-in screen separately from a human verification challenge. Stops automation, leaves tabs open, and requires manual login and Start.
- Records unexpected stage recovery and exhausted retries as `automation_error`, but treats known no-shift and human-verification screens as normal/special outcomes.
- Improves weekday-range parsing (`Mon–Fri` is five days, not two); preserves the single-pass shift-card parser and the pre-hire stopping point. The DOM adapter shuts down its observer/interval when Chrome reports an invalidated extension context.

## Event envelope

```json
{
  "event_id": "a-stable-random-UUID",
  "event_type": "shift_visit_completed",
  "occurred_at": "2026-10-31T00:00:00.000Z",
  "data": {
    "visit_id": "a-per-visit-UUID",
    "job_id": "job-id-if-known",
    "title": "Warehouse Associate",
    "location": "Bristol",
    "card_count": 2,
    "selected_shift_key": null,
    "cards": [
      {"key":"shift-1", "start_date":"16 Nov 2026", "end_date":"16 Jan 2027",
       "shift_days":"Mon–Fri 07:00–13:30", "working_days":5,
       "start_time":"07:00", "end_time":"13:30", "weekly_hours":30,
       "pay":"£16.10/hr", "location":"BS35 4BR", "original_text":"...",
       "rank":null, "decision":"rejected", "rejection_reasons":["Weekly hours outside 10–15"]}
    ],
    "reason": "No qualifying shift meets configured preferences"
  }
}
```

**Schema verification limitation:** The user's integration message supplied the universal envelope and event names but not the relay's actual Pydantic model definitions or a downloadable OpenAPI specification. The `data` objects in this implementation follow the provided meanings; strict compatibility for *each* event type needs a test against the live relay v2 schema. A 422 response is surfaced in the popup rather than silently assumed to be successful. A successful test event does not, by itself, verify all twelve payload shapes.

**Privacy:** The relay receives job IDs, job/shift information, selected shift decisions, stage names and failure reasons, but never intentionally receives credentials, bot tokens or personally identifying application form data. Sensitive keys are stripped from JSON records before transmission. No screenshots or whole application-page HTML are transmitted.

**Testing:** Node unit/controller tests and synthetic Chromium DOM tests, not a live Amazon apply or authenticated Oracle integration test. Confirm the initial Telegram test before relying on unattended alerts.

---

# v1.2.6 — No-shift screen and no-repeat job selection (27 October 2026)

- **Direct no-shifts screen:** Recognise Amazon's visible **“More shift are on the way!”** page (`/no-available-shift`) even when there is no `Step 2 of 6` progress label or shift-card list. It is a normal no-shifts outcome, not a failed application stage. Follow **Click 7A — Amazon Jobs logo → Click 8A — See all jobs if shown → Recommended**. Never click **Submit your shift preferences**.
- **No-repeat job identities:** After a job has been attempted without a suitable shift, do not select that same job again simply because the page refreshed or the original card is still first. Prefer a real `JOB-UK-...` identifier from the individual card; when Amazon does not expose one, use a consistent card-derived title/location/type/duration identity. A fallback identity may conflate truly identical-looking job cards, pending live DOM validation.
- **Disappearance/reappearance:** Keep attempted-job exclusions across scheduled and manual refreshes. Only remove an exclusion after the job is absent from a **visible, populated, stable Recommended result set for at least 3 seconds**. A skeleton, empty loading state, temporary rerender or application navigation is not evidence of disappearance. Once genuinely absent, the job may be selected **if it reappears**. `Reset` clears the history; full Chrome restart begins stopped with a new session.
- **Performance and protections unchanged:** `MutationObserver` provides prompt detection; the 1-second pulse only backs up observation and confirms stable absence. No extra refresh is triggered simply because all eligible jobs have been attempted. Keep the 3-second stalled-stage recovery, three-attempt limit, manual security/CAPTCHA handling, full Part 8 only, and completion at the visible Schedule pre-hire appointment page without booking.
- **Verification:** 43 Node rule/controller tests, plus synthetic Chromium DOM checks of the no-shifts page and job identity. No live Amazon end-to-end verification; supervise the first run, particularly because this workflow automatically clicks **I Agree** and **Accept Offer**.

# v1.2.5 — Manual verification pause (26 October 2026)

- A visible, active **“Let’s confirm you are human”** screen with **“Complete the security check before continuing”** is recognised even if Amazon shows no CAPTCHA iframe or login form. Existing visible, active CAPTCHA, security and sign-in barriers remain supported. Hidden background CAPTCHA markup is ignored.
- When the controlled search/application tab (or Amazon-created application candidate tab) displays this check, **immediately stop automation**: cancel refresh/watchdog timers, disable further clicks, keep tabs and saved preferences, and use the existing audible alert. The extension **never clicks Begin or attempts the verification**.
- The extension **does not restart automatically** when the challenge disappears. Complete it manually, then press **Start**. Start performs a read-only check; if verification is still visible or cannot be reliably checked, it stays stopped. A resume reuses the tracked tab and scans the existing stage without an automatic immediate reload.
- **Stop** silences alerts; **Reset** clears a paused session while keeping your preferences. Normal stuck-stage recovery remains **3 seconds / up to 3 attempts** and applies only to non-security page failures.
- New tests cover visible human-check detection, invisible CAPTCHA avoidance, blocked automated clicks, pause-on-security before application-tab verification, and explicit manual resume. These are synthetic tests, **not live Amazon verification**.

# Archived notes – Amazon Jobs – Full Apply Assistant (Chrome MV3)

## v1.2.4: Reset stuck session without losing preferences (25 October 2026)

- Added **Reset** to the top of the extension popup. It works whether the controller is running, stopped, or has failed after three retries.
- Reset stops the managed content-script click/clock loop, cancels job refresh, watchdog, shift/return timers and beep alerts, clears transient tab IDs, stage/retry counters, and session diagnostics. It **does not delete** saved keyword lists, shift requirements, release checkpoints, the configured search URL, or other `chrome.storage.local` preferences. It **does not close tabs** or click any application button.
- The popup shows **Ready — press Start**. Open/focus the existing Amazon **Recommended job-search** page and click **Start** to begin a new session; the job search refreshes immediately according to the existing Start specification. Reset does not itself resume, refresh or click jobs.
- Reset does not save unsaved form edits, so save preferences first if you want to keep new edits. Reset can be used even when normal Start cannot validate incomplete shift settings.
- The main controller keeps its 3-second stuck-stage grace and three retry limit. The only supported click pattern remains the Part 8 full application workflow.
- **Verification:** automated controller tests exercise reset while stopped/failed/running, preference persistence, timer/beep cancellation and fresh Start. Amazon live-site automation remains unverified.

## v1.2.3: Top-left Amazon Jobs logo return (25 October 2026)

- **No qualifying shift:** Click the visible **Amazon Jobs logo at the top left** (Click 7A), not the hamburger menu that caused `Expected stage: return_menu` failures.
- After navigation, click **See all jobs** if it is shown; if the logo takes the tab directly to search, continue without the extra click.
- If the logo or next route cannot be verified within the **3-second stalled-stage grace**, resume the extension's original controlled Recommended search tab instead of repeatedly reloading the same application page. Allow longer grace for actual page loading.
- Continue to skip the unsuccessful job until the next scheduled UK-clock refresh. No changes to the keyword boxes, shift rules, consent click pattern, completion stage, or alerts.
- **Validation:** 30 Node tests and five Chromium synthetic-DOM tests passed. The actual Amazon website navigation still requires live verification.

## v1.2.2: Poole job-card selection and safe click recovery (25 October 2026)

- **Recommended recognition:** When Amazon omits usable `aria-selected` attributes or selected pill classes, the adapter can verify the visible **“Recommended jobs for you”** section containing real, currently displayed job cards. It still refuses to choose from an explicitly selected **All** tab.
- **Job card targets:** Try the recognised interactive wrapper/card, then other safe targets belonging to that same card if the first click produces no job-detail navigation. Each retry waits **3 seconds** and only occurs if that same Recommended card is still visible and the tab is not loading.
- **Avoid pointless recoveries:** An inert job card no longer leaves the extension indefinitely in `job_details` while it reloads Recommended three times. After bounded same-card target attempts, skip that card for the current loaded results and continue checking other eligible cards, with the unsuccessful card eligible again at the next scheduled refresh.
- **Visible diagnostics:** The popup now reports the most recent recognised card count, eligible card count and Recommended verification result, making it easier to tell a missing card from a bad click.
- **Poole fixture:** Added a browser-based synthetic test of the exact text layout shown: `Within 0.1 mi | Poole, England`, **Priority** keyword `Poole`, and tab pills without a selected-state attribute. This is **not a live Amazon HTML test**.
- Keeps the **3-second stalled-stage recovery rule**, one-second background checks, `MutationObserver`, saved preferences, Part 8 flow, and the pre-hire appointment stop point.

**Testing for v1.2.2:** 28 Node logic/controller tests and four synthetic Chromium DOM tests passed. The real Amazon website is not accessible in this test environment, so end-to-end application clicks remain unverified.

## v1.2.1: Three-second stuck-stage recovery (25 October 2026)

- Wait **3 seconds**, not 1 second, before considering an unchanged non-loading application stage stuck and attempting its recovery refresh. This uses the existing maximum of three recovery attempts.
- Keep **one-second liveness checks** and **MutationObserver** scans for fast normal progress; they do not refresh the page just because a second has elapsed. Loading/awaiting Amazon-created tabs retain their protective grace periods.
- All previous v1.2 fixes, shift preferences and the full Part 8 click pattern remain unchanged.

## v1.2: Step 2 detection and stuck-stage recovery (25 October 2026)

- **Step 2 progress label fix:** Detect visible `Step 2 of 6` even when Amazon displays it in generic `div` / `span` elements instead of a heading. Hidden labels do not count.
- **Shift card detection:** Detect generic nested shift cards containing their own `Hours:` and `Shift:` fields. Evaluate mandatory hours, working days, and optional ranking as before.
- **No matching shift:** After the visible Step 2 shift list has stabilised (normally about one second after it is recognised), use **Click 7A Amazon Jobs logo → Click 8A See all jobs (if shown)**, with a fallback to the already-controlled Recommended tab, then resume Recommended monitoring while excluding that attempted job until the next scheduled search refresh. An unrecognised/empty list is given additional loading grace rather than being rejected instantly.
- **Recovery:** Monitor the current stage on a **one-second liveness interval** while the relevant tab is open. After a stage stalls, refresh that stage's tab and re-detect it, at most **three reload attempts**. Stop with the existing audible failure alert if none succeeds. Never reload a healthy pending navigation, retry indefinitely, or refresh search on a normal no-matching-job condition. In `await_app`, rescan Amazon-created candidate tabs rather than re-clicking Apply (which could create duplicate tabs).
- **Performance:** `MutationObserver` runs an approximately 45 ms batched DOM scan as changes occur; one-second checks act as a fallback, not as deliberate delays between successful clicks. Chrome tab throttling and network delays can affect actual timing.
- **Progress bar:** The Amazon `Step 2 of 6` progress meter no longer counts as an active loading spinner, which previously delayed shift evaluation.
- **Compatibility:** Only the Part 8 full-application method is supported; existing preferences are preserved. The unused old Part 2 click-pattern reference has been removed from the package.

**Testing:** 26 Node controller/selection/scheduling tests and three isolated Chromium DOM smoke tests pass. The live Amazon DOM/complete navigation flow has not been verified; the optional end-to-end browser fixture cannot initialise the extension service worker in the present test environment. Test supervised in Chrome before unattended use, particularly because the approved flow clicks `I Agree` and `Accept Offer` automatically.


**Version:** 1.2.6 — updated 27 October 2026.  **Status:** working source-code prototype; Amazon DOM selectors and end-to-end live application clicks **have not been verified**.

This Chrome extension combines the approved current specifications. It is intended to start from the **Recommended** view shown in `reference/amazon-recommended-start-screen.png`, monitor and refresh that specific Amazon job-search tab on the UK clock, select matching job cards, follow the **application tab opened by Amazon**, evaluate shifts, and use the agreed full click pattern. It must **stop at the visible “Schedule pre-hire appointment” screen** without booking any appointment. The **only active click pattern is Part 8 — Full Application Click Pattern**. The older Step 2 stopping method and its settings control have been removed.

## Install (Chrome desktop)

1. Extract `amazon-full-apply-extension.zip` to a folder (do not try to install the ZIP itself).
2. Open `chrome://extensions` in Google Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted `amazon-full-apply-extension` folder containing `manifest.json`.
4. Open `https://www.jobsatamazon.co.uk/app#/jobSearch`, sign in manually if required, and select **Recommended**.
5. Click the extension icon, configure both **minimum** and **maximum weekly hours**, then set the working-days setting, keywords and refresh times. Press **Save settings**.
6. Press **Start**. Full application is the only supported click pattern; there is no pattern dropdown. Start refreshes the controlled Recommended page immediately. Leave Chrome running.
7. Use **Stop** at any time to cancel clicks, refreshes and future beeps. It leaves browser tabs open.

### Updating an existing v1.0 unpacked installation

To keep the **same extension ID and previously saved preferences**, unzip the v1.2.6 package and **replace the files inside the existing installed extension folder** (the same directory Chrome previously loaded). In `chrome://extensions`, click **Reload** on that extension. Do **not** remove it and install a separate new folder if you want to preserve its local settings. Existing modes, keyword lists, refresh times and shift rules are migrated automatically, but the old click-pattern and Match in scope fields are discarded.

The popup can close while automation runs. **Manual refresh** immediately reloads the managed search tab and starts/continues monitoring, except while the application flow is in progress.

## Job-card selection

The extension looks at **currently loaded cards on Recommended only**. It does not open All or auto-scroll for extra jobs.

- **Box 1** is always enabled and defaults to Priority. **Box 2** defaults OFF and Required. Both boxes search the **entire visible text of each individual card** (title, type, duration, pay, location, etc.), without a Match in dropdown.
- Required boxes are mandatory; if both are Required, **both requirements must match the same individual job card** (OR within each box, AND between boxes). Priority boxes influence ranking but do not exclude unmatched cards.
- Matching is case-insensitive and partial. Keywords are ordered top-to-bottom, one per line.
- With **no keywords in any active box**, the default selects jobs **strictly under 10 displayed miles**. Blank Maximum miles disables this filter; an active keyword list makes the miles filter irrelevant.
- A job that yields no qualifying shifts (or no shift cards) is excluded from further selection **across refreshes**, until its identity has been absent from settled Recommended results for at least 3 seconds and later reappears. An empty/loading list is not sufficient. When no eligible untried job remains, wait for the next normal scheduled refresh; do not immediately refresh again.

## Refresh times

All schedules follow `Europe/London` (BST/GMT automatically):

- Release checkpoints: `00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00`.
- FAST from **2 minutes before** each checkpoint until **30 minutes after**; default seconds `02, 08, 15, 25, 35, 45` each minute.
- SLOW every **2 minutes** at second `05`, on UK-clock minute multiples. FAST replaces SLOW within a FAST window.
- Refreshes pause during the application stage. Settings saved during a running session activate at its **next scheduled** refresh (rather than changing the application mid-stage).
- Timers and Chrome alarms are best-effort; background-tab throttling, website load times and Chrome scheduling can prevent exact-second results.

## Shift selection

Both **minimum** and **maximum weekly hours** are mandatory for Full mode and are inclusive. A shift with unreadable hours cannot qualify. Set a working-day number from **1–7**, then choose Required (exactly that number) or Priority (prefer that number, fall back to other day counts). Ranking can be OFF (page order among eligible) or ON using higher weekly hours first or ranked shift start-time slots first. Four editable slots are `00:00–05:59`, `06:00–11:59`, `12:00–17:59`, `18:00–23:59`. Unranked or unknown start times do not become mandatory exclusions.

The Amazon-specific DOM adapter has parsers for `Hours: 24 hours/week` and `Hours: 40hrs per week`, plus weekday names and shift start times. These were unit/synthetic-tested; real Amazon selectors have not been validated.

## Full pattern – precise stopping point

| Step | Target | Action |
|---|---|---|
| 1 | Search tab | Select ranked eligible Recommended job card |
| 2 | Search tab | Apply |
| 3 | Verified Amazon-created application tab | Next |
| 4 | Same tab | Start Application |
| 5 | Same tab | Continue **only if popup appears** |
| 6 | Same tab | I Agree automatically |
| – | Visible Step 2 of 6 | Filter/rank shift cards |
| 7 / 8 | Eligible shift | Shift card → Select this job |
| 9 / 10 | Offer | Accept Offer automatically → Next |
| STOP | Visible pre-hire screen | **Stop at “Schedule pre-hire appointment”**; do not select or submit an appointment |
| 7A / 8A | No eligible shift | Amazon Jobs logo (top left) → See all jobs if shown → return to Recommended |

**Full application is the only pattern.** The extension recognises Step 2 of 6 to select a qualifying shift but **does not stop there**; successful completion is only the verified pre-hire appointment screen.

The extension deliberately refuses to bypass a real active CAPTCHA or sign-in/security barrier. Such blocking pages, successful completion, or three failed recoveries trigger an immediate beep and then a beep once a minute for 10 minutes (subject to browser audio policies); Stop cancels them. It will not send a desktop notification.

## Known validation boundary — important

**The new screenshot shows a complete Plymouth job card, but screenshots do not expose the site’s actual HTML or JavaScript handlers.** Browser navigation to Amazon and automated extension integration testing are blocked in this environment. Consequently the job-card selectors, `Apply` action, Amazon Jobs logo target, shift-card click targets, Amazon-created tab association, and pre-hire completion marker have **not been verified on a real signed-in Amazon session**.

The adapter (`src/adapter.js`) detects recognised job-card elements **and** generic card containers using their own visible location/distance label plus card title/details. This was tested on synthetic HTML shaped like both the Plymouth and Poole screenshots, not on the live Amazon DOM. If the real markup differs, it may still fail to recognise or click an item. Do not interpret this package as evidence of an end-to-end verified or guaranteed successful Amazon application. Test the screens and selector assumptions on your own live page, and inspect every step before relying on unattended operation. The user-approved `I Agree` and `Accept Offer` clicks are included; **those can carry real consent or employment consequences**.

### Before enabling on live pages

- Confirm that the **Recommended** selected state and each real job card are recognised, including separate location and displayed miles.
- Confirm the application tab is **opened by Amazon** and linked to the Apply click; the extension must never open a substitute application tab or click an unrelated tab.
- Verify real labels and enabled states for **Apply, Next, Start Application, Continue, I Agree, Select this job, Accept Offer**, the **Amazon Jobs logo**, and **See all jobs**.
- Verify both real shift-card layouts, including hours/week (not hourly pay), distinct working weekdays, and shift start time.
- Verify the **Schedule pre-hire appointment** heading is visible with appointment context; **never click an appointment slot**.
- Check that no available shifts / no matching shift returns through the intended branch, that Stop interrupts immediately, and that genuine blocking security verification stops the workflow.

### Permissions / privacy

The extension requests HTTPS host access broadly (`https://*/*`) because the Amazon-created application tab's actual origin is not yet verified. **It injects reading/clicking logic only into the controlled search tab and application-tab candidates associated with its Apply action**, not arbitrary browsing tabs. Preferences remain in local Chrome extension storage; session state is cleared after Chrome restarts. The source contains no external telemetry or analytics. Once the actual application host is confirmed, `manifest.json` should be narrowed to those origins for a more restrictive release.

### Source map and verification

- `src/rules.js` — pure UK refresh calculations, two-box job filtering/ranking, shift validation and ranking.
- `src/adapter.js` — Amazon-specific DOM observation and guarded clicks (site-dependent).
- `src/background.js` — session controller, alarms, click-flow state, tab association, retries, stop/failure/return, and alerts.
- `popup.html`, `popup.js`, `popup.css` — saved user settings, status, Start / Stop / Manual refresh.
- `offscreen.html`, `offscreen.js` — audio playback while popup is closed.
- `tests/rules.test.js` — **24 passing pure-logic tests** including Plymouth matching, two Required boxes on the same card, and migration from v1.0, run with `npm test` (Node.js).
- `tests/poole_dom_smoke.py` — **passing synthetic Poole Recommended-card DOM test** with unmarked selection pills, same-card click, and explicit All-tab protection.
- `tests/job_card_dom_smoke.py` — **passing synthetic Plymouth Recommended-card DOM test** for generic class names, 0.1-mile distance parsing and clicking the correct card.
- `tests/adapter_dom_smoke.py` — **passing synthetic Step 2 DOM test** of hours/day/time parsing, guarded shift-card click and hidden-CAPTCHA exclusion. Run with Python Playwright and Chromium.
- `tests/controller_flow.test.js` — **4 passing controller flow tests** including inert Poole card target fallback without repeated refreshes, shift return, and the full application stop.
- `tests/browser_smoke.py` — an *optional* intercepted end-to-end fixture test; the current environment **could not launch the installed extension in automated Chromium**, so this test has **not passed here**. Requires a browser/environment that allows unpacked extensions.
- `reference/` — source requirements, original starting screenshot and Plymouth job-card screenshot, included for traceability. The outdated Part 2 click-pattern reference is no longer bundled; Part 8 defines the only active click workflow.

### v1.1 change log (25 October 2026)

- Removed the Click Pattern dropdown and all legacy/Step 2 stop logic. Part 8 Full Application is always active.
- Removed both Match in dropdowns and stored keyword-scope restrictions. Both keyword boxes now search text from the *same complete visible job card*.
- Added a generic-container fallback to detect cards like **Delivery Station Warehouse Associate — Within 0.1 mi | Plymouth, England**; click only recognised visible cards.
- Existing saved box keywords, modes, enabled state, maximum miles, shift settings and UK refresh schedule are migrated without losing them.
- Avoid treating a failed card click as having tried the job; test the new real-site layout after loading the update.

**Not provided:** a Chrome Web Store publication, verified live-site selectors, login/CAPTCHA bypass, job application beyond the agreed stop, appointment booking, or guaranteed exact-second refresh timing.

### v1.2.3 — No-qualifying-shift return fix (25 October 2026)

The user-reported error `Failed after 3 retries: Expected stage: return_menu` occurred on the Step 2 application layout, where a top-left **Amazon Jobs** logo is visible but the earlier ☰ control is not. The return branch now attempts **Click 7A: Amazon Jobs logo**. If that navigation displays **See all jobs**, Click 8A follows; if it leads straight to a Recommended search page, or the logo/See all jobs is unavailable after the 3-second recovery grace, the extension resumes the original controlled search tab. It does **not** refresh the application page three times to look for the missing menu. The unsuccessfully evaluated job remains skipped until the next UK-clock scheduled refresh.

These DOM and controller changes are locally simulated; the live Amazon markup/navigation still require validation. No appointment selection, security bypass, or changes to the configured shift filters are included.


## v1.3.1 — Fast Recommended job-card detection

- Start inspects existing Recommended job cards instead of automatically refreshing the page. Scheduled and manual refreshes still operate as configured.
- `MutationObserver` batches synchronous DOM changes into a zero-delay task, without the previous fixed 45 ms wait. It is still used instead of View Page Source because Amazon renders cards dynamically.
- Job-card anchor discovery prefers direct text-node traversal (to avoid repeated full-page `innerText` layout reads), with the original generic DOM fallback retained.
- Parsed cards are reused until a DOM mutation invalidates their cache, including changes to previously attempted cards. The liveness tick no longer forces a full job-card scan each second.
- Target IDs are reused for guarded clicks if the DOM is unchanged; any mutation forces a fresh verification. Visible login/security checks remain mandatory before every click.
- The popup displays job-card scan duration (milliseconds, when available). This measures local parsing only, **not** click-to-navigation latency.

This is a performance optimisation, not a change to the full application sequence, shift preferences, three-second stuck-stage grace, seven-day history policy, or Telegram relay endpoint. Live Amazon performance must be measured on the user's actual page.

## Version 1.3.4 — eye-friendly themes

- The default popup theme is **Soft Blue & Grey**.
- Open **Settings → Colour theme** to select **Soft Blue & Grey**, **Minimal White**, **Warm Cream**, or **Soft Dark Mode**. The choice is saved automatically in `chrome.storage.local` as `appearanceTheme`, separate from job/shift preferences and relay credentials.
- Appearance changes affect only popup HTML/CSS; the existing controller, notification schema, shift selection and retries are unchanged.
- The Telegram tab explains why old Oracle relay versions can show an **AUTOMATION STOPPED** heading for a manual `TEST ONLY` relay check. A true automation stop is a different event. The existing optional relay status patch is required to label tests and 20-minute running status correctly.

To upgrade, replace the contents of your existing unpacked extension directory, then reload it on `chrome://extensions`. No new API key or server changes are required for the colour update.


## v1.3.5 — Compact automation status bar

The sticky status section above every tab has been reduced in height. It continues to display the full running/paused/stopped stage, next refresh time and mode, last detected/eligible job-card counts, Recommended status, and card-scan time. All four control buttons remain visible and function unchanged. Expand **Reset help** for the full reset instructions. The compact design works across all four saved appearance themes. No automation, refresh, login, shift, relay, or Telegram logic changed.


## v1.3.6 — one clean shift report per visit

- In **normal compact mode**, a shift-selection visit emits **one** `shift_visit_completed` relay event (not separate `shift_card_detected`, per-card `shift_selection_result`, and `no_suitable_shifts` messages). This prevents repeated card information in Telegram and substantially reduces relay traffic.
- The one report contains **every detected shift card**, full original text, extracted fields, rank, decision and rejection reasons. The existing Oracle relay v2 generates an Excel-compatible CSV from this event. The no-shift-card result is represented by an empty `cards` array and a clear summary.
- The report is sent as soon as the visit's outcome is known; the existing shift-list stability check gathers changes first. There is no delay imposed on automatic clicking or on **other** events (job selections, logout, security verification, errors, stopping, status updates, etc.). Telegram's network and rate limiting can still delay delivery.
- All 12 original relay v2 event schemas remain implemented for compatibility. Their old per-card emission path is intentionally disabled in the standard workflow to avoid duplicate notifications.
- The **existing** Oracle relay formats visit reports with a summary message and a separate CSV document. An optional, separately deployable server formatter patch can make that a **single Telegram document with a compact caption**; it is **not required** to fix duplicate card/decision notifications, and neither this extension nor its installer modifies the Oracle VM.
- This update does not change the Amazon click sequence, card ranking, preferences, timing, API key, login/CAPTCHA handling or refresh operation.

---

## v1.4.0 — Optional Oracle Signal Receiver Mode

The existing UK FAST/SLOW mode is still the **default**, preserving all original behaviour. The new `Refresh > Refresh Mode` selector adds **Oracle Signal Only**. In that mode the assistant waits for an authenticated `new_job_detected` event on a separately configured secure WSS broadcast service, refreshes the existing Recommended page once, checks all eligible cards using the existing Full Apply workflow, and returns to waiting when the cycle is exhausted. New event IDs can reconsider previously rejected jobs; duplicate event IDs cannot trigger a second cycle. Busy signals are queued rather than interrupting applications.

**Important:** This does not connect to the existing Telegram relay's HTTP `/v1/events`. Oracle broadcast WSS service must be configured separately by the server operator. No current server address/secret is hardcoded and no live server has been altered. Read `reference/14_oracle_signal_receiver.md` for the exact WSS handshake and security requirements.

**Configuration:** Open the Refresh tab, fill the Oracle WSS endpoint, unique receiver ID and separate receiver credential, click **Save receiver connection**, choose **Oracle Signal Only**, click **Save settings**, then open Amazon Recommended and press **Start**. Your live status changes to `WAITING FOR ORACLE SIGNAL`. Each receiver computer requires a different receiver identity/credential. If you have not yet built the Oracle broadcaster, continue using Built-in Refresh.

**Rollback:** Stop automation, replace the extracted extension's files with the untouched v1.3.7 original ZIP in the **same installed folder**, then reload it in `chrome://extensions` and refresh Amazon. Version 1.4.0's added local keys do not overwrite the original keyword/shift/Telegram settings; the old version will simply ignore them. No Oracle server changes are required.

**Testing:** `npm test` and `python tests/mock_wss_protocol_smoke.py`. Run the synthetic Amazon fixtures in `tests/` separately. For real-world acceptance, confirm Chrome's idle WSS listener and server handshake with a real broadcast endpoint before unattended operation. The outstanding short-lived shift-card snapshot improvement discussed separately has **not** been merged into this focused signal-trigger upgrade.
