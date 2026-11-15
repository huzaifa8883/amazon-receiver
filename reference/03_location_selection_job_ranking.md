# Part 3 — Location Selection: Job Ranking

**Purpose:** Decide which job card to click, using the location text and distance already visible on each Amazon card.

## Source and scope

- Use **Recommended** jobs only; do not search the All tab.
- Read currently loaded cards **immediately**. Do **not** scroll to fetch extra cards.
- Read each card's visible **location text** and displayed **miles**. The user does not need to enter a postcode or manually calculate miles.
- Correctly extract the location and numerical distance from combined display text, for example: `Within 0.2 mi | Peterborough, England` means **0.2 miles** and location **Peterborough, England**. Do not confuse the distance label with the location keyword text. (v1.0.1)
- Recognise actual job-card containers and their visible content, not unrelated text or placeholders. The Detection Engine (Part 5) provides the observed cards. (v1.0.1)

## Keyword list

- The user enters multiple location keywords in a **single ordered list**, top item = highest priority.
- One mode selector applies to the **entire list**: **Required** or **Priority** (not an individual mode for every keyword).
- Match **partial text**, case-insensitively, against location text (for example `Bow` matches `Bowthorpe`).
- Example order: `1. Peterborough`, `2. Tilbury`, `3. Bow`.
- Treat blank entries and whitespace-only entries as **no keyword**. Rules for an **empty keyword list** override the Required/Priority selector, as detailed below. (v1.0.2)

## Empty keyword list — overrides both modes (v1.0.2)

- When **no keywords are entered**, ignore the Required/Priority mode choice and select the **nearest available job by displayed miles**.
- Apply the optional **Maximum miles** filter below before ranking. The default setting is **strictly less than 10 miles**.
- If no eligible card remains, wait for the next scheduled UK clock refresh; do not refresh immediately just because the list is empty.

## Required mode

- A card is eligible only if its location contains **at least one** listed keyword (ANY ONE, not ALL).
- If no required keyword appears, do not click an unrelated card: **keep waiting for scheduled refreshes**.
- First preference is the highest-listed keyword that appears. For example, if Peterborough, Tilbury, and Bow are visible, try Peterborough first, then Tilbury, then Bow if earlier attempts say no shifts.
- For cards matching the **same** keyword rank, choose the nearest displayed miles first.
- Cards with a matching keyword but no miles remain eligible.

## Priority mode

- Prefer cards that match keywords in the given order: first keyword first, then the next, etc.
- For multiple cards matching the same keyword rank, choose the nearest miles.
- If **no keywords match any visible card**, choose the nearest visible card by miles instead.
- If the first choice has no shifts, try the next ranked eligible card.

## Maximum miles — only for empty keyword lists (v1.0.3)

- Add one editable **Maximum miles** setting, with default value `10` and **strict less-than** comparison: a job must show a distance **`< 10` miles** by default. Jobs showing exactly `10` miles or greater are skipped. (For any entered limit `L`, require distance `< L`, not `<= L`.)
- This filter applies **only when the keyword list is empty**, regardless of whether Required or Priority mode is selected.
- When a limit is set and the keyword list is empty, **skip cards with missing/unreadable mileage**; their distance cannot be verified against the limit.
- **Leaving Maximum miles blank disables the filter**. With no keywords and a blank limit, use the nearest visible job; a job with no displayed miles can be considered after jobs with known distances.
- **As soon as one or more keywords are entered, ignore Maximum miles entirely.** In Required mode, matching cards remain eligible regardless of distance or missing mileage. In Priority mode, distance limits also do not apply when falling back to nearest after no keywords match.
- The setting is a distance **upper bound**, not a postcode or a distance calculated from another location.

## Distance tie-breaks

- Use numeric miles shown on job cards; lower is nearer.
- If comparing equivalent keyword-rank cards, prefer **known distances before missing distances**.
- A card without a distance is still eligible if it matches a keyword. If the keyword list is empty, such cards are eligible **only when Maximum miles is blank**.
- Keep a consistent tie-break (e.g. order on page) when ranks and distances are the same.

## Refresh and new cards

- `MutationObserver` should cause an immediate rerank/check as cards enter or change in the page.
- Select the best **currently visible / loaded** eligible card without waiting for the entire page to finish loading. A higher-ranked card that loads later might not be present at the first decision.
- If all currently available eligible cards fail, wait for the next scheduled refresh and reconsider those locations then.
