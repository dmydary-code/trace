<h1 align="center"><img src="dist/logo.svg" width="28" height="32" alt="Fir tree"> Trace</h1>

Local code review for **Codex and Claude Code**. Explore a dependency graph, comment on the diff, and send actionable feedback back to your agent.

![Trace Graph: reveal unchanged dependencies and tests, inspect code, and leave inline feedback](docs/assets/graph-review.gif)

## See what changed and what it touches

**Graph starts with changed files and reveals connected context when you select a node.** Spot the useful gap: code changed, an existing test covers it, but that test is absent from the diff. Open that test beside the graph and check what it actually verifies.

- **Review in context.** Select a file to open its diff or unchanged source on the right. Imports, calls and type-only imports have distinct lines; test categories have distinct colors.
- **Keep your place.** Expand dependencies without moving existing nodes, drag nodes, zoom with buttons or a trackpad, and resize the file preview.
- **Track the review.** Comment counts appear on nodes. Viewed files leave the graph; Reset graph clears exploration while preserving comments and Viewed marks.
- **Close the loop with your agent.** Send line comments to Codex or Claude Code, read replies in the same threads, inspect fixes and **Approve**. Approval records your confirmation and lets you continue with another round of feedback.

Graph analysis currently covers relative JavaScript/TypeScript dependencies. Test categories use explicit project directory conventions or configuration; generic test filenames stay unclassified. [Graph behavior and analysis limits](docs/graph.md).

## Find Usages in the diff

Click an identifier to open its matches in the right sidebar, or use **Cmd + click** or **Option + F7** after selecting an identifier. Choose a result to jump to its file and line. File locations and code use distinct colors. Searches stay within the old or new side of the current diff and match identifier spelling, so unrelated symbols with the same name can appear together.

## Getting started

Requires Homebrew, Git, and Codex or Claude Code. [Installation notes](docs/cli.md#installation).

1. **Add the Homebrew tap.** Do this once.

   ```sh
   brew tap dmydary-code/trace https://github.com/dmydary-code/trace.git
   ```

2. **Install Trace.**

   ```sh
   brew install trace-review
   ```

3. **Connect your agents.** Use `all` for both Codex and Claude Code, or replace it with `codex` or `claude` for just one.

   ```sh
   trace-review install all
   ```

Restart your agent and open your project:

- **Codex:** ask “Use Trace to review my changes.”
- **Claude Code:** run `/trace:review`.

Or open a review directly:

```sh
cd /path/to/project
trace-review
```

## Use cases

- **Review local changes.** Inspect the working tree, or run `trace-review --staged` for staged changes.
- **Review a branch.** Run `trace-review --base origin/main --merge-base` against a locally available base ref.
- **Explore the graph.** Start with changed files, reveal unchanged neighbors on selection, and compare import, call and type dependencies against the base revision.
- **Request and verify fixes.** Add line comments, send them to your agent, read its replies in each thread, then inspect the latest changes and **Approve**.

## License

[MIT](LICENSE) © 2026 dmydary-code. Bundled [fonts](dist/fonts/OFL.txt) and [icons](docs/assets/icons/LICENSE) retain their own licenses.
