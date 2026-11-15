# Part 9 — Reusable Job Card Selection: Two Keyword Boxes

**Version:** 1.0  
**Created:** 25 October 2026  
**Status:** Reusable selection specification  
**Purpose:** Define how a browser extension or similar application identifies visible job cards, applies two keyword preference boxes, and returns eligible cards in a deterministic preference order.  
**Reuse:** Include this file in any **new extension project that needs job-card selection**, regardless of website. Adapt the site-specific card reader and click workflow separately.

> **Integration instruction for future extensions:** Treat this file as the default specification for the two-box job-card preference feature whenever it is explicitly included in that extension's project requirements. Do not hard-code Amazon, a particular job title, city, URL, card layout, distance limit, or click sequence into this reusable module. Merely storing this file does not automatically install it in unrelated extensions.

## 1. Feature and user interface

Provide **two separate keyword boxes** in the extension's settings. Each box has its own **Priority / Required** mode selector; a mode applies to the **whole keyword list** in its box, not individually to every word.

| Setting | Box 1 — Main preferences | Box 2 — Additional preferences |
|---|---|---|
| Keyword list | Editable, ordered list | Editable, ordered list |
| Mode | **Priority** or **Required** | **Priority** or **Required** |
| Default mode for new settings | **Priority** | **Required** (saved even while OFF) |
| ON/OFF switch | **No switch: always active** | **ON/OFF switch: yes** |
| Default switch state | Always active | **OFF** |
| When disabled | Not applicable | Ignore **all** of Box 2's settings |
| Saved preferences | Persist keywords and mode | Persist switch state, keywords and mode |

- A keyword may be a single word or a phrase (such as `Peterborough`, `Reduced`, `Full Time`).
- The **top keyword is highest preference**, followed by the next keyword. Allow reordering, adding, editing and deleting entries.
- Use one keyword per entry (or one per line if the UI uses a text area). Ignore blank and whitespace-only entries.
- Box 2's mode and keywords remain saved while **OFF**, but have **no effect** until switched **ON**. They should be visually labelled as inactive or disabled while OFF.
- Both boxes can select either mode independently. Box 1 does not need to be switched off to use only its Priority mode; leave Box 2 OFF.
- Settings should be persisted across browser or extension restarts, using the host platform's appropriate settings storage.

## 2. Meaning of the modes

### Required — mandatory condition

- A job card **qualifies for that box** only if it matches **at least one** non-blank keyword in that box (**OR** within a box, not all keywords).
- A card that matches none is **excluded**; never select it as a fallback merely because no required match is available.
- If the active Required box contains **no usable keywords**, it imposes **no restriction**. This avoids accidentally excluding every job when a list is left blank.
- Among otherwise equal qualifying cards, an earlier matching Required keyword may be used as a tie-breaker.

### Priority — preference, not exclusion

- Prefer cards matching the earliest keyword, then the next, etc.
- A card not matching any Priority keyword **remains eligible** and is a fallback after matching cards.
- If no cards match that Priority box, the box does not prevent selection; the other active box and the extension's normal tie-break rule determine the order.
- A Priority box with no usable keywords imposes **no ranking preference**.

## 3. How both boxes work together

1. Read the current, recognised job cards from the website-specific card reader.
2. Ignore Box 2 entirely if its ON/OFF switch is OFF.
3. **Filter first:** each active **Required** box must match at least one of its own keywords. If both boxes are Required, the card must satisfy **both boxes** (**AND between boxes; OR within each box**).
4. **Rank next:** among the remaining eligible cards, use active **Priority** box matches to rank cards. If both boxes are Priority, **Box 1 takes precedence**, then Box 2 breaks ties.
5. For ties remaining after Priority ranking, use the earliest matching Required keyword: **Box 1 before Box 2** when both are Required.
6. Apply the website project's configured final tie-break (for example, shorter displayed distance where available). Without an explicit project-specific tie-break, preserve the **order in which cards appear on the page**.
7. Return the ordered eligible cards to the separate website-specific click/selection workflow. **Do not click inside the preference engine.**
8. If **no card passes Required filters**, return an empty eligible list; do not silently relax Required into Priority. The host workflow decides whether to wait for normal refreshes, show a message, or take another authorised action.

### Combination table

| Box 1 mode | Box 2 state/mode | Result |
|---|---|---|
| Priority | OFF | Prefer Box 1 keywords; other cards remain fallback choices. |
| Required | OFF | Only Box 1 matches qualify. |
| Priority | ON + Priority | All cards remain eligible; Box 1 preference ranks first, Box 2 ranks next. |
| Priority | ON + Required | Only Box 2 matches qualify; rank those matches by Box 1 preference. |
| Required | ON + Priority | Only Box 1 matches qualify; rank those matches by Box 2 preference. |
| Required | ON + Required | A card must match a keyword in **each** box. |

**Important:** A Required condition is always a filter. A Priority condition is always a preference. A Priority match must never override a failed Required condition.

## 4. Exact ordering rules

To make selections predictable:

- **Matching order within one box:** assign the card the index of the **earliest keyword it matches** (first = best), even when it matches several keywords.
- **Priority ranking:** process active Priority boxes in this order: Box 1, then Box 2. For each, cards matching an earlier entry outrank later matches; **unmatched cards come after all matches** for that box, but are not excluded.
- **Required ranking as a tie-break only:** after all active Priority preferences, use the earliest matching keyword from each active Required box, Box 1 then Box 2. If Required filters have passed, these indices are always defined for non-empty lists.
- **Final tie:** apply any expressly defined project-level card tie-break; otherwise choose the card occurring earlier on the current page.
- If a box has no usable entries, omit that box from matching and ranking rather than treating all cards as matching a particular keyword.
- When **neither active box contains keywords**, every currently recognised card passes these keyword rules, and the host extension's default job-card selection rule applies (page order unless that project specifies another rule).

## 5. What text to search

This specification must work with different job sites and different card layouts.

- The website-specific **card reader** extracts the actual, currently displayed text for **each individual job card**, optionally grouped into fields such as `title`, `location`, `employmentType`, `duration`, and `payRate`.
- Each box should have a **configurable matching scope** supplied by the host project or site adapter. Examples: Box 1 searches **location**, Box 2 searches **employment type**, or a box searches **all visible card text**. This need not be an extra popup control unless a project specifically wants users to change scopes.
- **Default scope if no project-specific scope is configured:** the combined visible text belonging to that job card alone.
- Match **case-insensitively** and by **partial text**, ignoring excess surrounding whitespace and normalising repeated internal whitespace. Thus `swindon` matches `Swindon, England`; `Full Time` matches `Full Time, Part Time, Reduced`.
- Match a keyword within a single card's configured text; **never borrow content from another card**, an unrelated page section, a hidden template, or a loading placeholder.
- Do not infer unshown attributes. For example, `Multiple On Site locations available` does not identify a particular city by itself.
- If a chosen field is absent or unreadable, consider that card **unmatched for that box**: it fails an active non-empty Required box but remains a possible fallback under Priority.
- Re-read a card when visible content changes; do not assume a partially loaded card will remain unchanged.
- Confirm actual card selectors and field extraction against each real website; **a screenshot does not establish a reliable DOM selector**.

## 6. Example using the reference job cards

The reference screenshot shows job cards with text such as:

- **Swindon, England** — Type: `Reduced`
- **Peterborough, England** — Type: `Reduced`
- **Multiple On Site locations available** — Type: `Full Time, Part Time, Reduced`

**Example A — only location priority:** Box 1 = **Priority**, scope `location`, keywords `Peterborough` then `Swindon`. Box 2 = **OFF**. The Peterborough card ranks before Swindon; the multiple-locations card is still a fallback.

**Example B — require Full Time:** Keep Box 1 as above. Set Box 2 = **ON**, **Required**, scope `employmentType`, keyword `Full Time`. Only the displayed multi-location card passes Box 2. It may be selected despite having no Box 1 location match, because Box 1 is only Priority.

**Example C — require both location and job type:** Box 1 = **Required**, keywords `Peterborough` then `Swindon` (location scope). Box 2 = **ON**, **Required**, keyword `Full Time` (employment-type scope). None of the three shown cards passes **both** filters, so return no eligible card; do **not** choose the multi-location job.

These examples demonstrate keyword selection only; actual shift availability and application progress belong to other modules.

## 7. Separation of responsibilities

**Reusable selection engine owns:** preference settings, matching, filtering, ordering, and an ordered list of eligible card references.

**Website-specific adapter owns:** locating job cards on the live page, extracting visible text and fields, assigning stable card references, verifying whether cards are currently selectable, and providing optional distance or other site-specific tie-break data.

**Extension controller owns:** Start/Stop, scheduled refreshes, observing card updates, choosing when to attempt the next eligible card, clicking buttons, tab management, security interruptions, error recovery, and notifications.

- The controller should re-evaluate currently visible cards when genuine card updates occur, without duplicate selections or automatic scrolling solely to find more cards.
- When a chosen card becomes unavailable, the controller may request the **next card in the current ranked eligible list**, subject to that website's rules. Do not permanently blacklist a card unless the host project explicitly specifies that behaviour.
- This document **does not authorise new clicking steps**, bypasses of CAPTCHA/login checks, auto-submission, or changes to existing application workflows.

## 8. Integration contract for developers

Input to the selector:

- `cards`: an array of recognised card observations: unique reference, per-card visible text, optional extracted fields, and original page position.
- `box1`: ordered keywords and `mode` (`priority` or `required`); treated as enabled.
- `box2`: ordered keywords, `mode` (`priority` or `required`), and `enabled` boolean (default `false`).
- `fieldScope1`, `fieldScope2`: optional adapter/project field scopes; default to the individual card's visible text.
- `tieBreaker`: optional project-specific deterministic comparator to apply **only after** keyword preferences; default to page order.

Output from the selector:

- `eligibleCards`: references to cards in the required **selection order**.
- Optional diagnostics: which box and keyword each card matched, which Required filter excluded it, and reasons for an empty result.

Store UI choices separately from transient job-card observations. The engine should be independently testable using synthetic card data, without network calls, browser tabs, Amazon-specific selectors, or click simulation.

### Minimum behaviour checks

1. Box 2 OFF means changing its keywords/mode does not change any selection result.
2. Each box works independently in both Required and Priority modes.
3. Required never falls back to a non-matching card.
4. Priority can fall back to non-matching cards.
5. With both Required, at least one match is necessary in **each** non-empty box.
6. With two Priority boxes, Box 1 decides first and Box 2 breaks ties.
7. When Box 1 is Required and Box 2 is Priority, apply Box 1 eligibility first and Box 2 ranking afterwards; and vice versa.
8. Blank keyword lists do not exclude cards or manufacture matches; Box 2's saved entries remain inert while OFF.
9. Matching is case-insensitive, partial, per-card, and respects the configured field scope.
10. Unreadable required text does not count as a verified match; ties have deterministic outcomes.

## 9. Compatibility with existing Amazon Jobs project

This is a **reusable two-box option**, not an automatic replacement for the earlier **Part 3 — Location Selection: Job Ranking**, which currently describes **one ordered location keyword list**. When this project is deliberately upgraded to two boxes:

- Explicitly update/reconcile the old single-list settings and migrate their existing keywords and mode to **Box 1** without silently losing them; initialise **Box 2 OFF**.
- Preserve the Amazon-specific rule to select from **Recommended** and use the site's visible/currently loaded job cards; do not use the All tab or auto-scroll for more cards.
- Preserve any existing Amazon-specific default/tie-break selection, including the existing **Maximum miles** rule for the **no-active-keywords** case and the nearest-card fallback where applicable. A disabled Box 2 does not count as an active keyword list. The specific Amazon rules must be reconciled in its adapter/integration tests, rather than imposed on other websites.
- Preserve the current job-card no-shift fallback and all existing application/click patterns. **Part 7 — Shift Selection Configuration** concerns shift cards, not these initial job cards, and is not replaced by this specification.
- Do not change existing running sessions, settings or click workflows merely because this file has been created; integrating it requires a separate extension implementation change.

## 10. Scope and change log

**Included:** Universal two-box user preferences and job-card matching/filtering/ranking logic, plus a reusable integration interface.

**Excluded:** Source code for an extension, site-specific selectors, page refreshing, automatic card clicks, shift selection, application submission, and appointment booking.

**v1.0 — 25 October 2026:** Initial reusable specification. Two independent Priority/Required keyword lists; Box 1 always active and defaults to Priority; Box 2 defaults to Required with its toggle OFF and retains its saved preferences; Required filters before Priority ranking; deterministic combined-mode rules; adapter-based website independence.
