# Material indexing, data, & routing — draft plan (for discussion)

> **Status: draft.** Captures the ideas for the "`*.json` material indexing & folder trees"
> roadmap item, proposes splitting them into tracks, and records recommendations + open
> questions. Nothing here is decided — it's a starting point to argue with.

## The pieces you outlined

1. **Finish `data_model`** — default `copy: false`, and the engine hands generators
   `ctx.collection.items = [{ data, images: [webPaths] }]`.
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
- Make **`copy` explicit**: `copy: true` ships the part, `copy: false` keeps it out — and
  **omitting `copy` warns** and treats the part as *not copied* ("part X has no `copy`; its
  files will NOT be copied — set `copy: true` to ship or `copy: false` to silence"). So a real
  model is `images: { match: "...", copy: true }`, `data: { match: "product.json", copy: false }`
  — both explicit, no warnings.
- The engine resolves each item via the model: parse the **`data`** part (JSON for now) into
  `data`; resolve the **`images`** matches to web paths under `destination`. It hands the
  generator `ctx.collection.items = [{ slug, data, images: [webPaths] }]`.
- Generators read `ctx.collection.items` instead of doing file I/O. The built-in
  `generate-detail.js` loses its `fs` scan + `IMAGE_EXTS` + carousel path-building and just
  maps items → descriptors.

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
- `generatorOptions.map` maps placeholders to dot-paths into the item, e.g.
  `"map": { "PRODUCT_NAME": "data.name", "PRODUCT_PRICE": "data.price" }` (`data.*`, `images.*`).
  The engine fills the template per item from the map + `ctx.collection.items[i]`.
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
`components: [{ name: "carousel", vars: { IMAGES: "images" } }]`. That plumbing — per-item data
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
- `copy` is **explicit**: `true` ships, `false` keeps out; **omitting it warns** and treats the
  part as not-copied (explicit `false` is silent).
- Scope = **no custom generator for standard detail pages**; generators stay as a customization
  tool (incl. reshaping the collection into arbitrary arrays of objects).
- Names: keep **`components/registry.json`**; mapping is **`generatorOptions.map`**.
- **Manifests deferred**; v1 = sub-components in folders + bundled assets.
- **Routing is a separate, later task**; `generatorOptions` stays in the page config for now.
- **Carousel → a real component**, aiming at generator-free product-detail rendering.

**Remaining caveats / watch-items**
- Make the omitted-`copy` warning **actionable** ("part X has no `copy` — its files will NOT
  ship; set `copy: true`/`false`"). It's easy to lose images by forgetting `copy: true`.
- The hard plumbing is **per-item data → per-page components** (carousel images). Settle that
  shape (the `map` targeting component vars / an item scope) before building the carousel.
- `ctx.collection.items` is the shared substrate for **both** the generator-free path and custom
  generators — get its shape (`{ slug, data, images }`) right once.
- `generator`-optional relaxes the Phase-4 validation; keep the loud errors for what remains
  (unknown generator, missing source/collection, name collisions, and now **bad `map` paths**).

**The target end state:** a standard product/custom detail page is *pure config* —
`data_model` + a template page + a `map` + a `carousel` component — with **no site-authored
generator**. Custom generators (and `*.build.js`) remain the escape hatch for the non-standard
cases.
