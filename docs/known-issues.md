# Known issues & structural inconsistencies

A running log of bugs and structural inconsistencies to fix later, so they aren't forgotten. Add new
entries at the top; keep each short — symptom, why it matters, a sketch of the fix, status.

## `_layout` is applied specially, not as a component

**Symptom.** The layout is the one "component" wired into a page *outside* the component pipeline. The
build loads it directly (`loadComponent(pageData.layout || '_layout')`) and fills it from a hand-built
`pageVars` object via `replaceVariables(layout, pageVars)` (build.js ~238 and ~338–352) —
`{{CONTENT}}`, `{{HEADER}}`, `{{FOOTER}}`, `{{PAGE_TITLE}}`, `{{HEAD_EXTRA}}`, `{{BODY_EXTRA}}`, …. So
`_layout` never goes through `buildComponent`: it can't have a `_layout.build.js`, declared
`subComponents`, dependencies, or per-item component `vars` like every other component.

**Why it matters.** It's a special case that surprises — `_layout` *looks* like a component (lives in
`components/_layout/`, has `_layout.html`) but doesn't *behave* like one. It complicates the mental
model and blocks treating the layout with the same tools (a layout build script, a layout
sub-component with bundled assets, etc.). It also makes the slim-core "`_layout` is a deployable
component" decision slightly leaky: deployable, but not *rendered* like one.

**Fix (sketch, later).** Render the layout through the normal component pipeline: `_layout` becomes a
regular component whose **`CONTENT` is a variable holding the page's built HTML**, with
`HEADER`/`FOOTER`/`PAGE_TITLE`/head+body extras passed as its component `vars` (exactly how page
components already receive `vars`). The special `replaceVariables(layout, pageVars)` path in the page
builder then collapses into "build the layout component with these vars", and the layout gains
`.build.js` / `subComponents` / dependencies for free.

**Status.** Documented, not scheduled. It touches the page-build core (build.js), so it wants its own
careful change + test pass — not bundled into unrelated work.
