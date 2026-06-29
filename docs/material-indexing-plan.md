# Material indexing, data, & routing — draft plan (for discussion)

> **Status: Tracks A–C shipped in engine v0.4.0** (A1, A2, B1, C1, C2, B2, C3 — in that order).
> The data model (`copy:false` + `ctx.collection.items`), declarative `map` + optional generator,
> per-item component vars, nested/bundled sub-components, and the `carousel` component + generator-free
> detail pages are all in. The built-in detail generator was retired; the `products` grid reads the
> model via `helpers.collection`. **Remaining:** Track D (`routing.json`) is still a future task, and
> the two sites are migrated to the data model in a separate pass (post-v0.4.0).

## The pieces you outlined

1. **Finish `data_model`** — explicit `copy` (omitting warns), and the engine hands generators
   `ctx.collection.items = [{ id, options, data }]` (data keyed by `data_model` part).
2. **Declarative data → placeholder mapping** in `generatorOptions`, to shrink generators.
3. **Folder / sub-trees** registered in a registry (`{ "<name>": "<folder>" }`), e.g.
   `faq/faq_item`, `products/product_item`.
4. **Optional explicit file lists** inside a component/page folder (`.html/.css/.js/.build.js`)
   — an option, not mandatory.
5. **`*.build.js` stays** as a server-side-build escape hatch.
6. **`routing.json`** in `/pages/` — map site URLs to page folders (`site.com/shop/product-256`,
   `site.com/app/dashboard`); optionally hold `generatorOptions`.
7. Cross-cutting: **hybrid scan + register**, with registration *optional* (the engine can
   run with none).

## Headline recommendation: this is ~4 tasks, not one

These don't all belong in one change. I'd split them into tracks and sequence them, so each
ships and proves out before the next leans on it:

- **A — Finish the data model** (1). Tight, natural follow-on to Task 2.
- **B — Data → placeholder mapping** (2). Pairs with A; shrinks generators.
- **C — Material registration & folder trees** (3, 4, 7). The "indexing" core.
- **D — Routing** (6). A *distinct, large* concern — I'd split it out and do it last (or
  separately). More below.

`*.build.js` staying (5) needs no work — it already does; just keep it documented as the
escape hatch.

---

## Track A — Finish the data model (`copy: false` + `ctx.collection.items`)

**Goal:** close the leak end-to-end and hand generators structured items.

**Design**
- **Every part is explicit** — omissions warn, so a config is never ambiguous:
  - `match` — item-relative glob.
  - `copy` — `true` ships the part to `build/`, `false` keeps it out. **Omitting warns** (treated
    as not copied): "part X has no `copy` — its files will NOT ship; set `copy: true`/`false`".
  - `required` — `true` makes the build **error** if no file matches in an item (e.g.
    `product.json`); `false` allows none (e.g. `images`). **Omitting warns** (treated as `false`).
    *(Already shipped in Task 2 as `required` — field, error, and test; Track A adds the
    warn-on-omit.)*
  - `type` — how to **surface** the part into the item: `object` (file parsed → object; JSON for
    now), `paths` (matched files → array of web paths), or `file_path` (one file → a path; if
    several match, the **first, sorted**, + a warning). **Omitting defaults to `file_path` and
    warns** ("specify `type` if it isn't `file_path`"). Minimal slice of the deferred richer typing.

  A real model:
  `images: { match: "...", type: "paths", copy: true, required: false }`,
  `data: { match: "product.json", type: "object", copy: false, required: true }`.
- The engine hands generators a **hoisted-options** shape (options once, not per item):
  ```
  ctx.collection = {
    options,                            // the template's generatorOptions
    dir, webPath,                       // raw source dir + web path - kept for custom generators
    items: [
      { id, item: { <part>: value } }   // item keyed by data_model part:
    ]                                   //   item.data -> {…parsed}, item.images -> [web paths]
  }
  ```
  - **`id` (the `{slug}`)** = the item **folder name** by default, **overridden by
    `item.data.slug`** when present — both run through `slugify` (URL-safe).
  - `ctx.lib.slugify` is available, so a **custom** generator derives the same slug consistently.
- Generators read `ctx.collection.items` instead of doing file I/O — the built-in
  `generate-detail.js` loses its `fs` scan + `IMAGE_EXTS` + path-building.

**Caveats**
- **Breaking for model-using collections that omit `copy`** (Task 2 defaulted it to `true`;
  Track A makes omission mean "not copied, with a warning"). A collection with **no**
  `data_model` still copies the whole folder (back-compat) — model-less sites are untouched.
  Sites with a model must mark each part's `copy` explicitly. Note this in the data_model
  migration.
- **`data` parsing** assumes JSON (`product.json`). Generalizing (other formats / typed data)
  is Track B / later — keep it JSON here.
- It **re-touches the generator contract** (`ctx.collection` gains `items`). One more small
  migration — but it deletes file I/O from generators, which is the point.

---

## Track B — Declarative data → placeholder mapping (`generatorOptions.map`)

**Goal:** fill a template's `{{PLACEHOLDERS}}` from item data declaratively, so a **standard
detail page needs no custom generator** — just `data_model` + template + `map` + components.
Custom generators stay as the escape hatch (e.g. pulling the collection as an array of objects
and reshaping it freely).

**Design**
- `generatorOptions.map` maps placeholders to **`$`-prefixed paths into the item**, e.g.
  `"map": { "PRODUCT_NAME": "$data.name", "PRODUCT_PRICE": "$data.price" }` — the `$` marks a data
  reference (vs. a literal), and paths are relative to `item` (`$images` = `item.images`). The
  engine fills the template per item from the map + `ctx.collection.items[i].item`.
- **`generatorOptions.generator` becomes optional.** Absent ⇒ the engine's built-in behavior
  (one page per collection item, template filled via `map`). Present ⇒ the named generator runs
  (custom; it receives `ctx.collection.items` and may restructure however it likes). So
  "generator-free" is just "no generator named", not a new concept.
- **Validation relaxes**: `generator` is no longer required; if absent, `source` (a collection)
  + `map`/template are what's needed; if present it must still resolve.

**The carousel — the elegant goal (and the real challenge).** Computed output (the image
carousel) is not a field lookup, and we won't build an expression language. Instead the carousel
becomes a **`carousel` component** that takes `images` and renders itself — so map + components
cover everything and the standard product detail page is **pure config**. The catch to design:
a generated page's components need **per-item** data (this item's `images`), but components today
take static vars from the page config. So Track B/C must let the **map feed per-item fields into
a page's component vars** (an "item scope"), e.g.
`components: [{ name: "carousel", vars: { IMAGES: "$images" } }]`. That plumbing — per-item data
reaching per-page components — is the crux of the elegant solution; settle its shape before
building the carousel.

**Recommendation:** land flat `map` first (it pairs with Track A); then the carousel component +
per-item component vars (needs Track C). Keep this to mapping + components — rich typing /
transforms stay out.

---

## Track C — Material registration & folder trees (the hybrid)

**Goal:** nested sub-components in their own folders with **engine-bundled** assets; optional
explicit indexing — without losing zero-config.

**Design (build on what exists)**
- The engine **already** has `components/registry.json` (`name → folder`) and declarative
  `subComponents`. This track *extends* them:
  - A sub-component may live in **its own folder inside the parent** (`faq/faq_item/`,
    `products/product_item/`), declared in the parent's `.json` (or the registry).
  - The engine **bundles that sub-component's `style.css`/`script.js`** as it does a top-level
    component's. (Today sub-components don't get their own bundled assets — this is the main
    new behavior.) This is what lets a `carousel`/`product_item` exist without a custom
    build script just to assemble + bundle it.
- **Per-folder manifest** (your point 4) — **deferred** to a later pass. v1 is just
  *sub-components in folders + bundled assets*; the manifest (non-convention names, multiple
  css/js per folder) comes later.
- **Hybrid (your point 7):** scan by convention by **default**; the registry is purely
  **additive**. The engine runs with **no** registration (today's behavior) — registration is
  opt-in capability, not a regime change.

**Caveats**
- A lot of this is *extension*, not new — keep it from re-inventing the existing
  subComponent/registry machinery.
- The main new behavior is **bundling a sub-component's `style.css`/`script.js`** (today they
  don't get their own assets); wire registered sub-components into asset collection.

---

## Track D — `routing.json` (recommend: separate task, later)

**Goal:** map URLs to page folders, allow nested URLs (`shop/product-256`, `app/dashboard`),
and optionally move `generatorOptions` into the routing layer.

**Why I'd split it out**
- It's a **distinct, large** concern: URL structure, **nested output paths**, link
  resolution/normalization — and it touches *every* page, not just collections/materials.
- It **collides with a decision we just shipped**: `generatorOptions` lives in the page config
  and *marks* a template page. Moving it into `routing.json` is churn we shouldn't take while
  the data/indexing tracks are in flight.
- You're "evaluating relevance" — exactly right. Prove the data + indexing tracks first, then
  decide whether routing earns its complexity.

**Recommendation:** defer to its own task; keep `generatorOptions` in the page config for now.

---

## Cross-cutting: scan vs. register

The safe answer to the fork you raised:
- **Scan-by-convention stays the default** — it's the engine's charm ("drop a file, it's found").
- **Registration is additive** — it unlocks folder-trees, non-convention names, multi-asset,
  and explicit indexing, but is **never required**.
- **"Operate without registration" = today's behavior.** So this is opt-in *capability*, not a
  switch that turns the old model off.

## Per-track commit plans

Recommended overall order: **A1 → A2 → B1 → C1 → C2 → B2 → C3**. The carousel capstone (C3)
needs A + B + C together. Each commit is "code + smoke fixtures"; docs ride the last commit of a
track. Site migration is a separate pass after C.

### Track A — finish the data model
- **A1 — item resolution + `ctx.collection` shape.** Add `type` surfacing (`object`/`paths`/
  `file_path`, first-match+warn); build `ctx.collection = { options, dir, webPath, items: [{ id,
  item }] }` (`id` from folder / slugified `item.data.slug`); warn on omitted `copy`/`required`/
  `type`, **collected and printed grouped at the end** (repeat-count + action text). `copy`
  default unchanged here (additive) — generators *may* read `items`. Smoke: item shape/surfacing,
  slug override, grouped warnings.
- **A2 — flip `copy` default + migrate the built-in.** Omitted `copy` ⇒ not copied (warned);
  `generate-detail.js` reads `ctx.collection.items` (drop `fs`/`IMAGE_EXTS`/path-building); make
  the engine `example/` + `data_model` fixtures explicit (`copy`/`required`/`type`). Smoke:
  `product.json` absent from `build/` by default, detail pages still build from `items`. Docs +
  migration note.

### Track B — declarative mapping
- **B1 — `generatorOptions.map` + generator optional.** Fill template placeholders from
  `$`-paths into `item`; `generator` becomes optional (absent ⇒ built-in "one page per item via
  `map`"); relax Phase-4 validation; add `map`-path validation (bad path → error w/ path; miss →
  warn). Smoke: a generator-free template page renders via `map`; bad path errors; miss warns.
- **B2 — per-item component vars.** Resolve a template page's component `vars` `$`-paths against
  the item (the "item scope"), so `{ name: "carousel", vars: { IMAGES: "$images" } }` works.
  (The carousel *component* lands in C3.) Smoke: a component in a generated page gets per-item data.

### Track C — material registration & folder trees
- **C1 — nested sub-component folders.** Resolve a sub-component living in its own folder inside
  the parent (`faq/faq_item/`), declared in the parent `.json` / registry; per-file resolution
  within the tree. Scan stays default; registry additive. Smoke: a nested sub-component renders.
- **C2 — bundle sub-component assets.** Collect + copy a registered sub-component's `style.css`/
  `script.js` as a component asset (the main new behavior). Smoke: nested sub-component CSS/JS
  reach `build/` and are linked.
- **C3 — carousel component + generator-free detail (capstone).** ✅ Shipped a top-level `carousel`
  component (`build.js` renders slides + thumbnails from `$images`; `script.js` injects controls
  client-side; `style.css`); the example product **and** custom detail pages became `data_model` +
  template + `map` + `carousel`, **no generator**. `generate-detail.js` was **retired** (engine
  registry emptied). Also fixed an A2 regression: the `products` grid now reads the model via the
  new `helpers.collection(name)` accessor instead of raw `build/` files. Smoke + example site test
  cover the generator-free detail + carousel + populated grid.

### Track D — routing
Its own plan when we get there (kept out of the above).

## Decisions (resolved) & remaining caveats

**Resolved**
- **Explicit parts** — a part is `{ match, type, copy, required }`; omitting `copy`/`required`/
  `type` **warns** (`copy`/`required` ⇒ `false`; `type` ⇒ `file_path`). `required: true` + no
  match in an item → **build error** (shipped in Task 2).
- **`type` surfaces a part:** `object` (parsed), `paths` (web-path array), `file_path` (one path;
  several matches → first sorted + warn). Omitting → `file_path` + warn.
- **Shape:** `ctx.collection = { options, dir, webPath, items: [{ id, item }] }` — `options`
  hoisted once; `dir`/`webPath` kept for custom generators; `item.data`/`item.images` keyed by
  `data_model` part. `id` (the `{slug}`) = the item folder name, **overridden by `item.data.slug`**
  — both `slugify`'d. `ctx.lib.slugify` is exposed so custom generators derive the same slug.
- **`map`** values are **`$`-prefixed** paths into `item` (`$data.name`, `$images`); `$` marks a
  data reference vs. a literal (`type` produces, `$` references — complementary). A *miss* (valid
  path, absent value) **warns**; a *bad path* **errors** with the path.
- **Output:** warnings/errors are **grouped at the end** of the build, with a repeat-count and the
  action text (so the explicit-part warnings read as guidance, not noise). A broader build/test
  output overhaul is a **separate task after** the current ones.
- `required` keeps its name (from Task 2). Scope = **no custom generator for standard detail
  pages** (generators stay as the escape hatch).
- Names: keep **`components/registry.json`**; mapping is **`generatorOptions.map`**.
- **Manifests deferred**; **routing is a separate later task**; **carousel → a real component**.

**Remaining caveats / watch-items**
- **The one big design item:** per-item data → per-page **component vars** (`{ name: "carousel",
  vars: { IMAGES: "$images" } }` resolving against `item`). Nail this mechanism in Track B/C
  before building the carousel.
- `generator`-optional relaxes the Phase-4 validation; keep the loud errors for what remains
  (unknown generator, missing source/collection, name collisions, bad `map` paths).
- **Coordinate the default-flip:** the commit that flips `copy` must also make the engine
  `example/` + the `data_model` fixtures explicit (`copy`/`required`/`type`), or they warn-flood.
- **A small follow-on site migration** once the generator-free path + carousel land: product
  detail moves to "template + `map` + carousel", and we decide if `generate-detail.js` stays as
  an example custom generator or retires.

**The target end state:** a standard product/custom detail page is *pure config* —
`data_model` + a template page + a `map` + a `carousel` component — with **no site-authored
generator**. Custom generators (and `*.build.js`) remain the escape hatch for the non-standard
cases.
