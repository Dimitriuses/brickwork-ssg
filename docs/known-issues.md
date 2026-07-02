# Known issues & structural inconsistencies

A running log of bugs and structural inconsistencies, so they aren't forgotten. Add new (open)
entries at the top; keep each short — symptom, why it matters, a sketch of the fix, status. Resolved
entries stay as a record, marked ✅ Fixed.

## Rename the layout's built-asset vars `{{HEAD_EXTRA}}` / `{{BODY_EXTRA}}`

**Symptom.** The layout placeholders `{{HEAD_EXTRA}}` (in `<head>`) and `{{BODY_EXTRA}}` (end of
`<body>`) don't say what they hold: the engine fills them with the **built component CSS `<link>`
tags** and **JS `<script>` tags** respectively (`build.js`: `HEAD_EXTRA: raw(cssLinks)`,
`BODY_EXTRA: raw(jsScripts)`). "EXTRA" reads like an open-ended slot, not "the bundled styles/scripts".

**Why it matters.** Clarity for layout authors — the names should reflect that these are the collected
CSS/JS link/script tags, not arbitrary extra markup.

**Fix (sketch).** Rename to self-describing names — suggested **`{{CSS_LINKS}}`** and
**`{{JS_SCRIPTS}}`** (they also match the internal `cssLinks` / `jsScripts`); alternatives
`{{STYLE_LINKS}}` / `{{SCRIPT_TAGS}}`. **Coordinated rename:** the engine `_layout.html` *and* both
sites' `_layout.html` overrides use the current names, so change them together (or accept both names
for one release, then drop the old).

**Status.** Open.

## Build crashes hard if a site has no `assets/images/`

**Symptom.** `build.js` runs `copyDirectory(path.join(ASSETS_DIR, 'images'), …)` unconditionally at
startup; if the site has no `assets/images/` folder, `fs.readdirSync` throws `ENOENT` and the whole
build aborts with a stack trace instead of a clean message. (Found while building a minimal
scaffolded site.)

**Why it matters.** A fresh/minimal site — exactly what `ssg init` will produce — may not have an
images folder yet, so the first build crashes ungracefully. It also makes minimal test fixtures
awkward (they must create an empty `assets/images/`).

**Fix (sketch).** Guard the copy — `if (fs.existsSync(src)) copyDirectory(...)` — like the other
optional copies; a one-liner, low risk. (`ssg init` should also seed the folder.)

**Status.** Open.

## Header/footer are hard-wired globally, not linked to `_layout`

**Symptom.** `header` and `footer` are separate components, but nothing *declares* that the layout
uses them — the wiring is hardcoded in two places: (1) **rendering** — `buildPage` always does
`buildComponent("header"/"footer")` and injects the result as the `{{HEADER}}`/`{{FOOTER}}` *vars* the
layout references; (2) **assets** — `ASSET_KINDS.base` hardcodes `['header','footer']` (css) /
`['header']` (js) so their CSS/JS always bundle. So `_layout.html` using `{{HEADER}}`/`{{FOOTER}}` is a
naming coincidence, not a real dependency; there is no `_layout.json`.

**Why it matters.** Same shape as the `_layout` inconsistency (now fixed): "always-on" components are
special-cased rather than declared. A layout that doesn't want a header/footer still gets them built +
bundled, and a layout can't express "I depend on header + footer" the way any other component declares
`dependencies`/`subComponents`.

**Fix (sketch, later).** Now that `_layout` renders through `buildComponent`, the layout can place
`{{COMPONENT:header}}` / `{{COMPONENT:footer}}` and declare `"dependencies": ["header","footer"]` in a
`_layout.json`; `buildPage` drops the hardcoded header/footer build + vars, and `ASSET_KINDS.base`
drops them (the asset walk picks them up via the layout's dependencies once `_layout` is in the walk).
**Watch-outs:** the per-page `header_theme` reaches the header via the body `data-header-mode`
attribute + a `HEADER_MODE` var — that path must be preserved (pass the theme as a component var); and
this **changes rendering**, so it is *not* byte-identical like the seam fix and needs its own careful
diff. Bigger than the `_layout` fix — track separately.

**Status.** Open. Enabled by the `_layout`-as-component fix; deliberately not bundled into it.

## ✅ `_layout` is applied specially, not as a component *(fixed)*

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

**Status.** ✅ **Fixed** (branch `fix/layout-as-component`). The page builder now renders the layout
via `buildComponent(layoutName, pageVars)` — the same path `header`/`footer` use — so `_layout` is a
first-class component with `CONTENT` + chrome as its vars, and a `_layout.build.js` / `subComponents`
/ `{{COMPONENT}}` now work. Output is **byte-identical** for a layout without a build script (the
common case), verified against the example, the private site, and a diff of the whole build tree; a
smoke check exercises a layout build script running.
