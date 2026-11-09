# Graph dependency discovery for additional languages

Status: deferred product task. On 2026-11-07 the reviewer selected preservation of existing Graph language support for the refactor. This task records future requirements; it does not authorize implementation or create a release commitment.

Current Graph dependency discovery covers relative JavaScript/TypeScript imports and heuristic call/type evidence. The current [refactor test plan](refactor-test-plan.md) checks nodes and file previews for all ten requested languages, but dependency discovery remains limited to JS/TS.

Extend dependency discovery to Java, Kotlin, Go, Python, Rust, C#, Swift and C++ in a separate change. First agree language-specific dependency semantics, including package/module versus file targets, relation kinds, and explicit limitations. Preserve JS/TS behavior and diff loading independence.

## Proposed language dependency contracts

These are proposed minimum acceptance cases for a later Graph expansion. They are not implemented or verified today and are explicitly excluded from the current refactor. For each language use a single unambiguous local target, then add/remove the relation and verify its marker. Framework-specific routing, reflection, generated code and whole-program virtual dispatch remain outside this minimum.

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

For Calls / Uses type across all ten languages, define each language's resolution rules and expected examples before implementation. Passing an Imports/include-only case is not equivalent to supporting all three relation kinds.

## Implementation acceptance

- Approve the language-specific contracts before adding parsers or runtime dependencies.
- Maintain independent before/after source fixtures and expected relationship manifests.
- Verify source/target identity, relation kind, added/removed markers, rename/delete behavior, unresolved/external targets and no fabricated dependencies.
- Define and test test-file classification separately from dependency detection.
- Reuse the Graph interaction suite for context expansion, stable positions, preview versions and selection.
- Report unsupported syntax explicitly; do not equate a passing Imports case with semantic Calls or Uses type support.
- Keep the current refactor and its release independent of this task.
