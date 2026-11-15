> **v1.2.3 site-layout update (25 October 2026):** The no-qualifying-shift Click 7A is now the **visible top-left Amazon Jobs logo** (instead of the older ☰ menu). After clicking it, select **See all jobs** only if that navigation provides it; otherwise return to the already-controlled Recommended search tab. Wait three seconds before recovery if the expected navigation cannot be verified. The original v1.0 pattern remains below for historical context.

# Part 8 — Full Application Click Pattern

**Status:** User-approved workflow specification (v1.0)  
**Pattern name:** **Full Application Click Pattern**  
**Pattern ID:** `amazon_full_application_click_pattern_v1`  
**Purpose:** Describe the Amazon-specific **clicks, page/tab transitions, branches, and stopping point** from a selected Recommended job card through arrival at the **Schedule pre-hire appointment** screen.

## 1. Coexistence with the earlier click pattern

This is a **new, separate click pattern**, not a replacement for Part 2 (`02_location_selection_click_operations.md`).

- **Existing pattern (Part 2):** Stops at the verified, visible **`Step 2 of 6`** application screen.
- **New Full Application Click Pattern (this file):** Continues **past `Step 2 of 6`** to choose an eligible work shift, complete the specified offer clicks, and stop at **Schedule pre-hire appointment**.
- Only **one** click pattern should control a given automation session. The active pattern's completion rule takes precedence: reaching `Step 2 of 6` is **not** completion in this new pattern.
- Part 3 selects/ranks **job cards**; Part 7 selects/ranks **shift cards**. This file performs neither type of ranking, and it does not set refresh times.
- Integration must make the Part 4/Part 5 stage recognition and stop behavior **pattern-aware** without changing the existing pattern's behavior.

## 2. Numbering convention

The click numbers below are **fixed action labels**, not a count of how many physical clicks have already happened:

- **Click 5** is optional. If the Continue popup is absent, **skip Click 5**, then proceed to **Click 6**. Do not renumber subsequent actions at runtime.
- **Click 7** and **Click 7A** are mutually exclusive branches after shift evaluation; similarly **Click 8** and **Click 8A**.
- **Shift evaluation itself is not a click.** There is no missing Click 7 prior to clicking a shift card or the menu.

## 3. Shared opening sequence

| Action | Controlled tab | Expected stage and click | What follows |
|---|---|---|---|
| **Click 1** | Original, controlled Amazon **Recommended** job-search tab | Click the **eligible job card** selected by **Part 3** | Job-detail page on the **same tab** |
| **Click 2** | Same job-search tab | Click **Apply** on the job-detail page | Amazon opens its own **new application tab** |
| **Click 3** | Verified Amazon-created application tab | Click **Next** | Next application page in that **same application tab** |
| **Click 4** | Same application tab | Click **Start Application** | Continue with the application flow |
| **Click 5 — optional** | Same application tab | If an active **Continue** popup appears, click **Continue**; otherwise skip | Continue to the applicable next page |
| **Click 6** | Same application tab | Click **I Agree** | Wait for the **visible `Step 2 of 6` shift-selection screen** |

**Explicit consent choice:** For this pattern, the user has approved **automatic clicking of `I Agree` and `Accept Offer`**. No extra manual confirmation step is part of the agreed pattern.

### Job-card fallback before Apply

If the selected card displays **“The job you selected doesn't have available shifts. Please choose another job below.”**, request the **next eligible card** in Part 3's ranked order, as in Part 2. If all eligible cards are exhausted, stay on Recommended and wait for the next scheduled clock refresh. Do **not** misclassify this availability message as a broken-page retry.

### Application-tab handling

- After Click 2, **follow the tab opened by Amazon for that Apply action**. Do not open an extra tab yourself.
- Verify the new tab using tab/opener/navigation association and actual application content or URL; ignore unrelated tabs.
- Track the same application tab across full navigation, in-page routing, and page reloads. Do not assume the active browser tab is the correct one.
- Pause job-search refreshes while progressing through the application. Keep the original controlled search tab identifiable for a possible return.

## 4. Shift-selection decision (no click)

After Click 6, detect the currently active, visible **`Step 2 of 6`** screen on the verified application tab and read its shift cards.

1. Ask the **Part 7 — Shift Selection Configuration** module to filter and rank currently available shift cards.
2. Part 7 determines eligibility from mandatory weekly-hours range, Required/Priority working-day count, optional ranking, and its supported card layouts.
3. **If Part 7 returns a qualifying shift**, take **Branch S — Select Shift** below.
4. **If Part 7 returns no qualifying shift**, take **Branch R — Return to Job Search** below.
5. Do not click a nonqualifying shift or invent missing hours/days/start times. Re-read cards that are still loading according to the detection engine before deciding they are absent.

## 5. Branch S — Qualifying shift found

| Action | Controlled tab | Expected stage and click | What follows |
|---|---|---|---|
| **Click 7** | Same application tab | Click the **specific qualifying shift card** returned by Part 7 | The corresponding detailed shift/job view opens |
| **Click 8** | Same application tab | Click **Select this job** | Offer/confirmation page |
| **Click 9** | Same application tab | Click **Accept Offer** **automatically** | Following application page |
| **Click 10** | Same application tab | Click **Next** | Pre-hire appointment stage |
| **STOP — no click** | Same verified application tab | Positively detect the visible **Schedule pre-hire appointment** screen | End automation successfully; no further page interaction |

**Completion marker for this pattern:** The tracked application tab visibly displays **`Schedule pre-hire appointment`**, including the pre-hire appointment date/time selection context, **after** Click 10. Merely finding those words in hidden markup, another tab, a background template, or an unrelated page is not success.

On success:

- **Stop all automated clicks and scheduled refreshes**, retain existing tabs, update status to Completed, and invoke the existing success beep sequence defined in Part 6.
- **Do not choose an appointment date or time; do not confirm or submit an appointment.**
- **Do not continue past this screen.**

## 6. Branch R — No qualifying shift

| Action | Controlled tab | Expected stage and click | What follows |
|---|---|---|---|
| **Click 7A** | Same application tab | Click the **Amazon Jobs header/menu icon with three horizontal lines (☰)**, shown at top left in the reference image | Navigation to the **Interested in applying?** / job-browsing route |
| **Click 8A** | Same tab as Click 7A | Click **See all jobs** | Return to the Amazon job-search experience |
| **RETURN — no click number** | Controlled job-search context | Re-establish the active **Recommended** view and resume the existing job-search/ranking/refresh process | Search for the next eligible job card |

Rules for return:

- **Do not** click **Select this job**, **Accept Offer**, or **Next** when Part 7 finds no qualifying shift.
- **Do not** treat return to search as a successful completion.
- On return, re-establish the controlled search tab without multiplying tabs or losing the tracked session. If the website's return navigation uses the application tab rather than the original search tab, reconcile ownership before any clicks or refreshes; ignore unrelated Amazon tabs.
- Apply Part 3 to the currently visible **Recommended** job cards; do not use the All tab for selection. If the site lands on All, switch back to Recommended using the existing App Behaviour rule.
- Do not immediately reselect the same unsuccessful job from the unchanged loaded set of job cards. It may become eligible for retry after the next **scheduled** refresh; keep the existing FAST/SLOW timing rules rather than forcing an unscheduled reload.

## 7. Click-flow map

```text
Recommended job search
    |
    | Click 1 — chosen eligible job card (Part 3)
    v
Job details — Click 2: Apply
    |
    | Amazon creates the application tab; track/verify it
    v
Application tab — Click 3: Next
    v
Click 4: Start Application
    v
Click 5: Continue (ONLY if the popup appears)
    v
Click 6: I Agree (automatic)
    v
Visible Step 2 of 6 — evaluate shift cards (Part 7; NO CLICK)
    |
    +-- Qualifying shift ---------------------- No qualifying shift --+
    |                                                             |
    | Click 7: matching shift card                                  | Click 7A: ☰ menu
    v                                                             v
Click 8: Select this job                                  Click 8A: See all jobs
    |                                                             |
    v                                                             v
Click 9: Accept Offer (automatic)                          Return to Recommended
    |                                                             |
    v                                                             v
Click 10: Next                                             Resume clock-based search
    |
    v
Visible Schedule pre-hire appointment
    |
    +-- SUCCESS: STOP + existing beep pattern; no appointment selection
```

## 8. Execution safety, detection, and recovery

- Every click requires positively recognizing the **current page/stage** and the **correct visible, enabled target**. Do not click based on matching text in hidden, inactive, unrelated, or templated page elements.
- Observe relevant page mutations without duplicate clicks. After any navigation or reload, re-detect the stage before deciding what action is next.
- If an expected button/page fails to appear, use Part 4's **wait 3 seconds → refresh the current stage → re-detect → up to 3 failed recovery attempts** rule. No-shift job-card fallback and no-qualifying-shift return are **normal branches**, not these errors.
- A confirmed active blocking login, CAPTCHA, or security challenge must stop the automation and use the existing alert flow. Never bypass checks. Do not stop on hidden/inactive security-related text alone.
- Pressing **Stop**, a confirmed fatal failure, or reaching this pattern's successful completion cancels further automated clicks. No unattended extra form filling, appointment scheduling, or additional submissions.
- Browser/network throttling can affect detection and response times; do not promise exact-second clicking.

## 9. Ownership and implementation boundary

| Concern | Owner |
|---|---|
| UK clock scheduling and refresh | **Part 1** |
| Earlier stop-at-Step-2 click pattern | **Part 2** (remains unchanged) |
| Job-card location eligibility and ranking | **Part 3** |
| Running/stopped state, tabs, retries | **Part 4** |
| DOM changes, stage/visible-target detection | **Part 5**, with Amazon-specific detection |
| Status, preferences, success/failure beeps | **Part 6** |
| Shift hours/days/start-time eligibility and ranking | **Part 7** |
| **New post-Apply clicks, eligible-shift/return branches, pre-hire stop condition** | **This Part 8** |

**Implementation note:** Button captions and screenshots document the **intended actions**, not validated DOM selectors. Confirm the actual selectors, menu routing, URLs, active-tab identity, and visible completion markers on the live Amazon site before implementing website automation. This file is a **workflow source/specification**, not an executable clicking script.

## 10. Reference screenshots supplied in this conversation

1. Recommended search, job cards → Click 1 (`Screenshot 2026-10-23 234347.png`).
2. Job detail, Apply → Click 2 (`Screenshot 2026-10-23 234354.png`).
3. Next → Click 3 (`Screenshot 2026-10-23 234414.png`).
4. Start Application → Click 4 (`Screenshot 2026-10-23 234430.png`).
5. Optional Continue popup → Click 5 (`Screenshot 2026-10-23 234706.png`).
6. I Agree → Click 6 (`Screenshot 2026-10-23 234442.png`).
7. Step 2 of 6 shift selection / top-left menu → shift evaluation, Click 7 or 7A (`Screenshot 2026-10-23 234833.png`).
8. See all jobs return page → Click 8A (`Screenshot 2026-10-24 001100.png`).
9. Detailed shift, Select this job → Click 8 (`Screenshot 2026-10-23 234535.png`).
10. Accept Offer → Click 9 (`Screenshot 2026-10-23 234552.png`).
11. Next → Click 10 (`Screenshot 2026-10-23 234610.png`).
12. Schedule pre-hire appointment → STOP (`Screenshot 2026-10-23 234628.png`).


## 11. Extension integration update — v1.2.6 (27 October 2026)

This later, user-approved integration update **supersedes** the earlier rule in §6 that a no-shift job may be retried after the next scheduled refresh. It does not change the offer-click or final completion rules.

1. On a confirmed, **visible** Amazon no-available-shifts screen (including **“More shift are on the way!”**, with no shift cards and possibly without a Step-2 progress label), treat the current job as unsuccessful. Execute **Click 7A — Amazon Jobs logo** followed by **Click 8A — See all jobs** if that route presents the option. Never click **Submit your shift preferences**. A missing shift-card list on this confirmed screen is not a broken-stage failure and does not consume three recovery attempts.
2. The controller records every attempted job by a stable job-specific identifier whenever possible, falling back to stable per-card visible fields. Following a no-match/no-cards return, search for the next ranked eligible **untried** job. A still-visible unsuccessful job must not be automatically selected again, even across scheduled or manual page refreshes.
3. Only release the exclusion when that job is **confirmed absent** from a non-loading, populated, stable Recommended list (at least 3 seconds) and then becomes visible again. Transient DOM rerendering, skeleton placeholders, navigation away from Recommended, and an empty loading result are not confirmed disappearances.
4. If all currently eligible jobs are excluded, keep the normal Part 1 clock schedule; do not create an unscheduled refresh loop. **Reset** clears attempted-job history and leaves saved preferences unchanged. Manual security challenges still stop all automated interaction until the user explicitly restarts.

**Verification limit:** This specification describes the approved behaviour. Selectors and Amazon's live DOM remain unverified; the v1.2.6 source tests use synthetic page fixtures.
