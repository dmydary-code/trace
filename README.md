# Trace

A code review workspace with a file tree, continuous diffs, inline feedback, and an optional change route.

## Features

- **Files:** navigate the changed-file tree, search paths, and mark files as viewed.
- **Change route:** read every changed file in responsibility order instead of directory order. Change a suggested layer per file; empty layers disappear.
- **Inline review:** add, edit, resolve, reopen, and delete comments on old or new lines. Drafts and review state persist in this browser, scoped to the revision.
- **Agent handoff:** copy a task, download structured JSON, or run Codex through the local companion server.
- **Light and dark themes.**
- **Stack presets:** React, Vue, Angular; TypeScript/NestJS, Python/FastAPI, Java/Spring; Kotlin/Android, Swift/iOS, Dart/Flutter.

## Preview sample changes

Requires Node.js 20+ for the local server and tests. The static demo has no build step or dependencies:

```sh
python3 -m http.server 4174 --directory dist
```

Open http://127.0.0.1:4174. Use the project and stack selectors to change the sample diff. Sample snippets illustrate review interactions; they are not complete, runnable applications.

## Review a real repository

```sh
node server.mjs --repo /absolute/path/to/repository
```

Open the printed localhost URL. By default, Trace displays tracked staged and unstaged changes against the HEAD resolved at server startup. Use `--base main` to compare against another local ref. This is a direct tree comparison, not a merge-base PR diff. Untracked files, binary changes, and rename-only/mode-only changes are not shown yet.

## Send changes to an agent

Install and authenticate Codex CLI separately. Enable its local adapter explicitly:

```sh
node server.mjs --repo /absolute/path/to/repository --agent codex
```

1. Click **+** beside a line and add feedback.
2. Open **Send to agent**, inspect the comments and optional instructions.
3. Click **Send to Codex**. This starts `codex exec` in that repository with the `workspace-write` sandbox, passing the task through stdin.
4. Read the completion or failure status, then **Refresh diff** to inspect the result.

The agent can edit repository files. It is instructed not to commit or push. Only one job runs at a time; stale review revisions are rejected. Jobs and results are written to the repository's Git metadata directory under `trace/`. Reviews for old revisions remain in browser storage, but are not automatically re-anchored or carried into the new diff.

The hosted demo cannot access your local repository or run your local agent. It provides task copy/JSON export. The local server binds to loopback and checks Host, Origin, and a per-process request token before starting jobs.

## How route suggestions work

The current implementation uses path/name conventions and a few text cues from the diff, with manual overrides. It does not parse ASTs, resolve imports, infer the project's architecture, or build a call graph. A Vue SFC remains one file; Angular component/template/style files remain separate cards within the same layer. Unrecognized files stay visible under **Other changes**.

Review presets are reading lenses, not mutually exclusive architectural classifications. MVVM can coexist with UDF, and an event-driven service can also use Clean Architecture. See [the architecture analysis](docs/review-routes.md) for decisions, sources, and the next implementation stages.

## Validation

```sh
node --test tests/*.test.mjs
```

Tests cover route order, classification, diff anchors, and local agent transport with a fixture executable. They do not invoke a real model or validate generated code.
