# Part 4 — App Behaviour

**Purpose:** Control the automation lifecycle, error recovery, and which tabs are managed. Reusable across websites.

## Buttons

- **Start:** If the Amazon Recommended search page is already open, refresh it immediately and begin automation. If an unfinished application stage already exists, identify that stage and resume it rather than restarting the process.
- **Stop:** Immediately stop automatic clicks/refreshes and silence/cancel all beeps. Leave all tabs open.
- **Manual Refresh:** Refresh the Recommended job-search page immediately and start/continue automation (even if previously stopped). Ignore this control while an application is running.

## One search tab + Amazon-created application tab

- Control only the Amazon search tab the user started from; ignore other Amazon job-search tabs.
- Follow the new application tab **opened by Amazon itself**, using a verified association with the Apply action. Track its tab identity across navigation/reloads, and do not mistake unrelated new tabs for the application tab. (v1.0.2)
- If the search tab is accidentally closed during an active session, reopen its saved URL and resume (without duplicating search tabs).
- If the application tab closes during the application stage, return to the Recommended search page and resume searching; follow clock refresh rules.
- If no Amazon job-search tab exists when the user first presses Start, ask the user to open it manually (do not launch a fresh one on that first Start).
- After a complete Chrome restart, remain stopped until Start is pressed; saved preferences remain.

## Navigation rules

- Keep the search tab on **Recommended**. If the Amazon site merely switches to All, switch back to Recommended.
- If the user manually navigates the controlled tab away from Amazon job search, stop automation.
- During the application, pause job-search refreshes so the application is not interrupted.

## Recovery after an expected page/button does not appear

1. Wait **3 seconds** for the expected page/button.
2. If still absent, refresh **the current stage's page**.
3. Detect the current stage from page content/URL, then continue from there without blindly replaying earlier steps.
4. Allow **up to 3 failed recovery attempts** for the same blocked stage.
5. After the third failure, **stop and start the 10-minute beep schedule**.

The no-available-shifts message instead means **try the next eligible card** (Part 2/3), not the page-failure retry rule.

## Completion and security

- Success = the tracked Amazon application tab reaches the confirmed visible **`Step 2 of 6`** application screen after Start Application / optional Continue. Stop automation, leave tabs open, begin the 10-minute beep sequence. Do **not** use arbitrary page loading as a completion signal. (v1.0.2)
- **Real, active, blocking** login demand, CAPTCHA, or security verification = stop immediately and begin the same beep sequence; user handles verification and can manually restart.
- **False CAPTCHA/security positives must not stop the automation.** Mere CAPTCHA/login/security words in the DOM, hidden widgets, background scripts, or an inactive page are **not enough** to conclude the currently controlled page is blocked. Use the verified detection rules in Part 5. (v1.0.1)
- Do not bypass security verification.

## Background operation

- Continue while the extension popup is closed, provided Chrome remains open and the required tabs remain available (or can be reopened by the active-session tab rule).
