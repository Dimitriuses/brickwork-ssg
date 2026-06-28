# Material indexing, data, & routing — draft plan (for discussion)

> **Status: draft.** Captures the ideas for the "`*.json` material indexing & folder trees"
> roadmap item, proposes splitting them into tracks, and records recommendations + open
> questions. Nothing here is decided — it's a starting point to argue with.

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
    *(The field already exists from Task 2 as `required`, with the error + a test; Track A adds
    the warn-on-omit. Confirm the name — you wrote `require`; we shipped `required`.)*
  - `type` — how to **surface** the part into the item: `object` (file parsed → object; JSON for
    now), `paths` (matched files → array of web paths), or `file_path` (one file → a path).
    **Omitting defaults to `file_path` and warns** ("specify `type` if it isn't `file_path`").
    Minimal slice of the deferred richer typing.

  A real model:
  `images: { match: "...", type: "paths", copy: true, required: false }`,
  `data: { match: "product.json", type: "object", copy: false, required: true }`.
- The engine hands generators a **hoisted-options** shape (options once, not per item):
  ```
  ctx.collection = {
    options,                            // the template's generatorOptions
    items: [
      { id, item: { <part>: value } }   // item keyed by data_model part:
    ]                                   //   item.data -> {…parsed}, item.images -> [web paths]
  }
  ```
  - **`id` (the `{slug}`)** = the item **folder name** (slugified) by default, **overridden by
    `item.data.slug`** when present.
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

## Suggested order & rough size

1. **Track A** — data completion. ~2–3 commits (flip default + `ctx.collection.items` +
   migrate `generate-detail.js`; tests; docs).
2. **Track B (flat)** — mapping. ~2 commits (map fill + generator merge; tests).
3. **Track C** — registration / folder-trees. ~3–4 commits (sub-component folders + asset
   bundling; optional manifest; tests; docs). The biggest of the three.
4. **Track D** — routing. Its own plan when we get there.

Each track is sequenced so the next can rely on it (B's "elegant" path needs C; the
carousel-as-component end state is A+B+C together).

## Decisions (resolved) & remaining caveats

**Resolved**
- **Explicit parts** — a part is `{ match, type, copy, required }`; omitting `copy`/`required`/
  `type` **warns** (`copy`/`required` ⇒ `false`; `type` ⇒ `file_path`). `required: true` + no
  match in an item → **build error** (shipped in Task 2).
- **`type` surfaces a part:** `object` (file parsed → object, JSON for now), `paths` (matched
  files → web-path array), `file_path` (one file → a path).
- **Shape:** `ctx.collection = { options, items: [{ id, item }] }` — `options` hoisted once;
  `item.data` / `item.images` keyed by `data_model` part. `id` (the `{slug}`) = the item folder
  name, **overridden by `item.data.slug`**. `ctx.lib.slugify` is exposed so custom generators
  derive the same slug.
- **`map`** values are **`$`-prefixed** paths into `item` (`$data.name`, `$images`); `$` marks a
  data reference vs. a literal (`type` produces, `$` references — complementary). A *miss* (valid
  path, absent value) **warns**; a *bad path* **errors** with the path.
- Scope = **no custom generator for standard detail pages** (generators stay as the escape hatch).
- Names: keep **`components/registry.json`**; mapping is **`generatorOptions.map`**.
- **Manifests deferred**; **routing is a separate later task**; **carousel → a real component**.

**Remaining caveats / watch-items**
- **The one big design item:** per-item data → per-page **component vars** (`{ name: "carousel",
  vars: { IMAGES: "$images" } }` resolving against `item`). Nail this mechanism in Track B/C
  before building the carousel.
- **Name: `require` vs `required`.** Task 2 shipped **`required`** (field + error + test); you
  wrote `require`. Keep `required` (consistent, already implemented) or rename — quick call.
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
