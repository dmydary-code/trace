# Review interface fixes verified on 9 November 2026

Trace 0.5.3 includes the review interface fixes below without starting the architectural refactor.

- File headers and Viewed remain sticky beneath the review toolbar in Files and within the Graph detail panel.
- Find Usages shows one detected declaration in a separate first card. Static imports, multiline import bindings and require bindings are excluded from usage results and matching-line highlights; import tokens remain clickable for navigation. Same-line real calls after an import still count. Declaration detection remains based on explicit lexical evidence in the displayed diff, not compiler symbol resolution.
- Enter submits Add to review/Save in the line-comment composer; Shift+Enter inserts a newline. Blank input and IME composition do not submit.
- Files use the same depth-first folder order as the sidebar.
- The sticky toolbar includes a comment count and Previous/Next navigation. Navigation retains Viewed marks and opens the relevant file/thread in either view.
- Sending immediately closes the dialog and shows an explicit busy state, followed by a clickable Review sent confirmation. A lost HTTP acknowledgement is reconciled with the saved review before showing an error or allowing a duplicate retry.
- With a session lease, the viewer still follows session hooks. The CLI can infer one unambiguous lease belonging to the detected agent process. Without a lease, authenticated browser heartbeats retain the viewer across submission/reload; it closes after 120 seconds without browser activity or when its detected owning agent exits. Trusted session hooks remain necessary to identify /clear reliably. The fallback timeout can be configured with --viewer-idle-timeout.

| Verification | Result |
| --- | --- |
| Node 20.20.2 regression tests | 160 passed, 0 failed |
| Node 22.23.4 regression tests | 160 passed, 0 failed |
| Chromium + WebKit, Playwright 1.65.0 | 106 passed, 0 failed |
| Remaining Node acceptance contracts outside this fix | 8 failures representing 7 known defect categories; no skips |

The former lost-acknowledgement acceptance case now passes in the ordinary browser regression suite. Other previously recorded defects, including second-round agent handoff, Graph parser false edges, native lexer limitations and shutdown during blocked Git work, remain outside this change. Actual Codex/Claude host sessions were not exercised; lifecycle/protocol checks use the isolated automated harness. Files and Graph screenshots were visually inspected.

Tests for this change are in tests/review-fixes.test.mjs, tests/e2e/review-fixes.spec.mjs, tests/e2e/submission-recovery.spec.mjs and the updated lifecycle/recovery regression cases.
