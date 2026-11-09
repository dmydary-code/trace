# Trace refactor acceptance test plan

Status: test implementation approved by the reviewer on 2026-11-07. Implement tests only; product refactoring and bug fixes are not part of the current request. See coverage.md for automated, partial and manual coverage.

Baseline: Trace 0.5.2, product commit `de6659e`, Homebrew formula commit `a49a22c`. The scope is to extract frontend state, API access and rendering from `app.js`, and review application logic from `server.mjs`, while preserving approved observable behavior.

## Scope and decisions

Test the public behavior before moving code. Keep the same tests running throughout the refactor. Do not lock tests to the current internal module names, HTML strings, or incidental implementation details.

The requested project matrix is JavaScript, TypeScript, Java, Kotlin, Go, Python, Rust, C#, Swift and C++. Trace reads these projects; it does not compile or execute their application code.

Graph currently discovers relative JavaScript/TypeScript file dependencies only. It uses text heuristics, not semantic symbol resolution. Other languages can appear as changed nodes with file previews, but their dependency discovery is not implemented. The reviewer selected preservation of this scope on 2026-11-07. Additional language dependency discovery is a separate deferred product task. A passing node/preview test must never be reported as proof that dependency discovery works for that language.

Find Usages is an identifier-spelling search restricted to the displayed diff side. It does not resolve symbol identity. Its language handling is also uneven; the language matrix will test native comment/string forms rather than assume equivalent support.

Preserving behavior does not mean accepting a discovered defect. Classify each new case as an existing-behavior check, an agreed acceptance requirement that exposes a bug, or a new feature. Report baseline failures before refactoring; fix approved bugs in separate changes, then repeat the tests. Do not silently skip them, rewrite expectations to pass, or expand language support inside the refactor.

## Test environments and evidence

| Layer | Execution | What it establishes |
| --- | --- | --- |
| Integration | `node:test`, temporary real Git repositories, real Trace CLI, HTTP server and on-disk reviews | Git, API, persistence and process contracts work together. |
| Browser E2E | Proposed Playwright test-only dependency; real Trace server; Chromium and WebKit | Loading states, user actions, DOM rendering, navigation and browser failures. No runtime dependency is added to the shipped CLI. |
| Agent adapter tests | Deterministic Codex/Claude command fixtures plus the real `--wait`, `feedback` and `reply` commands | Trace's protocol, installer failures and replies; does not establish behavior of the actual host application or model. |
| Live agent acceptance | Actual Codex CLI and Claude Code CLI; desktop smoke runs where available | Skill discovery, trusted hook execution, actual feedback receipt, a controlled edit and a visible thread reply. Record host versions and hook settings. |

Run the deterministic happy path for all ten languages with both agent identities (20 combinations). For a claim of live support across the entire matrix, also run the live happy path in both CLIs for all ten fixtures (20 combinations). A smaller live sample must be reported as a sample, not full verification.

Run shared failure cases for both agent adapters. Exercise the browser interaction suite on JS and TS fixtures and run a basic file/comment/Graph smoke test on every language. Desktop cases supplement the CLI matrix. They cannot be certified through simulated hooks alone.

Use macOS with Homebrew's Node 22 as the primary release environment. Run the deterministic suite on Linux as well and check Node 20, the declared minimum, and Node 22. Tests run in isolated temporary repositories/config directories, with no changes to the user's installed plugins, real project, or agent configuration.

Every case checks UI where applicable, HTTP/CLI outcome, persisted content and lifecycle cleanup. Save browser traces/screenshots on failure, the bounded subprocess log, fixture ID, language, agent, host version and base/revision IDs. Redact session tokens from reports.

## Shared fixtures and assertions

Each language fixture has an initial commit, a changed entry point, an unchanged helper, a shared type where the language supports one, and unit/integration/scenario test examples with explicit directory mappings. The fixtures are small, valid projects with their native manifests and source layout, not files with renamed extensions. A known before/after patch, expected line numbers and a deterministic requested correction form the oracle. For example, the reviewer requests inclusion of a shipping fee in a total; a stored expected patch and result establish that the requested edit was applied. Native build/test commands are an additional check where the toolchain is available; unavailable compilers must be reported and are not evidence of a successful build. A source manifest lists the intended local relationships independently of Graph's output.

Create additional fixtures for a new repository with no commits, staged/unstaged/untracked changes, a linked worktree, another branch, a mixed-language monorepo, rename/delete changes, binary/large files and dependency topologies. Do not install or build third-party application dependencies merely to test Trace.

Compare semantic output: paths, status, old/new line numbers, source text, relationships, change markers, comments and replies. Normalize UUIDs, timestamps, temporary roots, port and session token. Keep the actual values for identity/isolation assertions. Avoid raw full-page HTML snapshots.

All process tests have bounded deadlines and unconditional cleanup. Assert port reuse by binding the released port, not only by checking that fetch fails. Await states/events rather than using arbitrary sleeps.

### Happy path steps applied to every language and both agents

1. Start from the fixture's recorded Git state, establish the agent session and launch Trace for its absolute checkout path.
2. Observe loading, then the expected diff, branch, base, comparison mode and checkout path.
3. Add one comment on an added line and one on a deleted line, plus an overall instruction. Edit one comment before submission.
4. Send the review. Check that the dialog closes, success is visible, exact comments reach the waiting agent and the snapshot is saved once.
5. Have the agent apply the controlled one-line fix and save a reply for each comment. Check Pending disappears for replied comments and replies appear without reloading the page.
6. Inspect latest changes, verify the exact patch, resolve/reopen a thread as appropriate, and Approve. Confirm approval does not commit or push anything.
7. End the owning agent session. Confirm the viewer exits and the port is reusable. Reopen the saved review and verify the original snapshot, comments, replies and approval remain available; explicitly close the reopened standalone viewer.

| ID | Language fixture | Representative files | Expected result |
| --- | --- | --- | --- |
| HP-01 | JavaScript | ESM `.js`, helper and test; CommonJS variant | Full shared happy path with exact JS source and anchors; JS Graph cases below. |
| HP-02 | TypeScript | `.ts`/`.tsx`, helper, explicit type import and test | Full happy path; separate old/new sides; TS Graph cases below. |
| HP-03 | Java | `pom.xml`, package/class files and JUnit-style test | Full happy path; Java paths and line anchors preserved. Graph scope follows the language decision below. |
| HP-04 | Kotlin | `build.gradle.kts`, `.kt` classes and test | Full happy path; Kotlin source preserved; no assumed Java-only symbol rules. |
| HP-05 | Go | `go.mod`, packages, `.go` and `_test.go` | Full happy path including Go source and test filename conventions. |
| HP-06 | Python | `pyproject.toml`, package modules and `test_*.py` | Full happy path; indentation and Python source preserved. |
| HP-07 | Rust | `Cargo.toml`, `src/lib.rs`, module and test | Full happy path; Rust source and anchors preserved. |
| HP-08 | C# | `.csproj`, namespace/classes and test | Full happy path; `.cs` files and source preserved. |
| HP-09 | Swift | `Package.swift`, Sources and Tests | Full happy path; Swift source and anchors preserved. |
| HP-10 | C++ | `CMakeLists.txt`, `.cpp`/`.hpp`, helper and test | Full happy path; both header and implementation changes reviewable. |

## Diff and checkout cases

| ID | Setup and action | Expected result |
| --- | --- | --- |
| D-01 | Change a tracked file and add an untracked file; open default review. | Both appear against HEAD; unrelated ignored files do not appear. |
| D-02 | Stage one edit, leave another unstaged, add an untracked file; open `--staged`. | Only the staged patch appears; file preview and Graph use the index version. |
| D-03 | Compare a feature branch with an explicit base, with and without `--merge-base`. | Correct base revision and patch for each comparison; branch mode is labelled accurately. |
| D-04 | Launch from a subdirectory of a linked worktree. | Correct checkout root and branch; review data belongs to this worktree, not another checkout. |
| D-05 | Use a clean checkout, clean staged comparison and the wrong checkout in turn. | Accurate path and empty reason; no changes invented and no implicit approval. |
| D-06 | Open a repository without commits, a detached HEAD and a missing explicit base. | Unborn changes and detached identity work; invalid base is an actionable error. |
| D-07 | Rename a file, including rename plus content edits, and delete another file. | Correct old/new paths, statuses and line sides; deleted content remains inspectable. |
| D-08 | Modify a binary, empty file, file above the preview limit and file mode only. | Accurate notes and statuses; no invalid line-comment controls. |
| D-09 | Use spaces, Unicode, tabs, newlines, quotes and leading dashes in Git paths. | Exact paths survive Git, JSON, UI and review round trips; no shell interpretation. |
| D-10 | Change CRLF/LF files, no-final-newline files and Unicode text. | Patch and old/new line numbers remain accurate; source is not mangled. |
| D-11 | Open a mixed-language monorepo. | All changed files stay visible; ambiguous roles remain unclassified rather than guessed. |
| D-12 | Change a file after adding comments, then send without refreshing. | Stale submission rejected; draft retained; user prompted to review latest changes. |
| D-13 | Advance HEAD after submitting a review, then reopen it. | Original snapshot/base stay frozen; latest inspection is a separate, accurate view. |
| D-14 | Select Refresh latest changes when files have not changed, then after a real edit. | No-change explanation is visible in the first case; a new patch/revision appears in the second. |

## Review and thread cases

| ID | Setup and action | Expected result |
| --- | --- | --- |
| R-01 | Add, edit and delete comments on added, removed and context lines. | Correct file/line/side and text; deleted draft comments are not sent. |
| R-02 | Add a general instruction without line comments; submit. | One valid review reaches the agent; reply target `review` works. |
| R-03 | Submit no feedback, whitespace-only feedback, invalid anchor or duplicate comment IDs. | Explicit validation failure with no saved partial review or success notification. |
| R-04 | Double-click Send or race two submissions. | Exactly one saved review and one feedback delivery; second attempt is rejected predictably. |
| R-05 | Submit feedback and delay the agent response. | Dialog closes after submission; success visible; Pending means awaiting reply, not a claim that the model is running. |
| R-06 | Reply to one of several comments, then reply to the others. | Each reply reaches the correct thread; Pending clears independently, with no manual reload. |
| R-07 | Save concurrent replies from Codex and Claude, including multiple replies per comment. | No overwrite, duplication or cross-thread mix-up; stable display order. |
| R-08 | Return `addressed`, `needs_input`, `not_changed` and `note`. | Correct status text; a response alone never auto-resolves the reviewer's thread. |
| R-09 | Reviewer resolves and reopens a thread before and after an agent reply. | Correct local state and send eligibility; agent reply and original text remain intact. |
| R-10 | Approve with no change request; cancel in a separate run. | Distinct outcomes reach the agent; neither outcome authorizes a commit, merge or push. |
| R-11 | Inspect agent changes and approve using a stale revision, then the current revision. | Stale approval rejected; valid completion stored separately without rewriting the original request. |
| R-12 | After approval, add new feedback and send a second round in the same agent context. | UI accepts feedback; new review is saved and demonstrably reaches the owning agent; previous history remains saved. See baseline risk B-02. |
| R-13 | Send an invalid reply target/agent/status, or fail to write the reply. | Clear CLI failure; no false claim of delivery or unrelated thread modification. |
| R-14 | Reload during draft editing and after submission; reopen a saved review on a new port. | Draft survives same-origin reload; submitted data survives viewer restart. Browser-only state is not assumed portable across ports. |

A human-authored nested reply field is not implemented today. R-09 covers Resolve/Reopen and R-12 covers new feedback. If “reviewer replies” means new text inside an already-submitted thread, that is an additional interaction to specify and approve rather than silently claim as existing coverage.

## Agent installation and host cases

| ID | Setup and action | Expected result |
| --- | --- | --- |
| A-01 | Fresh install for Codex and Claude independently, then `install all`. | Each reports actual version, source and enabled status; skill discoverable after the documented restart. |
| A-02 | Codex fails or is missing; repeat with Claude failing. | The other installation is attempted; each result is reported; overall command indicates failure when either fails. |
| A-03 | Existing registration points to old `trace` Cellar or obsolete `trace-review` Cellar. | Only recognized Trace migration is repaired; stable `opt/trace-review/libexec` source is used. |
| A-04 | Installed plugin disabled, stale version, stale manifest, or unrelated marketplace source. | Explicit issue reported; no false success and no unrelated source overwritten. |
| A-05 | Invoke the real skill from Codex's `$` picker and Claude Code's command. | Correct project/context and actual feedback return to the initiating conversation; no duplicate model process. |
| A-06 | Claude Desktop preview never acknowledges rendering. | After the configured fallback delay, open exactly the same local URL externally; one viewer and one review only. |
| A-07 | Preview acknowledges successfully; separately, preview fails after acknowledgement. | No automatic duplicate open on success; the documented exact-URL external fallback can recover the latter case. |
| A-08 | Use another agent session on the same repository or another checkout simultaneously. | Session IDs, reviews, pending state and shutdown remain isolated; one session cannot consume another's feedback. |

## Session and process cases

Run host lifecycle cases for both agents. Event simulation establishes Trace's handler behavior; live host runs must separately establish that the relevant event is actually emitted and trusted.

| ID | Setup and action | Expected result |
| --- | --- | --- |
| L-01 | End the session normally before sending feedback. | Viewer exits, active connections close and port can be rebound; no approval is inferred. |
| L-02 | Send feedback, receive a reply, then exit the owning session. | Viewer remains usable during the session and shuts down at session end; saved review survives. |
| L-03 | `/clear` before submission and after submission, with same and replacement session IDs. | Old viewer closes in both cases; new context does not inherit ownership or stale feedback. |
| L-04 | Compact the context manually and through a simulated automatic compact event. | Existing viewer stays alive and ownership token is preserved; no accidental reset of review data. |
| L-05 | Kill the actual detected owning agent process without SessionEnd. | Monitoring closes the viewer and releases the port; unrelated sessions remain usable. |
| L-06 | Deliver SessionEnd when agent PID cannot be detected. | Lease invalidation still closes the viewer. Report that crash detection cannot be proven from an unavailable owner PID. |
| L-07 | Disable/untrust hooks or launch `--wait` without an active lease. | Clear diagnostic; browser activity keeps an unbound viewer available across reloads; inactivity or detected owner exit closes it. Updated by the reviewer’s 9 November bug-fix request; session hooks still close bound viewers on session end. |
| L-08 | Interrupt the waiting CLI with SIGINT/SIGTERM or reach its configured review timeout. | Viewer cleaned up; distinct non-success exit/event; no fabricated feedback or approval. |
| L-09 | Lose the parent IPC connection before submission and after a session-bound submission. | Before: cleanup. After: active session viewer stays available until its own lifecycle ends. |
| L-10 | Race SessionEnd with startup, graph construction or review submission. | No leaked process/port, unhandled rejection, duplicate completion or reported unsaved success; any fully saved review can be recovered. |
| L-11 | Close only the browser tab; reopen the URL while the session is still active. | Session-bound viewer remains available; closing a tab is not session termination. |
| L-12 | Repeatedly start/end sessions and run multiple viewers in one session. | All viewers of the ended session close; no increasing count of listening ports or live child processes. |

## Network and recovery cases

Trace's local HTTP connection and the agent provider's remote connection are different failure domains. A deterministic fake agent can simulate provider failure but cannot certify how the real provider displays it.

| ID | Setup and action | Expected result |
| --- | --- | --- |
| N-01 | Delay `/api/session`, then return a valid diff or empty result. | Loading is visible first; empty state appears only after a valid empty response. |
| N-02 | Fail or disconnect the initial diff request; restore the server and retry. | Actionable error and working retry; no misleading No changes state or lost draft. |
| N-03 | Server rejects submission or connection fails before persistence. | No success claim; feedback retained and retry possible; no duplicate review. |
| N-04 | Persist a review but lose the HTTP acknowledgement. | Saved review is recoverable, not auto-resubmitted as a duplicate; UI reconciles server truth. See B-03. |
| N-05 | Disconnect reply polling, then restore the viewer. | Visible disconnected status; existing threads retained; polling recovers without duplicate replies. |
| N-06 | Delay, fail, or return an invalid response from Graph while diff is loaded. | Files remain usable; Graph has its own error/retry and no stuck loading state. |
| N-07 | Agent provider connection fails, authorization expires, or agent exits before replying. | Saved feedback remains readable; no fabricated fix or completed status; lifecycle cleanup follows actual session state. |
| N-08 | Disconnect public internet while local review is open. | Local diff, Graph and comment persistence work without CDN/model access; actual agent execution is reported separately. |

## Graph data cases

Use independently authored expected relationship manifests. Every case checks source, target, relation kind and change marker, plus the relevant node/path/source version. Never derive expected edges by calling the production parser.

| ID | Setup and action | Expected result |
| --- | --- | --- |
| G-01 | Open Graph on every language fixture without choosing a node. | Initially show changed, unviewed file nodes; no invented context or dependencies. |
| G-02 | JS ESM import, CommonJS require and re-export with a resolvable relative target. | Correct Imports edges; package/external or unresolved targets do not become invented local files. |
| G-03 | JS/TS imported function is called; control fixture imports without a call. | Calls edge only for supported call evidence; Imports and Calls remain distinct. |
| G-04 | TS explicit `import type`, mixed type/value syntax and use of types. | Supported explicit type relation matches the approved manifest; unsupported mixed syntax is documented rather than overclaimed. |
| G-05 | Add or remove one relation; preserve another between two changed files. | Only the added/removed relation receives `+`/`−`; brightness alone never implies the relation changed. |
| G-06 | Change code while leaving a connected test unchanged. | Code bright; selecting it reveals dim unchanged test with a real relation. |
| G-07 | Test file has one target, then two distinct targets. | Preserve one or multiple detected targets; no forced one-edge limit. |
| G-08 | Use explicit unit/integration/e2e directory mappings and an ambiguous `.test` file. | Correct configured/conventional colours; ambiguous kind remains unclassified. Vitest project auto-parsing is not assumed implemented. |
| G-09 | Resolve extensions/index files and `.js` references to TS sources. | Correct existing local target for supported variants; no duplicate alias node. |
| G-10 | Rename a dependency and delete another file. | One rename identity with both paths; correct relation identities and previous source for deletion. |
| G-11 | Review staged content that differs from both HEAD and the working file. | Graph uses base versus index, and contextual preview matches that version. |
| G-12 | Edit an unchanged contextual file after a Graph build and request a rebuild. | Context source/relations refresh; unchanged Git blobs can still be reused safely. |
| G-13 | Diamond, cycle, shared dependency, disconnected file and mixed-language repository. | No lost nodes or self-invented connections; relationships not drawn in the tree remain discoverable in the connection list. |
| G-14 | Include comments, strings, external packages, path aliases, dynamic expressions and unavailable files. | No claimed semantic certainty or invented dependency; unsupported forms and parser false positives are reported as baseline gaps. |
| G-15 | Build a 481-file fixture cold, warm and after a real edit. | For the existing 481-total-file, one-changed-file fixture: diff never waits for Graph, zero `git show` calls and fewer than 30 Graph Git processes on a cold build; warm immutable blobs reused; changed context not stale. |
| G-16 | Concurrent Graph requests, a failed build followed by retry, and a changed revision while a response is in flight. | Requests share a build for the same revision; retry can recover; old results never overwrite the new diff. |
| G-17 | Open a saved review whose working tree has since changed. | No silently mismatched historical Graph; either saved Graph or explicit mismatch with latest-inspection path. |

### Approved Graph language scope

Decision recorded on 2026-11-07: preserve current Graph support during refactoring. For all ten language fixtures, verify changed nodes, statuses, selection and the correct diff/source version, including rename/delete previews. For Java, Kotlin, Go, Python, Rust, C#, Swift and C++, do not require language-derived dependency edges or invent them. Dependency-specific G cases and connected-context interactions use JS/TS fixtures; mixed-language cases assert only supported discovered relationships.

The eight future language discovery contracts are tracked separately in [Graph dependency discovery for additional languages](graph-language-support-task.md). They are not refactor acceptance gates.

## Graph browser interaction cases

| ID | Setup and action | Expected result |
| --- | --- | --- |
| UI-G-01 | Select two changed nodes in sequence while file detail is open. | Right panel opens immediately and updates source/diff for each selection; no close/reopen workaround. |
| UI-G-02 | Select unchanged context, then its neighbour, and a deleted file. | Existing context retained with links; Preview / Not part of this diff label; deleted file shows previous content. |
| UI-G-03 | Select/reveal/filter nodes repeatedly. | Node coordinates do not change from selection; viewport may pan to centre selection without changing zoom. |
| UI-G-04 | Drag a node, then click, select another node and resize the detail panel. | Drag position retained, accidental click suppressed, panel clips Graph without rescaling it. |
| UI-G-05 | Use zoom +/- and pinch; reach min/max; pan. | Correct limits and anchor; no accidental page zoom; supported trackpad gestures have a live hardware smoke check. |
| UI-G-06 | Reset an expanded/dragged/zoomed/searched Graph. | Initial changed-only layout and 100% zoom restored; details close; comments and Viewed are not erased. |
| UI-G-07 | Mark Viewed in Graph and reset Viewed from Graph/Files. | Viewed node disappears; reset returns eligible nodes; Files state stays consistent. |
| UI-G-08 | Add, delete, resolve/reopen comments and switch between views. | Badge count follows the existing agreed counting rule (all retained comments for that file), with the red design token; no duplicate count on reply polling. |
| UI-G-09 | Display parallel relation kinds, shared parents and a cycle. | Distinct ports/lanes where supported; nodes do not overlap and curated fixture edges avoid unrelated node rectangles; no promise that all arbitrary graphs are crossing-free. |

## Files, Find Usages and shared UI cases

| ID | Setup and action | Expected result |
| --- | --- | --- |
| UI-01 | Mark Viewed in Files, switch modes, then Reset Viewed. | Viewed file collapses to its header; Graph hides it; reset restores files/nodes without deleting feedback. |
| UI-02 | Resize/collapse the sidebar and scroll past the review toolbar. | Width constraints and collapsed width respected; toolbar sticks below the header. |
| UI-03 | Search filenames, switch Files/Graph, toggle theme and reload. | Matching files and counts correct; appropriate state persists on the same origin; light/dark text remains readable. |
| UI-04 | Click an identifier or use Cmd+click / Option+F7. | Usage list opens; metadata/code colours remain distinct; matching tokens and lines highlighted; result jumps to exact line. |
| UI-05 | Search a name on old and new diff sides, with substring/string/comment controls. | Same-side identifier matches only; no match outside displayed diff; no semantic symbol-resolution claim. |
| UI-06 | Use idiomatic comments, strings, keywords and standard globals in every language fixture. | No false clickable syntax/global/comment content under the approved tokenizer contract; unsupported lexer forms are exposed before refactor. See B-04. |
| UI-07 | Switch selection, close Usages, navigate to a Viewed file and refresh diff. | Correct highlights reset/reapply; target line visible; no stale result pointing at another revision. |
| UI-08 | Load each extracted ES module directly through the real server after refactor. | Correct status/MIME/CSP handling; imports load in both browsers with no console errors or extra global state required. |

## Boundary and compatibility cases

| ID | Setup and action | Expected result |
| --- | --- | --- |
| C-01 | Missing token, wrong Origin/Host, or cross-site mutation. | Rejected request; no review changes. Preserve current protections through service extraction. |
| C-02 | Malformed/oversized JSON, oversized comment/instruction, invalid review ID. | Bounded actionable error; no crash, partial success or unrelated file access. |
| C-03 | HTML-like text in source, path or comment. | Rendered as text; interactions still work after module extraction. |
| C-04 | Git unavailable, Xcode licence failure or repository disappears. | Correct fallback where configured, otherwise actionable error; comment draft not discarded. |
| C-05 | Release CLI/manifests and Homebrew stable path verification. | Matching versions; installed source remains stable across upgrade; tests and browser dependencies excluded from runtime requirements. |

## Existing coverage and risks to resolve before refactoring

The existing suite contains 47 tests, primarily pure-function and backend/CLI integration tests. It already covers selected Git variants, stale/duplicate submissions, saved snapshots/replies, approval continuation at HTTP level, partial installer failures, session lease handling, graph layout and batched reads. Keep these tests. Existing coverage is partial for the larger cases above, not proof that each row already passes.

| ID | Baseline gap or risk from code inspection | Required disposition |
| --- | --- | --- |
| B-01 | Graph relationships outside JS/TS are not implemented. | Scope resolved: preserve JS/TS dependency discovery; test nodes/previews for the other languages. Future GX cases are tracked in the separate deferred task and do not block refactoring. |
| B-02 | The waiting CLI and viewer use one-shot feedback listeners; post-Approve continuation has HTTP coverage but no proof of second-round delivery to the same live agent. | Write a full lifecycle acceptance test before refactoring. Saving round two alone does not count as delivery. Report/fix any defect separately. |
| B-03 | Accepted submission with a lost HTTP response has no established browser recovery test. | Establish persistence/reconciliation behavior with fault injection; do not assume exactly-once delivery from a successful server write. |
| B-04 | The tokenizer defaults to JS rules for Go/C++; Python `#` comments and language-specific multiline/raw strings need native fixtures. | Expose unsupported cases. Agree the minimum lexical contract or separately fix lexer bugs before making a universal support claim. |
| B-05 | SessionEnd/clear tests largely simulate hooks; owner discovery and actual host event/trust behaviour are not covered end to end. | Live tests for both agents, including clear with new IDs, normal exit, crash and multiple sessions; report unavailable host capabilities. |
| B-06 | There is no full browser interaction suite, and the server currently allowlists each frontend module. | Establish browser coverage before extraction; UI-08 protects newly extracted module serving. |

## Execution and refactor gates

1. Test implementation approved on 7 November 2026. Graph scope remains current JS/TS dependency discovery only. Nested human-authored replies are outside the existing interaction contract.
2. Implement deterministic integration and browser tests against unchanged 0.5.2 behavior. Record baseline failures and known support limits. Run the live matrix with actual hosts separately; report versions and results.
3. Make separately approved bug fixes needed for the agreed acceptance contract. Re-run the same tests; do not hide defects inside file moves.
4. Extract frontend state first, then API access, then rendering/controllers in small reviewable changes. Keep endpoint payloads, persistence keys and user-visible behavior stable. Keep dependency direction explicit to avoid circular imports.
5. Extract review operations (submit, inspect latest, approve, continue) from HTTP handlers into a service. Keep transport checks and HTTP mapping in the server and persistence in the existing storage module. Keep the real HTTP/CLI tests as external contracts.
6. Re-run deterministic tests after each extraction; run browser and live acceptance again on the final candidate. No release is implied by approval of this test plan.

Priority P0: HP-01–10 (both agents), D-01–07 and D-12–14, R-01–14, A-02/05/06/08, L-01–12, N-01–08, G-01–07 and G-10–17, UI-G-01–09, UI-01 and UI-04–08, and C-01/02/05. Priority P1: all remaining current-scope cases. GX-01–08 are excluded from this plan and tracked in the separate deferred product task.

Acceptance is every approved P0 and P1 case green, all 47 existing tests green, required browser flows green, and an explicit per-stack/agent report. A staged schedule requires explicit reviewer agreement; cases are not silently dropped. No blanket “all stacks work” claim is allowed for an unrun live matrix or unsupported Graph semantics.

Before and after must match on diff contents/anchors, approved Graph manifests, submission/approval outcomes, reply delivery, storage compatibility, loading/errors and resource cleanup. The release must have no known dropped feedback or leaked owned viewer ports in the tested lifecycle paths. Any failure is reported with reproduction steps and scope rather than waived by a retry.
