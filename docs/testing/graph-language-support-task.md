# Graph dependency discovery for additional languages

The viewer offers Graph for changes that the JavaScript/TypeScript analyzer recognizes. The work below is the backlog for broader stack support. Each stack can ship independently once its dependency fixtures pass.

## Delivery plan

1. **JS/TS and web frameworks.** Preserve relative module discovery. Add fixture pairs for package aliases and workspace imports in Node, NestJS, React, Angular and Vue projects. Specify Angular template links and Vue single-file component imports separately. Enable a new file format only after its analyzer resolves a local dependency end to end.
2. **Backend and native languages.** Implement the contracts below for Java/Spring, Kotlin/Android, Go, Python/FastAPI, Rust, C#, Swift/iOS and C++. Start each implementation with the smallest local dependency its compiler or module system can identify unambiguously.
3. **Dart and Flutter.** Resolve relative imports and same-package `package:` imports using the package name and `lib/` root from `pubspec.yaml`. Include fixtures for external packages, exports and deleted files.
4. **Enable each stack.** Extend the shared source-file check alongside its analyzer. Exercise supported-only, unsupported-only and mixed diffs, switching commits, saved Graph preferences and file review in both browsers.

## Proposed language dependency contracts

These are proposed minimum acceptance cases for a later Graph expansion. For each language use a single unambiguous local target, then add/remove the relation and verify its marker. Framework-specific routing, reflection, generated code and whole-program virtual dispatch remain outside this minimum.

| ID | Language | Minimum independently specified relationship |
| --- | --- | --- |
| GX-01 | Java | Import a local class from another package: Imports to its file. A separate explicit static call and type-reference fixture require semantic support, not import-name guessing. |
| GX-02 | Kotlin | Import a local class or top-level function: Imports to the declaring file; alias and same-package reference variants specified separately. |
| GX-03 | Go | Local module import: package dependency represented without arbitrarily selecting a file. Package-versus-file node semantics must be agreed before implementing this case. |
| GX-04 | Python | `from .helper import calculate` and a local module import: Imports to the correct module; external packages excluded. |
| GX-05 | Rust | Local `mod` and explicit `use` of an item: correct module file resolution; crate and inline-module semantics specified. |
| GX-06 | C# | Explicit reference to a unique project-local type: Uses type to its declaring file. A `using` namespace alone must not fabricate a one-file dependency; partial classes require an explicit policy. |
| GX-07 | Swift | Explicit reference to a unique type in the same module: Uses type to its declaration; `import Foundation` excluded from local-file dependencies. |
| GX-08 | C++ | Quoted local `#include` resolves to the header: Imports. Calls/types require a separate parser contract; macros and conditional includes are not silently flattened. |

For Calls / Uses type across languages, define each language's resolution rules and expected examples before implementation. Passing an Imports/include-only case is not equivalent to supporting all three relation kinds.

## Implementation acceptance

- Approve the language-specific contracts before adding parsers or runtime dependencies.
- Maintain independent before/after source fixtures and expected relationship manifests.
- Verify source/target identity, relation kind, added/removed markers, rename/delete behavior, unresolved/external targets and no fabricated dependencies.
- Define and test test-file classification separately from dependency detection.
- Reuse the Graph interaction suite for context expansion, stable positions, preview versions and selection.
- Report unsupported syntax explicitly; do not equate a passing Imports case with semantic Calls or Uses type support.
- Include representative mixed-language repositories in the regression suite as each analyzer ships.
