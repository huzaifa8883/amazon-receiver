# Part 5 — Detection Engine

**Purpose:** Detect relevant DOM changes quickly and identify the current workflow stage. General framework reusable; Amazon-specific selectors are configurable.

## MutationObserver behaviour

- Use `MutationObserver` on relevant content areas to detect newly inserted/changed job cards, availability messages, buttons and optional popups.
- Check eligible job cards **immediately** when detected; do not wait for all cards to load.
- Do **not** auto-scroll merely to find more cards.
- Handle repeated/multiple DOM updates without accidentally clicking a button twice.

## Stage detection

Recognise these stages from actual page content and, where useful, URL changes:

1. **Active** Recommended job-search tab with recognised, currently loaded job cards
2. Selected job details and Apply
3. Amazon-created application tab and Next
4. Start Application page
5. Optional Continue popup
6. **Visible `Step 2 of 6` application screen on the tracked application tab** (stop + beep) (v1.0.2)
7. Missing/broken page, **confirmed active blocking** login/security verification, or unavailable-shifts message

Re-detect the stage after each page load or retry so the process can resume from its current point.

## Amazon-specific detection fixes (v1.0.1–v1.0.2)

### v1.0.1 — Avoid false CAPTCHA/security detection

- A word such as `CAPTCHA`, `verification`, `security`, or `sign in` found somewhere in the DOM is **not by itself evidence** of an active challenge.
- Stop only when a **visible, current, blocking** login/CAPTCHA/security challenge is positively identified on the controlled page. Exclude hidden, templated, off-screen, non-active, or background/script text.
- A normal logged-in Recommended/results/application page must **not** be misclassified as CAPTCHA or security blocked. If evidence is ambiguous, do not fire a false security-stop event; keep stage detection separate from a confirmed security block.
- Keep the security decision in the website-specific detector so the generic Detection Engine can be reused for another site.

### v1.0.1 — Detect the active Recommended tab

- Verify that **Recommended is the currently selected Amazon tab**, using active/selected state and the corresponding visible job-list content, not merely the presence of the word `Recommended` alongside `All`.
- If Amazon switches to All, report that to App Behaviour so it can switch back to Recommended. Do not select cards from the All tab.

### v1.0.1 — Recognise and parse job cards

- Detect actual Amazon job-card containers and their currently visible data, avoiding unrelated containers, skeletons/loading placeholders, and duplicate recognition of the same card.
- Support combined location/distance labels such as **`Within 0.2 mi | Peterborough, England`**. Extract `distanceMiles = 0.2` and `locationText = "Peterborough, England"` independently.
- Supply clean card observations (identity/reference, location text, distance in miles if known, and page order) to Part 3 for ranking; do not implement ranking inside the generic detector.

### v1.0.2 — Track application tab and detect completion

- Once Apply opens a new tab **by Amazon's own action**, identify the relevant tab through creation/opener/navigation data and verify its page content/URL before associating it with the workflow. Ignore unrelated tabs; never open an extra application tab.
- Continue following the identified tab through navigations and in-page changes; reinitialise observers after reloads.
- Detect **visible `Step 2 of 6`** on the correct tracked application screen after Start Application / optional Continue; this means the **extension workflow is complete**, even though the full Amazon application is not.
- Do not treat arbitrary navigation, a loaded page, or hidden `Step 2 of 6` text as proof of completion.

## Coordination with other parts

- **Refresh Engine:** owns UK-clock refresh timing; not controlled by DOM mutations.
- **Location Selection:** owns matching/ranking; detection passes observed card data to it.
- **Click Operations:** owns actual button/card clicks based on confirmed stage.
- **App Behaviour:** owns running/paused/stopped state, retries, and active tab identity.

## Reliability boundaries

- A DOM observer runs only in loaded pages with its content script present; it must be recreated after a full reload.
- Browser/network/tab throttling means "immediate" is a best-effort response, not a guaranteed timing promise.
- Do not guess selectors from screenshots; confirm them on live pages before source implementation.


## v1.3.7 — Recommended-unavailable / public search layout

The absence of a visible password field is **not** proof that a user is signed in. The generic public search layout can display a `jobs found` count, a `Search jobs` field, `Add filter` and `Sort by`, while the signed-in `Recommended` tab and `Recommended jobs for you` heading are unavailable. Treat this combination as a probable lost Recommended session, not as an eligible Recommended listing.

Confirm the public layout is stable over a follow-up observation (~1 second). Do not click/refresh during confirmation. On confirmation stop, retain the current tab for manual review and send `account_logged_out` plus `automation_stopped` without attempting to authenticate. Ordinary logged-in **All** tabs with a Recommended control must NOT be flagged. Make the observation reason explicit; the layout is evidence of unavailable personalised results, not definitive proof of logout. A manual Start must be refused on this page.
