# Part 7 — Shift Selection Configuration

**Status:** Approved requirements  
**Purpose:** Decide which available Amazon work shift is eligible and which eligible shift should be selected.  
**Scope:** Preferences, filtering, and ranking only. This file is independent of the Receiver's signalling and click workflow.

## 1. Weekly Hours — Mandatory

- Provide two **required** inputs: **Minimum weekly hours** and **Maximum weekly hours**.
- Both must be entered before shift selection can run.
- A shift qualifies when its weekly hours are **greater than or equal to Minimum** and **less than or equal to Maximum**.
- The minimum must not exceed the maximum.
- Example: Minimum **20**, Maximum **40** → shifts offering **20 through 40 hours/week**, inclusive, qualify.
- Setting both inputs to **40** permits exactly **40 hours/week**.
- If a card's weekly hours cannot be determined, do not treat it as a verified match to the mandatory range.

## 2. Number of Working Days — Required or Priority

- Replace selection of particular weekdays (Mon/Tue/etc.) with a single **Number of working days per week** setting.
- Choose a whole number from **1 to 7**.
- Provide a mode selector: **Required** or **Priority**.
- **Do not provide an ON/OFF toggle** for this feature; use the Required/Priority choice.
- Which weekdays they are **does not matter**; only the total number of working days on the shift card matters.

### Required mode

- Only shifts with **exactly** the selected number of working days qualify.
- Example: Working days **5**, Required → only five-day schedules qualify (and they must also satisfy the mandatory weekly-hours range).

### Priority mode

- Prefer shifts with **exactly** the selected number of working days.
- If none match, shifts with other day counts **remain eligible**, provided they satisfy the mandatory weekly-hours range.
- Example: Weekly hours **40–40**, days **5**, Priority → prefer **40 hours over 5 days**; if unavailable, **40 hours over 4 days** may be selected.
- Priority mode is a **preference**, not a restriction.

**Note:** There is no need to calculate or require an exact daily shift duration. The requirements are based on the card's weekly hours and count of working days.

## 3. Shift Ranking — ON/OFF

- Provide a separate **Shift Ranking** ON/OFF control.
- **OFF:** Ignore the optional hours-first and time-first ranking preferences. Apply the mandatory weekly-hours range and Required/Priority working-day rules; otherwise retain the order shown on the page.
- **ON:** Let the user choose **one** ranking method:
  1. **Highest weekly hours first** — prefer the greatest weekly hours among otherwise eligible shifts; use configured shift start-time priority to resolve equal-hour choices.
  2. **Shift start-time priority first** — prefer the highest-ranked configured start-time slot; use weekly hours to resolve equal-priority choices.

### Four adjustable start-time priorities

- Let the user arrange up to four start-time slots, in order from **1st** to **4th** preference:
  - **00:00–05:59**
  - **06:00–11:59**
  - **12:00–17:59**
  - **18:00–23:59**
- Categorise a shift by its **start time only**, not its finish time.
- Priority slots may be left blank; the same slot should not appear more than once.
- Start-time preferences **rank** shifts; they do **not** exclude shifts in unranked time slots.
- When Shift Ranking is OFF, all start-time ranking preferences are ignored.

## 4. Selection Order

1. Read available shift cards and their weekly hours, number of working days, and shift start time where shown.
2. **First filter by mandatory weekly hours:** exclude cards outside the entered minimum–maximum range.
3. Apply the working-days mode:
   - **Required:** Exclude cards that do not have the exact selected number of working days.
   - **Priority:** Rank exact day-count matches ahead of other eligible shifts, but keep other counts available as fallback.
4. Within the remaining relevant group, apply the selected **Shift Ranking** method if enabled.
5. If shifts are still equal, choose whichever appears **first on the page**.
6. If no shift satisfies the mandatory conditions, **select nothing**.

### Example

| Preference | Value |
|---|---|
| Minimum weekly hours | 40 |
| Maximum weekly hours | 40 |
| Working days | 5 |
| Working-days mode | Priority |
| Shift Ranking | ON: Highest weekly hours first |

A **40-hour / 5-day** shift is preferred to a **40-hour / 4-day** shift. If no five-day option qualifies, the four-day option can be chosen. In **Required** mode, the four-day option would not qualify.

## 5. Shift Card Data Detection — Both Amazon Card Layouts

The selection engine must read **both shift-card layouts** shown in the reference screenshots. Both layouts use the **same eligibility and ranking rules** from Sections 1–4.

### Supported layouts and examples

| Information to extract | Layout A — Select Work Shift list | Layout B — Detailed shift card |
|---|---|---|
| Weekly hours | `Hours: 24 hours/week` → **24** | `Hours: 40hrs per week` → **40** |
| Working-day text | `Shift: Mon, Tue, Wed, Thu 6:00 - 12:30` | `Shift: Wed, Thu, Fri, Sat 7:00 - 17:30` |
| Working-day count | **4** | **4** |
| Shift start time | **06:00** | **07:00** |

- Recognise each card's own text and fields; do not accidentally combine a shift's hours with the days or start time of another card.
- Support variations in spacing and labels such as `24 hours/week`, `40hrs per week`, and `40 hrs/week`, without confusing the **hourly pay rate** with weekly working hours.
- Parse start times from the **shift schedule**, not from start dates, end dates, or unrelated page text. Only the **shift start time** is used for time-slot ranking.
- Count the **distinct working weekdays listed in the shift schedule** (e.g., Mon/Tue/Wed/Thu = 4; Wed/Thu/Fri/Sat = 4). The identities of the weekdays do not affect eligibility, only their count.
- **Do not calculate working-day count from employment start/end dates.**
- **Do not derive weekly hours by multiplying displayed daily start/end times.** Unpaid breaks may mean those times differ from paid hours. Use the explicitly displayed weekly-hours value.
- Treat the two layouts as **alternative representations of shift cards**, not separate ranking modes. All configured settings apply to either layout.

### Missing or unreadable card information

- **Weekly hours missing/unreadable:** Exclude the card, because it cannot be verified against the mandatory minimum–maximum range.
- **Working days missing/unreadable:** In **Required** mode, exclude the card. In **Priority** mode, keep it eligible if its weekly hours qualify, but place it **after cards with readable day counts** when considering the working-day preference.
- **Shift start time missing/unreadable:** Keep the card eligible if it meets the other conditions. When start-time priorities are being used, rank it **after cards with known preferred start times**; otherwise, do not invent a start time.
- If a field is temporarily absent during loading, do not invent values; re-read that card when its visible content updates.
- Card detection and field extraction may use Amazon-specific adapters, but this specification remains limited to **data extraction, eligibility, and ranking**. Confirm DOM selectors against the live site rather than guessing from screenshots.

## 6. Settings and Reusability

- Save these settings for future Receiver sessions.
- Keep this selection configuration independent of the website-specific clicking sequence so it can be reused or adapted in another extension.
- Do not replace or change the existing signal relay or Receiver communication rules.

## 7. Explicitly Outside This File

This specification **does not define**:

- Signal receiving or sending
- Page refreshing or refresh timing
- Clicking shift cards or confirmation buttons
- Completion detection, stopping, or beep notifications

Those operations belong in separate modules.
