# `_layout` migration

Recent engine work made `_layout` a **first-class component**. Three changes landed, in order:

1. **`_layout` renders through the component pipeline** (`fix/layout-as-component`) — the page builder
   now does `buildComponent(layoutName, pageVars)` instead of a special `replaceVariables(layout, …)`
   path, so the layout can have a `_layout.build.js`, `subComponents`, and dependencies like any
   component. *Byte-identical output; no site change required.*
2. **header/footer are declared `_layout` dependencies** (`fix/header-footer-deps`) — the engine
   `_layout.html` places `{{COMPONENT:header}}` / `{{COMPONENT:footer}}` and a new `_layout.json`
   declares `"dependencies": ["header","footer"]`. `buildPage` no longer builds header/footer or
   injects `{{HEADER}}`/`{{FOOTER}}` vars. **⚠️ Requires a site change if you override `_layout.html`.**
3. **The header mode moved into the layout** (`fix/header-footer-deps`) — a new engine
   `_layout.build.js` derives `HEADER_MODE` (default `light`) from the raw `HEADER_THEME` `buildPage`
   now passes, and sets it on `vars` so the body attribute *and* the nested `{{COMPONENT:header}}` fill
   from it. *No site change unless you override `_layout.build.js`.*

**Who must migrate:** any site that ships its own `components/_layout/_layout.html`. (Both first-party
sites do.) A site that inherits the engine layout is already correct.

---

## Step 1 — swap the header/footer placeholders (required)

In your site's `components/_layout/_layout.html`:

| Before | After |
|---|---|
| `{{HEADER}}` | `{{COMPONENT:header}}` |
| `{{FOOTER}}` | `{{COMPONENT:footer}}` |

That's the whole change for a typical layout — one line each. `{{HEADER}}`/`{{FOOTER}}` are no longer
provided, so left as-is they render as **literal text** with no header/footer (see the caveat in
Step 3). Everything else in your `_layout.html` (`{{CONTENT}}`, `{{PAGE_TITLE}}`, `{{HEADER_MODE}}`, …)
is unchanged — including `{{HEAD_EXTRA}}`/`{{BODY_EXTRA}}`, now **deprecated aliases** for the
self-describing `{{CSS_LINKS}}`/`{{JS_SCRIPTS}}` (both fill; prefer the new names in new layouts).

You do **not** need to add a `_layout.json` or `_layout.build.js` — the engine's copies are resolved
**per file, site-first**, so overriding only `_layout.html` inherits the engine's dependency
declaration and mode-deriving build script automatically. (Add your own only if you want to change
that behaviour.)

## Step 2 — if you override `_layout.build.js` (uncommon)

If your site ships its own `components/_layout/_layout.build.js`, derive the mode from the raw theme
the engine now passes, and set it on `vars` so the nested header sees it:

```js
function build(vars, loadComponent, replaceVariables) {
  vars.HEADER_MODE = vars.HEADER_THEME || 'light';   // was computed in buildPage; now the layout's job
  return replaceVariables(loadComponent('_layout'), vars);
}
module.exports = { build };
```

The old build-wide `HEADER_MODE` global is gone; `buildPage` passes `HEADER_THEME` (the page's raw
`header_theme`, possibly unset). If you don't override the build script, ignore this step.

## Step 3 — verify with `ssg test`, not just `ssg build`

Run **`ssg test`** (`npm test`), not only `ssg build`. A stray `{{HEADER}}` left in the layout ships a
literal placeholder and **`ssg build` exits 0 without complaint** — the "no unresolved `{{VAR}}`" /
"no leftover `{{COMPONENT:..}}`" checks run only under `ssg test`. So a forgotten Step 1 looks like a
clean build but broken pages. (Tracked in [known-issues.md](known-issues.md) → *"`ssg build` doesn't
catch unresolved `{{VAR}}`"*.) A green `ssg test` confirms the swap.

---

## A note on the leading `_`

`_layout`'s leading underscore is **cosmetic for a component** — it does *not* exclude the layout from
the build or from deployment:

- **Discovery.** `allComponentNames()` (`build.js`) lists every `components/*` folder, `_`-prefixed or
  not, so `_layout` is discovered and resolved site-first like any component. `_layout.html`,
  `_layout.json`, and `_layout.build.js` all resolve normally.
- **The only `_`-based skip is for pages.** `build.js` excludes a page whose path has any `_`-prefixed
  segment (`pages/_draft/…` isn't built) — that rule is scoped to `pages/`, never to `components/`.
- **Asset output names** strip a leading `_` (a component's `style.css`/`script.js` would emit as
  `layout.css` etc.) — moot for `_layout`, which ships no bundled assets.
- **Deployment.** The planned slim-core deploy commands (`ssg add`, on `feat/deploy`) pick `_layout`
  up by name (`ssg add material _layout`) and via `ssg add material --all-used`; the underscore is
  preserved as the folder name. So `_layout` is deployable like any material once that lands.

So the underscore is a naming convention ("framework-level, not your content"), not a build exclusion —
`_layout` is a normal, deployable component.
