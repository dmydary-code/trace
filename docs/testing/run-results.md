# Trace test run results

Date: 7 November 2026. Product baseline: Trace 0.5.2 (`de6659e`); repository HEAD `a49a22c`. Execution host: macOS ARM64. Product code was not changed.

| Suite | Result |
| --- | --- |
| Node 20.20.2 regression | 130 passed, 0 failed |
| Node 22.23.4 regression | 130 passed, 0 failed |
| Chromium and WebKit through Playwright 1.65.0, Node 22 | 88 passed, 0 failed |
| Additional edge-versus-node geometry assertions, both browsers | 2 passed (subset rerun) |
| Desired-behavior Node acceptance contracts | 8 failed, 0 skipped |
| Lost-acknowledgement browser acceptance, both browsers | 2 failed, 0 skipped |

The regression count includes the 47 pre-existing tests. The ten failing acceptance assertions represent [eight baseline defect categories](baseline-defects.md). They execute normally and return nonzero exit codes; failures are not inverted or suppressed. The regression suite passing does not establish that all acceptance requirements pass.

The 20-combination language/agent-identity matrix uses real Trace CLI handoff, Git, HTTP, persistence, replies, approval and port cleanup, with a deterministic participant applying the requested source correction. The browser matrix repeats that path for ten languages and both agent identities in both browser engines. It is not a real Codex/Claude model run.

[Coverage for all 105 approved case IDs](coverage.md) identifies automated, partial and manual checks. A [human-assisted live runner](README.md#actual-codex-and-claude-sessions) is available for disposable real agent sessions. It was not executed here. Desktop skill discovery, real host clear/exit/crash events, provider outages, physical trackpad behavior and native application builds are not certified by these runs. Linux/Node CI jobs are configured but have not been pushed or executed.

Playwright is a pinned test-only dependency. No runtime dependencies, agent configuration, installed plugins, product modules, release versions or Homebrew formula were changed. Refactoring and defect fixes remain outside this task. The files have not been committed or published.
