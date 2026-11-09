# Running Trace acceptance and regression tests

The suite started against Trace 0.5.2. Trace 0.5.3 includes the [9 November review interface fixes](review-fixes-results.md); architectural refactoring has not started. The [7 November baseline report](run-results.md) records the original test-only run. [Coverage](coverage.md) distinguishes automation, known failures and live checks; [the approved cases](refactor-test-plan.md) remain the acceptance contract.

## Commands

```sh
npm ci
npm test
npx playwright install chromium webkit
npm run test:browser
npm run test:acceptance
npm run test:browser:acceptance
npm run test:all
```

`npm test` runs the original tests plus deterministic Git/HTTP/CLI integration tests. `test:browser` runs the real interface in Chromium and WebKit. The language matrix uses native project fixtures for JavaScript, TypeScript, Java, Kotlin, Go, Python, Rust, C# (`csharp`), Swift and C++ (`cpp`) with both agent identities.

The agent in the deterministic matrix is a protocol participant: real Trace commands return feedback and save replies; the test applies a known source correction. It does not invoke Codex/Claude models and does not establish real host/plugin behavior. Native language compilers are not required; these tests verify Trace, not a successful application build.

Playwright is pinned as a dev dependency only. The Homebrew runtime still uses the same dependency-free product code. Node 20 and Node 22 are covered by the CI matrix on Linux and macOS; browser jobs use Node 22.

## Baseline failures are explicit

`test:acceptance` contains the remaining desired contracts that expose baseline defects. `test:browser:acceptance` also runs any browser cases tagged @acceptance; it succeeds with no tests when no unresolved browser-only cases remain. They execute assertions and return a nonzero exit status on failures. They are not skips or tests that declare failure to be success. A later fix must make the same assertions pass.

`test:all` executes all four suites even if one fails and reports failure if any suite fails. The ordinary CI regression jobs run the first two suites. The workflow-dispatch acceptance gate runs the failing contracts when requested; it is expected to be red until the recorded defects are fixed. A green regression job alone is not approval to refactor or claim all acceptance cases pass.

Each test uses an isolated temporary Git repository, loopback port and session directory. Process fixtures register cleanup before waiting for readiness, and lifecycle cases verify the port can be rebound. No test changes the user's installed agent plugins or config. Installer tests inject command adapters instead of performing real installations.

## Browser evidence

Browser failures retain a screenshot and Playwright trace under ignored `test-results/`; the HTML report is under ignored `playwright-report/`. Network traces can contain fixture source, comments and ephemeral local tokens. Treat traces as private debugging artifacts. JSON matrix attachments contain no token. The test sessions and ports are closed after each case. Do not attach traces publicly without review/redaction.

No retries are enabled. State transitions are awaited through HTTP/DOM assertions, subprocess events or bounded polling. Test failures must be diagnosed rather than retried into a green report.

## Actual Codex and Claude sessions

A human-assisted runner creates an isolated native project, verifies a real viewer belongs to it, then checks the actual persisted review, exact correction, replies, approval and clear/port cleanup:

```sh
npm run test:live -- typescript codex
npm run test:live -- typescript claude
```

Run each command for all ten language IDs to certify the complete 20-combination live matrix. The runner waits for the operator to launch the actual skill in a separate agent session and paste its exact URL. It does not use API keys, launch paid model calls or mutate agent settings itself. After the run it removes the temporary fixture. Run only in the printed isolated checkout.

For each host, separately record the skill picker/command, plugin and CLI versions, trusted hooks, normal exit, `/clear` before and after submission, context compaction, crash cleanup, multiple-session isolation and desktop external-browser fallback. The interactive runner verifies only the checks named in its JSON output. A physical trackpad pinch requires a hardware smoke check; dispatched browser gesture events establish handler behavior only.

Never run `/clear`, kill processes or change plugin settings in the user's ongoing working session as a test. Use disposable sessions. Record the tested application version and unavailable capabilities instead of marking a simulated run as a live pass.
