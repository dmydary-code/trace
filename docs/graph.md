# Graph review

Trace offers **Graph** when the current diff includes JavaScript or TypeScript source (including JSX, TSX and module variants), Kotlin source (`.kt`) or Python source (`.py`). A deletion or rename from a supported path also qualifies. In a mixed repository this follows the selected commit or comparison. Diffs containing only other files open in **Files**. Select a node to reveal its unchanged neighbors and open its diff on the right. Unchanged and deleted files show source (the base version for deleted files). Renames remain one node. The sidebar toggle collapses the file list completely.

Node colors identify code, unit tests, integration tests, E2E tests and unclassified tests. Brightness indicates diff membership. Edge badges + and − compare base and current dependencies. Solid edges show imports, dashed edges show calls, and dotted edges show type references. Test edges use the source test color.

JavaScript and TypeScript files that only forward exports, including barrel files such as `index.ts`, are folded into the connections to their implementations. Files with local declarations or runtime logic remain visible. You can still review a changed barrel and its comments in **Files**.

For JavaScript and TypeScript, Trace follows relative imports, re-exports, literal require calls, direct calls of imported bindings and explicit type-only imports.

For Kotlin, Trace indexes top-level declarations by package across local `.kt` files. It follows explicit imports and aliases, direct calls of top-level functions, and simple type references such as parameter types and constructors. Calls and types can also resolve within the same package or through a wildcard import when the target is unique. Kotlin projects can use this with Gradle JVM and Android source trees. Analysis reads source files only. Gradle scripts, generated sources outside Git, extension and member dispatch, and compiler overload resolution are outside its scope. Ambiguous symbols are omitted.

For Python, Trace follows local absolute and package-relative imports, including aliases, multiline imports and package initializers. It checks the project directory and its `src/` layout, including local namespace packages. If both roots contain a concrete absolute target, Trace skips the ambiguous edge. Relative imports stop at the source root. Direct calls to an imported name or a function on an imported module add a **Calls** edge. The analysis uses source text, so it can run without a Python interpreter. External packages, dynamic imports, runtime path changes and type inference are outside its scope. Call detection uses the spelling of the imported binding and does not model local shadowing.

Test categories use explicit unit/integration/e2e directory conventions. Generic `.test` and `.spec` files, Kotlin test source sets and files named `*Test.kt` or `*Spec.kt` are unclassified by default. Projects can declare directory mappings in `.trace-graph.json`:

```json
{"testDirectories":{"unit":["tests/unit"],"integration":["tests/integration"],"e2e":["tests/browser"]}}
```

Automatic interpretation of Vitest project configuration is not yet supported; use this explicit mapping for those projects. One test can have multiple dependency targets. Files over 1 MiB, binary files and symlinks escaping the repository have no source preview.

## Tree layout

Files are arranged as a deterministic dependency forest from left to right. Each file appears once, with separate rows and orthogonal branches routed in the gaps between columns. Multiple relation kinds share a branch with an explicit label. Cycles and dependencies shared by multiple parents remain available in the selected file’s Connections list; selecting a connection focuses the related file. This avoids drawing crossing cross-links over the tree.

## Selection and reset

Selecting any node immediately opens its file on the right and reveals its neighbors. Selecting another node replaces the open file. Previously revealed nodes and their connections remain until **Reset graph**, which clears selection, closes the file panel, clears search and returns to changed files and initial scrolling. Comments and Viewed marks remain. Red badges count file comment threads, including resolved threads, and update when comments are added or deleted. Node positions are independent of selection.

Viewed files are hidden from Graph together with their edges. Uncheck Viewed in Files or in the open file panel to show the node again. Drag a node to reposition it; connected edges follow during the drag. Positions survive selection changes until Reset graph or a new revision. Reset graph preserves Viewed marks, so reviewed files stay hidden.

Use + and − to zoom between 25% and 300%. Pinch on a trackpad zooms around the pointer; normal two-finger scrolling pans the canvas. Reset graph restores 100% zoom. Node dragging uses graph coordinates at the current scale.

Drag the divider beside the file preview to adjust its width. The graph canvas is clipped without changing zoom or node coordinates. Preview width is remembered locally; arrow keys also resize the divider, and double-click restores the default split.

## Loading and cache behavior

The diff endpoint does not build Graph. Files shows a loading state while fetching the diff; Graph is requested separately when opened, with its own loading, failure and retry states. Concurrent requests share the same in-flight graph build. Completed graph results are cached for two seconds per diff revision; refreshing the review after that also rereads unchanged context files. Git blobs are read with cat-file batches and cached by immutable object ID, with a bounded cache. Working-tree reads use eight workers. Graph failures do not block review submission or Files. A saved review whose snapshot no longer matches the working tree asks you to inspect latest changes before building Graph.
