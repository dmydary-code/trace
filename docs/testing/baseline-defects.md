# Baseline defects exposed by acceptance tests

These are executable desired-behavior contracts first recorded against Trace 0.5.2. The update below distinguishes the 0.5.3 fixes from the remaining defects. The acceptance commands deliberately return failure while these defects remain. Assertions are neither skipped nor inverted.

| Defect | Case | Reproduction and desired behavior |
| --- | --- | --- |
| Second-round handoff | R-12 / B-02 | Submit feedback through a session-bound waiting CLI, approve, continue and submit again. Only the first feedback event is available to the initiating waiter. A second saved record is not a second delivery event. The test runs for both Codex and Claude identities. |
| False import edges | G-14 | Put an import example inside a JS comment and a quoted string. Graph currently creates Imports edges to an existing local target. Neither example should create a dependency. |
| Python line comments | UI-06 / B-04 | `# subtotal is documentation` produces clickable identifiers. Python comments should be excluded. |
| Go globals | UI-06 / B-04 | `len(items)` makes the built-in `len` clickable. Only the project identifier should be returned. |
| C++ standard symbols | UI-06 / B-04 | `std::cout << amount` treats standard namespace/member names as project identifiers. Standard symbols should be excluded under the agreed lexical contract. |
| Python multiline strings | UI-06 / B-04 | Identifiers from a triple-quoted multiline example appear in usage search. The entire string should be excluded. |
| In-flight Git process on shutdown | L-10 | Hold a Graph Git read in a controlled subprocess and end the session. The HTTP port closes, but the detached viewer process stays alive while its Git child is blocked. Desired cleanup terminates/cancels owned in-flight work as well as the listener. The test releases and cleans up its controlled child in `finally`. |
| Lost submission acknowledgement | N-04 / B-03 | Persist a review, then drop the HTTP response. The browser reopens the form and says the review was not sent. Reload recovers the saved record, but automatic reconciliation is missing. Check that no duplicate is created and the UI acknowledges the saved review. Reproduced in both browsers. |

Run `npm run test:acceptance` for the eight Node assertions (second-round handoff has two agent variants), and `npm run test:browser:acceptance` for the lost-acknowledgement assertion in Chromium and WebKit. There are ten failing assertions representing eight defect categories.

A failing test may reveal another regression later; investigate the actual assertion/error, rather than treating any failure as proof of the known defect. After a product fix, keep the desired expectation and move the passing contract into the ordinary regression suite as appropriate.

## Update on 9 November 2026

Lost submission acknowledgement (N-04 / B-03) is fixed and its unchanged desired assertions now run as `tests/e2e/submission-recovery.spec.mjs` in the ordinary regression suite. The eight Node acceptance assertions remain unresolved; the historical counts above describe the 7 November baseline. Browser-backed fallback ownership also replaces immediate post-submission shutdown when no session hook is available. Other baseline defects are outside this UI fix.
