# Part 13 — Compact shift Telegram reports (v1.3.6+)

## Single-report rule

For each shift-selection visit, read all visible shift cards once (including rejected cards) and evaluate them using the existing preference rules. Preserve every card's dates, days, hours, pay, location, full original text, rank, final decision and rejection reasons.

Do **not** emit separate `shift_card_detected`, `shift_selection_result`, `no_shift_cards` and `no_suitable_shifts` messages in normal compact reporting mode. These event schemas remain supported for compatibility, but the production workflow sends just one `shift_visit_completed` per visit. An empty card list means no shift cards; a non-empty list without a selection means no qualifying shifts. The report summary must explain the result.

Never block job clicks, shift selection, navigation or recovery while creating/sending the report. Once the shift list is ready and the outcome known, enqueue it for the authenticated Oracle relay without artificial delay. Use `MutationObserver` plus the existing stability window to capture dynamically added cards and avoid duplicate snapshots. A 1–2 second aggregation window is acceptable when necessary to ensure complete shift data, but do not introduce a new 1–2 second click delay.

The Oracle relay v2 generates the CSV attachment from the final JSON. Its default formatter posts a short text and a separate CSV file. The optional `amazon-relay-single-shift-report-v1.0` patch sends one Telegram **document with a compact caption**, retaining all card details in the CSV. The patch is not automatically installed and the VM is not modified by the Chrome extension.

All other notifications (job selected, changed card, errors, login, human verification, application stop and milestone, 20-minute status) retain their prior event path and urgency. Keep unique event IDs, credential filtering, 24-hour retry queue, data limits and safe delivery.

## Regression checks

- A two-card rejected visit enqueues exactly one `shift_visit_completed` with two complete cards and two rejection reasons.
- An empty visit enqueues one report with `cards: []` and a clear no-shifts summary.
- An eligible shift enqueues one report and application clicking continues immediately.
- Repeated MutationObserver updates do not enqueue duplicate visit reports.
- Login/CAPTCHA/error alerts are not delayed by report assembly.
- The relay (with optional patch) sends one document+caption for each visit; the CSV includes all cards, including those omitted from a short caption.
