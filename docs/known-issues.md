# Known issues & structural inconsistencies

A running log of bugs and structural inconsistencies, so they aren't forgotten. Add new (open)
entries at the top; keep each short — symptom, why it matters, a sketch of the fix, status. Resolved
entries stay as a record, marked ✅ Fixed.

## ✅ `{{COMPONENT:x}}` in page CONTENT is expanded by the layout pass (commented / undeclared too) — v0.6.0 regression *(fixed)*

**Symptom.** A `{{COMPONENT:name}}` that appears in a page's **content** but isn't resolved during the
content build — because `name` isn't in the page's `components` array, or the placeholder is **commented
out** (`<!-- {{COMPONENT:faq}} -->`) — is now **expanded anyway**. Since v0.6.0 the layout renders through
`buildComponent`, whose `{{COMPONENT:…}}` scan runs over the layout HTML *after* the page content has been
injected into `{{CONTENT}}` — so leftover `{{COMPONENT:x}}` in the content get picked up and built. At
v0.5.1 the layout was filled with `replaceVariables` (no `{{COMPONENT}}` scan), so those leftovers stayed
literal/inert. Found migrating the private site to v0.6.0: `<!-- {{COMPONENT:faq}} -->` (faq deliberately
disabled on that page) rendered the faq, and the faq HTML's own `<!-- … -->` comments closed the author's
comment early — exposing unfilled `{{FAQ_*}}` vars (a failing `ssg test`).

**Why it matters.** "Comment out a component to disable it" silently breaks, and an undeclared inline
`{{COMPONENT:x}}` renders `x` without the page's vars. It's a behavior change from v0.5.1 that can turn a
clean site into broken output on the v0.6.0 bump.

**Fix.** ✅ Done (`fix/known-issues`). `buildComponent`'s `{{COMPONENT:…}}` pass is now **comment-aware**,
mirroring the content pass in `buildPage`: it skips any placeholder inside an `<!-- … -->` range, so a
commented-out reference stays literal (disabled) even after the layout injects it via `{{CONTENT}}`. The
pass also switched from collect-then-string-replace to a single callback replace — which additionally
prevents a live `{{COMPONENT:x}}` from being resolved into an *earlier* commented one of the same name.
The layout's own (non-commented) `{{COMPONENT:header/footer}}` still resolve. A smoke check builds a page
with a live + a commented `{{COMPONENT}}` and asserts only the live one (and the layout's) render. The
site workarounds (neutralized comments) remain harmless.

**Status.** ✅ Fixed.

## ✅ `ssg build` doesn't catch unresolved `{{VAR}}` / `{{COMPONENT}}` — only `ssg test` does *(fixed)*

**Symptom.** When a template leaves a placeholder unresolved — e.g. a custom `_layout.html` still
using `{{HEADER}}` after that var was removed — the literal `{{HEADER}}` ships in the output HTML and
`ssg build` **exits 0** with no warning. The "no unresolved `{{VAR}}`" / "no leftover `{{COMPONENT:..}}`"
invariants live in the always-on checks (`lib/checks.js`, lines 26–27 / 46–47), which run only via
`ssg test` (through `lib/test-runner.js`). (Discovered building the private site against the
header/footer-deps engine: 51 pages "built", output held literal `{{HEADER}}`/`{{FOOTER}}` and zero
`<header>`/`<footer>`, exit 0.)

**Why it matters.** A broken migration — or any typo'd placeholder — produces visibly broken pages
that a plain `npm run build` + deploy ships without complaint; the failure only surfaces if the site
also runs `ssg test`. A sharp edge for the header/footer migration below, and for `ssg init`-scaffolded
sites that may not have wired up tests yet.

**Fix (sketch).** Run the unresolved-placeholder scan during `build` too — either always (fail the
build, matching "the build exits non-zero on any page/generator failure") or as a **warning** through
`lib/log.js` (non-fatal: `build` stays lenient but noisy). Leaning warning-by-default with an opt-in
strict mode, so `build` doesn't suddenly start failing sites that tolerate a stray placeholder. Reuse
`checks.js`'s `visible` scan (it strips HTML comments) — but note it does **not** strip code samples,
so a literal `{{VAR}}` in visible `<pre>`/`<code>` is a known false-positive to scope out first.

**Fix.** ✅ Done in two parts. **`{{COMPONENT}}`** (Phase 2 B): a visible unresolved `{{COMPONENT:x}}`
now fails the build — `buildComponent` resolves it and an unowned component throws `is not installed —
run ssg add material x` (non-zero exit). **`{{VAR}}`** (`fix/known-issues`): after the build, `build.js`
scans the output HTML (comments stripped, as in `checks.js`) and **warns** on any remaining
`{{VAR}}` — non-fatal by design (`build` stays lenient), listing the vars + pages; `ssg test` still
**fails** on them (the enforcement path). So `ssg build` is no longer silent. A smoke check builds a
site with an unresolved `{{VAR}}` and asserts the warning + a clean exit (and that a commented-out
placeholder is ignored). Note kept from the sketch: the scan strips comments but **not** code samples,
so a literal `{{VAR}}` in visible `<pre>`/`<code>` would warn (rare; a future opt-in strict mode could
fail the build).

**Status.** ✅ Fixed (`{{COMPONENT}}` build-fatal; `{{VAR}}` warns at build, fails at test).

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

## ✅ Build crashes hard if a site has no `assets/images/` *(fixed)*

**Symptom.** `build.js` runs `copyDirectory(path.join(ASSETS_DIR, 'images'), …)` unconditionally at
startup; if the site has no `assets/images/` folder, `fs.readdirSync` throws `ENOENT` and the whole
build aborts with a stack trace instead of a clean message. (Found while building a minimal
scaffolded site.)

**Why it matters.** A fresh/minimal site — exactly what `ssg init` will produce — may not have an
images folder yet, so the first build crashes ungracefully. It also makes minimal test fixtures
awkward (they must create an empty `assets/images/`).

**Fix.** ✅ Done (`feat/slim-core`). The copy is guarded — `if (fs.existsSync(imagesDir)) copyDirectory(...)`
— so a site with no `assets/images/` builds cleanly (skips the copy + its log line). Surfaced while
building an `ssg init` blank site; a smoke check now builds a blank `ssg init` site (no images) to guard it.

**Status.** ✅ Fixed.

## ✅ Catalog build scripts `require('../../lib/...')` — broke once deployed into a site *(fixed)*

**Symptom.** The engine's component `*.build.js` scripts pulled helpers via
`const { raw, escapeHtml } = require('../../lib/html')`. That relative path only resolves while the
script lives in the engine tree; the moment a site **owns** a copy (a hand-copy, or `ssg add material`
deploying it from the catalog), `../../lib/html` resolves against the *site's* non-existent `lib/` and
the build dies with `Cannot find module '../../lib/html'`.

**Why it matters.** It made the engine's own catalog materials **not actually deployable** — defeating
the whole point of the slim-core `catalog/` + `ssg add`. The example self-deploy (Phase 2 A) hit it on
the first build. (CLAUDE.md had already documented the private site's hand-copies working around this.)

**Fix.** ✅ Done (`feat/slim-core`, Phase 2 A). The five catalog scripts that required `lib/html`
(`contactIcons`, `faq`, `footer`, `header`, `products`) now take `raw`/`escapeHtml` from the 4th
`helpers` argument `buildComponent` always passes — self-contained, so a deployed copy runs anywhere.
Same pattern the private site already used.

**Status.** ✅ Fixed.

## ✅ `componentFolder` ignored the site `registry.json` remap *(fixed)*

**Symptom.** `lib/components.js`'s `componentFolder(name)` returned `subcomponentMap()[name] || name`
— it honoured sub-component → parent-folder mapping but **not** a site `components/registry.json` remap,
even though `resolveComponentFile` *did* apply that remap for the site path. So for a component the site
relocates (e.g. `pricing` → `blocks/pricing`), `componentFolder` disagreed with where the files actually
resolve. Surfaced with `ssg add builder <name>` on a `--folder`'d component: the build script landed in
`components/<name>/` instead of the remapped folder.

**Why it matters.** Two helpers in the same module gave inconsistent answers for the same name — a
latent trap for anything using `componentFolder` (the deploy-folder set in `--all-used`, the `builder`
scaffolder).

**Fix.** ✅ Done (`feat/deploy`, with the `ssg add` R1–R3 rework). `componentFolder` now applies the
site registry remap too (`siteComponentRegistry()[folder] || folder`), agreeing with
`resolveComponentFile`. Safe for its callers: `used-materials` (a remapped component is site-owned,
skipped by `--all-used`) and `build.js` (destructures but never calls it).

**Status.** ✅ Fixed.

## ✅ Header/footer are hard-wired globally, not linked to `_layout` *(fixed)*

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

**Fix.** ✅ Done (branch `fix/header-footer-deps`). The engine `_layout.html` now places
`{{COMPONENT:header}}` / `{{COMPONENT:footer}}` and declares `"dependencies": ["header","footer"]` in a
new `_layout.json`; `buildPage` no longer builds header/footer or injects `{{HEADER}}`/`{{FOOTER}}`
vars, and `ASSET_KINDS.base` is now `['_layout']` (header/footer bundle via the layout's dependencies).
The per-page `header_theme` still reaches the header, and the mode derivation moved out of `buildPage`
into a new **`_layout.build.js`**: `buildPage` passes the raw `HEADER_THEME`, the layout script
derives `HEADER_MODE` (default `light`) and sets it on `vars`, so both the body attribute and the
nested `{{COMPONENT:header}}` — resolved with those same vars — fill from it. Output is
**content-identical** for the example (a whole-tree diff shows no change but working-tree line
endings). A smoke check guards that the header receives the theme.

**⚠️ Breaking for sites with a custom `_layout.html`.** A site override that still uses
`{{HEADER}}`/`{{FOOTER}}` gets literal placeholders (no header/footer) once it bumps to this engine —
and `ssg build` won't flag it (the unresolved-`{{VAR}}` check only runs in `ssg test`). **Both sites**
(private + demo) override `_layout.html`, so each needs a one-line-each swap
(`{{HEADER}}`→`{{COMPONENT:header}}`, `{{FOOTER}}`→`{{COMPONENT:footer}}`) in the same commit that
bumps their engine submodule. See **[docs/layout-migration.md](layout-migration.md)** for the full
per-site steps.

**Status.** ✅ Fixed on branch `fix/header-footer-deps` (pending merge). Enabled by the
`_layout`-as-component fix; deliberately not bundled into it.

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
