# Test report — Full Apply Assistant v1.4.3

- 127 / 127 Node tests passed (`npm test`).
- Verified production Oracle `signal_id` normalization, absence of `detector_id`, ACK after local acceptance only, no ACK on failed persistence, in-flight duplicate protection, ping/pong, server `ack_result`, offscreen service-worker round-trip and background-triggered refresh queue.
- Synthetic Chromium adapter and security fixtures passed for multiple listing/shift layouts (11 unique Python DOM fixtures).
- Local TLS mock receiver smoke passed. NOTE: it represents the legacy test fixture, not the complete live Oracle protocol.
- Full Manifest V3 headless-browser integration smoke blocked: Playwright did not observe an extension service worker; **not marked passed**.
- Real Chrome against production Oracle, job refresh, server ACK and real Amazon pre-hire: **must be confirmed with Receiver 01 before broad deployment**.
- No keys, tokens, live Oracle databases or user browsing sessions were used in the tests.
