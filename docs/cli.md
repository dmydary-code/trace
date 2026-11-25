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
trace-review --standalone              # Collect feedback locally for later retrieval
trace-review feedback --json           # Latest submitted review, including replies
trace-review feedback --review ID --json # A specific saved review
trace-review open                       # Reopen the most recent submission with its replies
trace-review open --review ID           # Reopen its original diff and threads
trace-review doctor                    # Check Git, repository, and installed agents
```

`--base REF` resolves and freezes the baseline at startup. Without `--merge-base`, it is a direct tree comparison. Working-tree review includes staged, unstaged, and untracked non-ignored files. `--staged` excludes unstaged/untracked changes. Remote refs must already be fetched; Trace never fetches or modifies Git's index.

Renames, deletions, binary files, empty files, and mode changes remain visible. Binary files have no line comments. Untracked text previews larger than 1 MiB are summarized. Symlink previews show their target without reading the target file. Large tracked diffs over the 32 MiB process limit produce an error instead of silently disappearing.

Both `review` and `open` listen for the whole conversation by default. `--listen` selects the same mode explicitly. With `--json`, the command emits one `ready` event with the URL and session ID, followed by a `feedback` event for each submission. Keep the command running and read its output between replies. Use `--standalone` to open a viewer and retrieve feedback later with `trace-review feedback --json`.

Use `review --once --json` for automation that needs the command to exit after the first submission. Older plugins that pass `--wait` in Codex or Claude still get a continuous listener. Outside an agent session, `--wait` remains an alias for `--once`.

Session hooks tie the viewer to the agent session and detect context clearing. The browser sends heartbeats while it is active. Use `--viewer-idle-timeout SECONDS` to change the default two-minute inactivity limit for a listener or an unbound one-submission viewer. Set `--timeout 0` to wait indefinitely for the first message instead of the default five hours. Exit codes are 0 for completion, 1 for error, 2 for timeout, 3 for cancellation, and 130 for interruption. When recovering feedback, match its `sessionId` to the original viewer.

**Working tree** opens the original CLI comparison. **Commits** lists first-parent commits oldest first. An explicit base defines the range. Otherwise Trace uses the common ancestor with the remote default branch (or local main/master) on feature branches. On the default branch it starts with up to 20 recent commits. The starting boundary stays fixed in this viewer. The initial commit compares against the empty tree and merge commits compare against their first parent. **Overall** compares the range baseline with the current working tree, or the index for staged reviews.

Use **Approve** in the header to save an approved outcome for the displayed revision, end the local viewer and release its port. A connected listener receives the approval before it exits. Approve is also available in the message and reply dialogs. Clicking it during loading or submission queues one approval until the current operation finishes. Unanswered comments and empty diffs can be approved. If the code changes before approval, Trace refreshes the diff so you can review the new revision and approve it.

In terminal Codex, the Trace plugin uses `--listen` for the full conversation. Enable the Trace lifecycle hooks in `/hooks` after installing the updated plugin. While a bound listener is alive, its Stop hook asks Codex to keep waiting. To recover unanswered messages after losing the shell handle, run `trace-review pending --json` in the owning Codex session. For a saved round, use `trace-review open --review ID --listen`. Use `trace-review stop-waiting` to end listening in this agent session. These commands also accept an explicit `--session-id`.

**Viewed** marks a commit as read. Toggle the checkbox in the diff or directly in the timeline without leaving the current commit. The mark persists per full SHA in this worktree and can be cleared. **Approve commit** saves a separate approval for that SHA. Sending a message and approving a commit are independent. Use the Messages selector to reopen earlier rounds, or Reply to continue at the original anchor. Existing saved reviews remain readable.

### Optional separate agent

```sh
trace-review --agent codex
```

This explicitly starts a separate `codex exec` process on submission with the `workspace-write` sandbox. Use this mode on its own. The Codex and Claude plugins return feedback to the agent that opened Trace.

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

In terminal Codex, a sandbox permission prompt may appear when saving the first reply. Trace identifies the replies directory for that review. After approval, the agent retries the same reply and resumes listening.

Statuses: `addressed`, `needs_input`, `not_changed`, `note`. These are agent-reported outcomes, not proof that checks passed. The reviewer controls Resolve in the UI. Replies are stored as immutable files, so simultaneous replies cannot overwrite one another. The viewer polls for replies every 1.5 seconds without replacing the diff or moving the reading position.

A follow-up preserves its original line, parent message and previous replies. You can add line comments after sending feedback. Use **Send now** on a draft comment to send it individually and keep the rest of the draft for later. The comment arrows and file dots open threads from earlier messages in the same comparison.

Use **Refresh diff** to see edits on disk and **Back to comment threads** to return to the saved version. The arrows inside each file diff expand unchanged lines.

## Claude Desktop preview fallback

The review skill launches `trace-review review --listen --json --no-open --browser-fallback --repo /absolute/project/path`. Open the exact URL from the ready event in the Desktop Browser pane. If the page cannot confirm that it loaded and rendered the diff within eight seconds, Trace opens that same URL in the default external browser. This preserves one viewer and the original feedback session. A later failure can be handled by opening that exact URL externally; do not start another server.

The review shows the absolute repository path, comparison base and mode, and whether it is a linked worktree. An empty diff explains staged-only filtering or a clean/current comparison; check that the agent and Trace use the same checkout. A committed change needs a suitable `--base` instead of the default HEAD comparison.

## Verified plugin installation

`trace-review install all` attempts Codex and Claude independently, prints a result for each, and exits nonzero if either fails. It verifies the installed plugin version, enabled state, source registration and manifest. Homebrew installs register `/opt/homebrew/opt/trace-review/libexec` (or the corresponding Homebrew prefix), rather than a versioned Cellar directory. Known old Trace Homebrew sources can be repaired automatically; unrelated marketplace sources are reported instead of replaced. Restart the app or start a new session after a successful install.

## Release version checks

Use `npm version <version>` to update the CLI and both plugin manifests together through the version lifecycle hook. `npm run sync-versions` synchronizes manifests after an intentional manual package version edit. `npm test` rejects mismatched CLI/plugin versions before release. Publish the code tag, then update the Homebrew formula to that tag and commit as usual.
