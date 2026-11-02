# Graph review

Choose **Graph** to see changed files and dependencies. Select a node to reveal its unchanged neighbors and open its diff on the right. Unchanged and deleted files show source (the base version for deleted files). Renames remain one node. The sidebar toggle collapses the file list completely.

Node colors identify code, unit tests, integration tests, E2E tests and unclassified tests. Brightness indicates diff membership, not whether the dependency itself changed. Edge badges + and − compare base and current dependencies. Solid edges show imports, dashed edges show calls through imported bindings, dotted edges show type-only imports. Test edges use the source test color.

The initial analyzer supports relative JavaScript and TypeScript imports, re-exports, literal require calls and direct calls of imported bindings. It does not resolve package aliases, dynamic expressions, framework dispatch, member calls or other languages. Calls use static text matching, not compiler symbol resolution. Type edges currently identify explicit type-only imports. These limits mean missing edges do not prove that files are unrelated.

Test categories use explicit unit/integration/e2e directory conventions. Generic `.test` and `.spec` files remain unclassified. Projects can declare directory mappings in `.trace-graph.json`:

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
