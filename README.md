<h1 align="center"><img src="dist/logo.svg" width="28" height="32" alt="Fir tree"> Trace</h1>

Local code review for Codex and Claude Code. Follow changes in a useful order, leave line comments, and get the agent’s replies in the same threads.

<p><img src="docs/assets/icons/react.svg" width="32" height="32" alt="React"> &nbsp; <img src="docs/assets/icons/vuejs.svg" width="32" height="32" alt="Vue"> &nbsp; <img src="docs/assets/icons/angular.svg" width="32" height="32" alt="Angular"> &nbsp; <img src="docs/assets/icons/nestjs.svg" width="32" height="32" alt="NestJS"> &nbsp; <img src="docs/assets/icons/fastapi.svg" width="32" height="32" alt="FastAPI"> &nbsp; <img src="docs/assets/icons/spring.svg" width="32" height="32" alt="Spring"> &nbsp; <img src="docs/assets/icons/android.svg" width="32" height="32" alt="Android"> &nbsp; <img src="docs/assets/icons/swift.svg" width="32" height="32" alt="SwiftUI / UIKit"> &nbsp; <img src="docs/assets/icons/flutter.svg" width="32" height="32" alt="Flutter"></p>

## Getting started

Requires Homebrew, Git, and Codex or Claude Code. [Installation notes](docs/cli.md#installation).

```sh
brew tap dmydary-code/trace https://github.com/dmydary-code/trace.git
brew install dmydary-code/trace/trace
trace-review install all
```

Replace `all` with `codex` or `claude` to install just one integration. Restart your agent and open your project:

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
- **Follow the change route.** Switch from folders to architectural stages detected from framework and file conventions. Only stages with changed files appear.
- **Request and verify fixes.** Add line comments, send them to your agent, read its replies in each thread, then inspect the latest changes and **Approve**.

## License

[MIT](LICENSE) © 2026 dmydary-code. Bundled [fonts](dist/fonts/OFL.txt) and [icons](docs/assets/icons/LICENSE) retain their own licenses.
