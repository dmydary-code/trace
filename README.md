# Trace

Review local Git changes in a browser, leave comments on exact lines, and send the feedback back to the coding agent working on your project.

## Install with Homebrew

```sh
brew tap dmydary-code/trace https://github.com/dmydary-code/trace.git
brew install dmydary-code/trace/trace
trace-review install all
```

The repository is currently private. Your Git client needs access to `dmydary-code/trace`. Before adding the tap, authenticate with `gh auth login` and configure Git with `gh auth setup-git --hostname github.com`. This also lets Homebrew fetch the private release source without an interactive password prompt. The formula installs the CLI and bundled plugin definitions. `trace-review install all` registers the plugin with both installed agents using their native plugin commands. Use `trace-review install codex` or `trace-review install claude` to install just one integration. Install and authenticate the agents separately.

Restart the agent after installation. In Claude Code, invoke `/trace:review`. In Codex, select Trace's `review` skill from the skill picker, or ask “Use Trace to review my changes.” Run the agent inside the project you want to review.

The primary command is `trace-review`. A `trace` alias is also installed, but macOS has a system utility with that name; the plugins use `trace-review` to avoid PATH collisions.

## Agent review loop

1. The agent runs `trace-review review --wait --json --no-open` in the project and shows the local URL.
2. Review the actual Git diff. Switch between **Files** and **Change route**, search files, and mark them viewed.
3. Click **+** beside an old or new line to write feedback. Open **Send to agent** and submit the review.
4. The waiting command returns the structured feedback to the same agent conversation. That agent applies the requested edits using its existing context and permissions.

A review can also finish without requested changes or be cancelled. Neither outcome authorizes a commit, merge, push, or deployment. Closing the browser does not submit a review.

The normal loop does not start another model, require an API key, or upload code. The existing agent handles the returned feedback under its own settings. Trace stores submitted reviews in the current worktree's Git metadata directory under `trace/`; these files are outside the project working tree.

## Standalone CLI

```sh
cd /path/to/project
trace-review                    # Open working-tree changes against HEAD
trace-review --staged                  # Staged changes only
trace-review --base origin/main --merge-base  # Branch/MR-style baseline
trace-review --repo /path/to/project --no-open
trace-review feedback --json           # Retrieve the latest submitted review
trace-review doctor                    # Check Git, repository, and installed agents
```

`--base REF` resolves and freezes the baseline at startup. Without `--merge-base`, it is a direct tree comparison. Working-tree review includes staged, unstaged, and untracked non-ignored files. `--staged` excludes unstaged/untracked changes. Remote refs must already be fetched; Trace never fetches or modifies Git's index.

Renames, deletions, binary files, empty files, and mode changes remain visible. Binary files have no line comments. Untracked text previews larger than 1 MiB are summarized. Symlink previews show their target without reading the target file. Large tracked diffs over the 32 MiB process limit produce an error instead of silently disappearing.

For automation, `--wait --json` prints newline-delimited events: `ready` with the URL/session ID, then `feedback` with outcome, revision, anchors, instructions, and saved review path. It exits after submission. The default timeout is 1800 seconds; set `--timeout 0` for no limit. Exit codes: 0 submitted, 1 error, 2 timeout, 3 cancelled, 130 interrupted. Match the `sessionId` when recovering a result with `trace-review feedback` so old feedback is not mistaken for a new submission.

Each server accepts one submission. Start a new review after the agent edits the code. Browser drafts are scoped by repository and revision; changed revisions do not automatically inherit old line anchors. The OS chooses an available loopback port unless `--port` is provided; browser draft storage is also scoped to that origin.

### Optional separate agent

```sh
trace-review --agent codex
```

This explicitly starts a separate `codex exec` process on submission with the `workspace-write` sandbox. It is independent of the calling conversation and cannot be combined with `--wait`. The Codex and Claude plugins use the same-session feedback loop instead.

## Automatic change routes

There are no project, stack, or architecture selectors. Trace uses nearby package manifests, file extensions, imports, decorators, and path conventions to identify each changed file's role. Monorepository packages can have different stacks in one review.

Supported signals include React, Vue, Angular; NestJS, FastAPI, Spring; Android, SwiftUI/UIKit, and Flutter. Backend routes default to contract → implementation → consumers → tests. Clean/hexagonal and event-flow reading orders require multiple matching roles. Mobile routing recognizes state holders and reducer/action conventions. Unknown or ambiguous files remain visible under **Other changes**.

These are heuristic reading suggestions, not AST resolution, a dependency graph, or proof of architecture. Detection currently reads package manifests from the working tree, including during staged review. MVVM and unidirectional data flow can coexist; reading order does not enforce a single architecture. See [the route analysis](docs/review-routes.md).

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

Tests exercise actual temporary Git repositories, diff anchors, automatic package detection, stale and duplicate feedback rejection, persisted reviews, same-process CLI handoff, and the optional Codex adapter with a fixture executable. They do not call a live model.

## Distribution maintenance

The repository doubles as a Homebrew tap. `Formula/trace.rb` pins a release tag and Git revision. Plugin marketplaces for Codex and Claude Code are bundled with the CLI. After `brew upgrade`, run `trace-review install all` again to refresh the agent's cached skill, then restart the agent.

Plugin formats follow the [Codex plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) and [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference). Homebrew distribution follows the [tap documentation](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap).
