# CLI and local behavior

## Installation

Install and authenticate Codex or Claude Code separately. Run `trace-review install codex` or `trace-review install claude` to register just one integration, or `trace-review install all` for both. Restart the agent after installation.

If the repository is private, authenticate a GitHub account with repository access using `gh auth login`, then run `gh auth setup-git --hostname github.com` before installing the Homebrew tap.

After adding the tap, run `brew trust --formula dmydary-code/trace/trace-review` before installation. This trusts only the Trace formula.

To update, run `brew update`, `brew trust --formula dmydary-code/trace/trace-review`, `brew upgrade dmydary-code/trace/trace-review`, and `trace-review install all`, then restart the agent.

The Homebrew package was renamed from `trace` to `trace-review`. Existing installations can run `brew update` and `brew migrate dmydary-code/trace/trace`, then `brew trust --formula dmydary-code/trace/trace-review`, `brew upgrade dmydary-code/trace/trace-review` and `trace-review install all`. Review data stays in each repository’s Git metadata.

## Standalone CLI

```sh
cd /path/to/project
trace-review                    # Open working-tree changes against HEAD
trace-review --staged                  # Staged changes only
trace-review --base origin/main --merge-base  # Branch/MR-style baseline
trace-review --repo /path/to/project --no-open
trace-review feedback --json           # Latest submitted review, including replies
trace-review feedback --review ID --json # A specific saved review
trace-review open --review ID           # Reopen its original diff and threads
trace-review doctor                    # Check Git, repository, and installed agents
```

`--base REF` resolves and freezes the baseline at startup. Without `--merge-base`, it is a direct tree comparison. Working-tree review includes staged, unstaged, and untracked non-ignored files. `--staged` excludes unstaged/untracked changes. Remote refs must already be fetched; Trace never fetches or modifies Git's index.

Renames, deletions, binary files, empty files, and mode changes remain visible. Binary files have no line comments. Untracked text previews larger than 1 MiB are summarized. Symlink previews show their target without reading the target file. Large tracked diffs over the 32 MiB process limit produce an error instead of silently disappearing.

For automation, `--wait --json` prints newline-delimited events: `ready` with the URL/session ID, then `feedback` with outcome, revision, anchors, instructions, and saved review path. The calling command exits after submission. Its local HTTP viewer stays available for one hour to receive threaded replies, then stops automatically. Reopen the saved review with `trace-review open --review ID`. No model process is kept alive by the viewer. The default timeout is 1800 seconds; set `--timeout 0` for no limit. Exit codes: 0 submitted, 1 error, 2 timeout, 3 cancelled, 130 interrupted. Match the `sessionId` when recovering a result with `trace-review feedback` so old feedback is not mistaken for a new submission.

Each server accepts one submission. After submission it serves the saved diff, original line anchors and replies, even if the working tree changes. Use Review latest changes to inspect the updated code and Approve to complete the review. Approval is stored in `completion`, separately from the original feedback outcome, with the inspected revision and a saved snapshot. Start a new review to request further changes. Existing schema-1 reviews remain readable via `feedback`, but do not have a saved snapshot or stable thread IDs; start a new review to use threaded replies. Browser drafts are scoped by repository and revision; changed revisions do not automatically inherit old line anchors. The OS chooses an available loopback port unless `--port` is provided; browser draft storage is also scoped to that origin.

### Optional separate agent

```sh
trace-review --agent codex
```

This explicitly starts a separate `codex exec` process on submission with the `workspace-write` sandbox. It is independent of the calling conversation and cannot be combined with `--wait`. The Codex and Claude plugins use the same-session feedback loop instead.

## Git on macOS

The Homebrew package installs Git as a dependency and selects it explicitly, so Trace does not depend on Apple's Xcode Git launcher. For source installs, `TRACE_GIT_BIN=/absolute/path/to/git` selects a Git executable. When the default Git reports an Xcode license error, Trace tries Homebrew Git in the standard macOS locations.

If no working Git is available, Trace shows recovery instructions. Install Git with `brew install git`, or review and accept Apple's license yourself in Xcode, then retry the review submission. A failed submission does not close the review or clear its comments.

## Local behavior

Trace binds only to `127.0.0.1`. Review submission requires the matching Host, Origin, and per-session token. The server rechecks the Git revision and line anchors before accepting feedback. It does not serve arbitrary repository files or execute repository scripts. Refresh the diff if code changes during review.

Framework detection reads manifests; it never runs package install hooks. Review comments and source snippets are escaped in the browser. The CLI itself does not edit project files. Agent edits happen only after review feedback is submitted to that agent.

## Development and validation

Requires Node.js 20+ and Git. Runtime has no npm dependencies and no build step.

```sh
node bin/trace.mjs --repo /path/to/project
npm test
claude plugin validate plugins/trace
claude plugin validate .
```

Tests exercise actual temporary Git repositories, diff anchors, automatic package detection, stale and duplicate feedback rejection, persisted reviews, same-conversation CLI handoff, and the optional Codex adapter with a fixture executable. They do not call a live model.

## Distribution maintenance

The repository doubles as a Homebrew tap. `Formula/trace-review.rb` pins a release tag and Git revision. Plugin marketplaces for Codex and Claude Code are bundled with the CLI. After `brew upgrade`, run `trace-review install all` again to refresh the agent's cached skill, then restart the agent.

Plugin formats follow the [Codex plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) and [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference). Homebrew distribution follows the [tap documentation](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap).

## Reply to an inline thread

```sh
trace-review reply --review REVIEW_ID --comment COMMENT_ID \
  --agent codex --status addressed --body-file /path/to/reply.txt
```

Run this in the reviewed repository, or add `--repo PATH`. Use `--agent claude` for Claude Code. The body is plain text; `--body-file -` reads stdin. The command records a reply, not an instruction to start a model. IDs come from the submitted feedback JSON. Use `--comment review` for general instructions.

Statuses: `addressed`, `needs_input`, `not_changed`, `note`. These are agent-reported outcomes, not proof that checks passed. The reviewer controls Resolve in the UI. Replies are stored as immutable files, so simultaneous replies cannot overwrite one another. The viewer polls for replies every 1.5 seconds without replacing the diff or moving the reading position.

Submitted threads are read-only apart from the browser-local Resolve marker. Start a new review for further feedback on edited code. Automatic re-anchoring and two-way follow-up messages within a submitted thread are not implemented.

## Claude Desktop preview fallback

The review skill launches `trace-review review --wait --json --no-open --browser-fallback --repo /absolute/project/path`. Open the exact URL from the ready event in the Desktop Browser pane. If the page cannot confirm that it loaded and rendered the diff within eight seconds, Trace opens that same URL in the default external browser. This preserves one viewer and the original feedback session. A later failure can be handled by opening that exact URL externally; do not start another server.

The review shows the absolute repository path, comparison base and mode, and whether it is a linked worktree. An empty diff explains staged-only filtering or a clean/current comparison; check that the agent and Trace use the same checkout. A committed change needs a suitable `--base` instead of the default HEAD comparison.

## Verified plugin installation

`trace-review install all` attempts Codex and Claude independently, prints a result for each, and exits nonzero if either fails. It verifies the installed plugin version, enabled state, source registration and manifest. Homebrew installs register `/opt/homebrew/opt/trace-review/libexec` (or the corresponding Homebrew prefix), rather than a versioned Cellar directory. Known old Trace Homebrew sources can be repaired automatically; unrelated marketplace sources are reported instead of replaced. Restart the app or start a new session after a successful install.

## Release version checks

Use `npm version <version>` to update the CLI and both plugin manifests together through the version lifecycle hook. `npm run sync-versions` synchronizes manifests after an intentional manual package version edit. `npm test` rejects mismatched CLI/plugin versions before release. Publish the code tag, then update the Homebrew formula to that tag and commit as usual.
