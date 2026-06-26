# Generator restructuring — implementation plan

A restructuring of the generator subsystem from **generator-driven (auto-run)** to
**declarative, page-driven** generation. No version label is attached on purpose —
this is a refactor of how generation works, to be implemented on the
`refactor/generator-restructure` branch.

## The idea

Today a generator is a `*.build.js` that scans a data folder, owns its own HTML
template (read via `__dirname`), and emits one fully-formed page-config JSON per
item. Generation runs by **scanning** `generators/` and **running every** script.

After this change, generation is **declared by a page**:

- A **template page** lives in `pages/` and declares *which* generator to run and
  *with what options*. Its `.html` is the per-item content template; its folder may
  carry `style.css` / `script.js` (the engine already bundles page-folder assets).
- A **generator** (`generators/*.js`) holds only **data logic**: given options, it
  returns a list of item descriptors (`slug`, `title`, `vars`, …). It no longer owns
  the template, the layout, the components, or the page JSON.
- A **`generators/registry.json`** maps a generator **name → file**. A template page
  references the generator **by name**.
- The engine resolves the named generator, invokes it **once**, and **assembles**
  one concrete page per item from the template's HTML + layout + components, then
  builds each through the existing `buildPage`.

This keeps templates with the pages they produce, makes generation configurable in
the page JSON (including integrating already-implemented components), and lets the
engine **index** exactly what it needs (load only the referenced generator; read the
template from its declared folder) instead of scanning and running everything.

## Locked decisions

1. **Discovery by `generatorOptions`.** A page config is a *template* **iff** it has a
   `generatorOptions` object. **All** generation settings live inside it
   (`generator`, `pageName`, `source`, and any future ones), kept separate from the
   ordinary page settings (`layout`, `header_theme`, `components`, …). The `_` prefix
   is **not** a discovery mechanism — it is a cosmetic author comment only: the engine
   never relies on it to find templates and never emits it into output names.
2. **Page naming via pattern.** `generatorOptions.pageName` is a pattern, e.g.
   `"pageName": "product-{slug}"`; the generator supplies `slug` per item.
3. **Pre-copy source, by collection.** `generatorOptions.source` names a **collection**
   defined in `shared/database.json`. The generator reads item data from that
   collection's **pre-copy** source (under `SITE_ROOT`), not from `build/`, because data
   locations may move. Image/asset URLs use the collection's **post-build path** stored
   in `database.json` (see "Collections" below).
4. **Site-first registry.** `generators/registry.json` is resolved site-first — a site
   can remap a generator name to its own file — mirroring `components/registry.json`.
5. **N templates → 1 generator.** A generator is parameterized by `generatorOptions`,
   so the two near-identical product/custom generators can collapse into a single
   generic *collection* generator driven by two template pages.
6. **Title/description from the generator** (per item) for now — not config fields.
   They may become config fields in a later engine change; out of scope here.
7. **Collections carry their post-build path.** `shared/database.json` records the
   relative path each collection lands at in `build/` (its `destination`), treated as
   the canonical **web path** used to link images (and future assets). Generators never
   derive the web path from the source folder.
8. **Controlled data-file copy.** Each collection gets a boolean (default **false**)
   governing whether the data file (`product.json`) is copied into `build/<dest>/<item>/`.
   Default-false avoids leaking the raw "database" into built output; with the pre-copy
   model a generator reads data from the source, so `build/` normally needs only the
   web assets (images), not `product.json`.

## Design constraint — `registry.json` is volatile

A future task will restructure `registry.json` (and may change parts of this very
feature). Keep registry handling **cheap to change**:

- Route every read through **one** resolver (e.g. `resolveGenerator(name)`); do not
  scatter registry-shape assumptions across call sites.
- Keep the on-disk schema **minimal**: `{ "<name>": "<file>" }`.
- Mirror the existing `siteComponentRegistry()` merge pattern so a later unification
  of the registries is a one-place change.

## Collections (`shared/database.json`)

Current per-collection shape is `{ name, source, destination, enabled }`, and
`copyCollections` (build.js) copies the **entire** source folder into
`build/<destination>` — `product.json` included (the leak risk). Two changes:

- **Post-build path for linking.** `destination` is the canonical relative web path
  (e.g. `products`); generators link images as `<destination>/<item>/<file>`. Add a
  separate field only if the web path ever needs to differ from the build subdir —
  otherwise keep the one field (lean schema).
- **`copyData` (default `false`).** When false, the collection copy **excludes the
  data file** (`product.json`) — only web assets (images) reach `build/`. When true,
  the whole folder is copied (today's behavior; opt-in, leak risk). The exclusion rule
  must be explicit (exclude `product.json` by name; always copy known web-asset types)
  so nothing sensitive ships by accident.

```jsonc
// shared/database.json (one collection)
{ "name": "products", "source": "shared/products", "destination": "products",
  "enabled": true, "copyData": false }
```

## Target shapes

```jsonc
// pages/product-detail/product-detail.json   ('_' prefix, if used, is a comment only)
{
  "generatorOptions": {                // presence of this key marks the page as a template
    "generator": "collection",         // -> generators/registry.json
    "pageName": "product-{slug}",       // {slug} comes from the generator
    "source": "products"                // a collection name in shared/database.json
  },
  "layout": "_layout",                  // ordinary page settings stay outside generatorOptions
  "header_theme": "dark",
  "components": [ { "name": "contactIcons" } ]   // built into every generated page
}
// pages/product-detail/product-detail.html   -> per-item content template
// pages/product-detail/style.css, script.js  -> detail-page assets (was generators/product-detail.*)
```

```json
// generators/registry.json   (engine ships defaults; a site's copy is merged over it)
{ "collection": "generate-collection.js" }
```

```js
// generators/generate-collection.js  — DATA ONLY
module.exports = {
  // ctx = { siteRoot, engineRoot, buildDir, lib: { slugify, escapeHtml, raw },
  //         collection: { sourceDir, webPath } }   // resolved from generatorOptions.source
  // options = the template's generatorOptions, e.g. { generator, pageName, source }
  generate(ctx, options) {
    // read ctx.collection.sourceDir (pre-copy); link images under ctx.collection.webPath;
    // for each item return a descriptor:
    return [
      { slug: 'red-brick', title: 'Red Brick', description: '…',
        vars: { PRODUCT_NAME: '…', CAROUSEL_SLIDES: ctx.lib.raw('…'), /* … */ } },
      // …
    ];
  }
};
```

## Engine flow (target)

1. **Scan** `pages/` for configs (one pass).
2. **Classify** each config: has a `generatorOptions` object ⇒ **template**; otherwise
   ⇒ **normal page**. Normal `_`-prefixed entries stay excluded (examples); a template
   is found by `generatorOptions` regardless of any `_`.
3. **Normal pages** → `buildPage` as today.
4. **Templates** → `resolveGenerator(name)` (registry, site-first) → `generate(ctx,
   options)` → for each item: compute `pageName` from the pattern + `slug`, fill the
   template HTML with `item.vars`, assemble a page config `{ page, title, description,
   layout, header_theme, components, content }`, and `buildPage` it.
5. **Assets**: each generated page links the **template page's** `style.css/script.js`
   (named after the template), replacing the hard-coded `product-detail` special case.

### Reading pre-copy data, emitting build paths

A generator reads item data from the collection's pre-copy source, but image URLs in
the rendered page must point at the collection's **post-build path** in `build/` (e.g.
`products/<item>/<img>`). The engine resolves both from the `database.json` collection
named by `generatorOptions.source` and hands them to the generator via
`ctx.collection = { sourceDir, webPath }`. Generators never assume source == web path,
and never read `product.json` from `build/` (it may not be copied — see "Collections").

## Phased implementation

Each phase is independently testable via the engine's `example/` fixture + smoke test.

### Phase 1 — Collections: post-build path + controlled data copy
- Treat `destination` as the canonical web path; add the `copyData` boolean (default
  `false`) to the collection schema.
- Update `copyCollections` (build.js) to skip `product.json` when `copyData` is false
  (always copy web assets). Expose the resolved `{ sourceDir, webPath }` per collection
  for later phases.
- Smoke: with default config, `product.json` is **absent** from `build/<dest>/<item>/`
  while images are present; with `copyData: true`, `product.json` is present.
- **Order note:** flip the default to `false` only together with Phase 4 (generators
  reading pre-copy), or the existing built-ins (which read `build/.../product.json`)
  break in between. Until then, keep the data copied.

### Phase 2 — Registry + resolver (isolated, cheap to change)
- Add `generators/registry.json` (engine) for the built-in generator name(s).
- Add a single `resolveGenerator(name)`: merge engine + site registries (site wins),
  map `name → file`, then resolve the file site-first across `[SITE_ROOT/generators,
  ENGINE_ROOT/generators]`. No other module learns the registry shape.
- No pipeline change yet. Smoke: resolver returns the site file when a site overrides
  a name, the engine file otherwise.

### Phase 3 — Data-only contract + assembler (behind a fixture)
- Define `generate(ctx, options) -> items[]` and an `assemblePages(templateConfig,
  templateHtml, items)` that fills the template per item and calls `buildPage`.
- Provide `ctx.collection = { sourceDir, webPath }`, resolved from `generatorOptions.source`
  via the Phase 1 collection data.
- Add an `example/` template page + a tiny generator returning two items. Smoke:
  both pages built, the template's components are integrated, and the template's
  `style.css` reaches the built pages.

### Phase 4 — Discovery + pipeline inversion
- Classify scanned configs (`generatorOptions` present ⇒ template); expand templates
  via Phases 2–3. Remove the old auto-run dispatch (scan-and-run-all).
- Confirm `_`-prefixed example pages remain excluded while templates are found by
  `generatorOptions` regardless of any `_`.
- Provide data-only `generate(ctx, options)` versions of the two built-ins (reading
  pre-copy) and move their templates into `example/pages/`. Flip `copyData` default to
  `false` here (see Phase 1 order note).

### Phase 5 — Page-asset generalization
- Replace the `product-detail` special case (asset collect + copy) with
  "generated pages link/copy the asset named after their template page." The
  existing top-level page-folder copy already covers non-`_` template folders;
  the generated page config carries its template's asset base for the link side.

### Phase 6 — Collapse built-ins + docs
- Optionally merge `generate-products` + `generate-custom` into one generic
  `generate-collection` driven by two template pages (`product-detail`,
  `custom-detail`) that differ only by `generatorOptions` + HTML.
- Update `docs/generator-migration.md` (new contract + template-page model),
  `CLAUDE.md`, and `docs/extensibility.md`.

### Phase 7 — Site migration (separate repos, after the engine merges)
- Private site and demo: move templates into `pages/`, add `generators/registry.json`,
  thin the generators to data-only, move `product-detail.css/js` into the template
  folder, and set `copyData: false` on collections. Verify output is equivalent (the
  `product-<id>` page names are preserved when the `pageName` pattern matches the
  previous slugging).

## Breaking-change & migration notes

- **Contract:** `generate(ctx)` emitting page-config JSON → `generate(ctx, options)`
  returning item descriptors. Document the mapping in `docs/generator-migration.md`.
- **Layout:** templates move from `generators/` into `pages/`; `product-detail.css/js`
  move into the template folder; `generators/registry.json` is added.
- Any site-authored generator must migrate to the data-only contract; the engine
  should fail loud (as the removed legacy shim does) if it sees the old shape.

## Notes & caveats

- **`copyData` ordering.** Flipping the default to `false` before the generators read
  pre-copy would break the current built-ins (they read `build/.../product.json`). Tie
  the default flip to Phase 4 (Phase 1 keeps data copied). Stated in the phases.
- **Referenced collection must be enabled.** A template reads its collection's data
  pre-copy, but its **images** only reach `build/` if that collection is `enabled`.
  Validate that a template's `source` names an existing, enabled collection — else the
  data renders but images 404. Fail/warn loudly.
- **Define "data" precisely.** Exclude `product.json` by name (always copy known web
  asset types); don't implement `copyData:false` as "images only," which could silently
  drop a legitimately-needed non-image file. If a collection ever needs another data
  file name, make it explicit rather than guessing.
- **Leak hygiene.** `copyData:false` is the right default for the public demo (raw data
  never deploys) and good hygiene for the private site. Worth a one-line callout in the
  docs so nobody flips it to `true` casually.
- **Keep `destination` single.** It doubles as build subdir and web path (same relative
  string today). Don't add a parallel web-path field unless a real case needs them to
  differ — consistent with the lean-schema goal.
- **Normalize web paths.** Image URLs a generator builds must pass through the engine's
  `normalizeWebPaths` (forward slashes), same as the rest of the build.
- **`pageName` collisions.** Two templates whose patterns can yield the same name, or a
  generated name clashing with a normal page, need detection — reuse the existing
  generator output-collision warning, keyed on the final page name.
- **Validate `generatorOptions`.** Fail loud if present but missing `generator` or
  `pageName`, or naming an unknown generator/collection — matches the loud-error
  philosophy from the shim removal.
- **`enabled` vs `copyData`.** `enabled` = process the collection (copy its web assets);
  `copyData` = also copy the data file. A disabled collection is not copied at all.

## Out of scope / deferred

- The upcoming `registry.json` restructuring (kept cheap to change here).
- `generatorOptions` beyond `generator`/`pageName`/`source` (filters, sort, pagination).
- `title`/`description` (and other page fields) as template-config values.
- Multiple `style.css` / `script.js` files per page folder.
