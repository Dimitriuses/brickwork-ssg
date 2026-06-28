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
- Flip the per-part `copy` default to **`false`** — "safe by default": a part ships only if
  marked `copy: true`. So a real model becomes
  `images: { match: "...", copy: true }`, `data: { match: "product.json" }` (not copied).
- The engine resolves each item via the model: parse the **`data`** part (JSON for now) into
  `data`; resolve the **`images`** matches to web paths under `destination`. It hands the
  generator `ctx.collection.items = [{ slug, data, images: [webPaths] }]`.
- Generators read `ctx.collection.items` instead of doing file I/O. The built-in
  `generate-detail.js` loses its `fs` scan + `IMAGE_EXTS` + carousel path-building and just
  maps items → descriptors.

**Caveats**
- **Default-flip is a small breaking change**, but scoped: it only affects *parts inside a
  `data_model` that omit `copy`*. A collection with **no** `data_model` still copies the whole
  folder (back-compat) — so model-less sites are untouched. Sites that adopt a model must mark
  their asset parts `copy: true`. Document this in the data_model migration note.
- **`data` parsing** assumes JSON (`product.json`). Generalizing (other formats / typed data)
  is Track B / later — keep it JSON here.
- It **re-touches the generator contract** (`ctx.collection` gains `items`). One more small
  migration — but it deletes file I/O from generators, which is the point.

---

## Track B — Declarative data → placeholder mapping

**Goal:** fill a template's `{{PLACEHOLDERS}}` from item data declaratively, so the standard
generator shrinks toward nothing.

**Design**
- `generatorOptions` gains a map, e.g. `"map": { "PRODUCT_NAME": "data.name", "PRODUCT_PRICE":
  "data.price" }` — left = template placeholder, right = a **dot-path** into the item
  (`data.*`, `images.*`).
- The engine fills the template per item from the map + `ctx.collection.items[i]`. The
  generator supplies only what the map can't.

**The hard part (caveat).** Flat fields map cleanly; **computed** vars do not — the carousel
HTML built from `images` isn't a field lookup. **Do not build an expression language.** Two
ways out:
- **(a) Pragmatic:** map flat fields; the generator returns the computed vars (carousel) which
  merge in. Generators shrink but don't vanish.
- **(b) Elegant:** make the computed bits **components** — a `carousel` sub-component that takes
  `images` and renders itself. Then map + components cover everything and **the standard
  detail page needs no custom generator at all** (just `data_model` + template + `map` +
  a carousel component). This depends on Track C (folder-trees).

**Recommendation:** start with **(a)**, aim at **(b)** as Track C lands. Keep this to *flat
mapping* — the rich typing/transforms (the old "Task 4") stay out for now.

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
- **Optional per-folder manifest** (your point 4): a folder may list its files explicitly
  (`html`/`css`/`js`/`build.js`). It buys **non-convention filenames** and **multiple
  css/js per folder** (itself a deferred roadmap item). Absence = today's scan-by-convention.
- **Hybrid (your point 7):** scan by convention by **default**; registry + manifest are purely
  **additive**. The engine runs with **no** registration (today's behavior) — registration is
  opt-in capability, not a regime change.

**Caveats**
- A lot of this is *extension*, not new — keep it from re-inventing the existing
  subComponent/registry machinery.
- The manifest adds a config surface; keep it optional and minimal. It only earns its keep if
  you actually want multi-asset folders / non-convention names — decide that explicitly.

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

## Notes / caveats / open questions

- **Track A default-flip:** confirm "safe by default" — `copy` default `false` means every
  web-asset part needs an explicit `copy: true`. Good trade (leak-safe) but more verbose. OK?
- **Track B scope:** OK to start with **flat-field mapping** + generators for computed (no
  expression language)? And the end-goal of **no custom generator** for standard detail pages?
- **Track C manifest:** is the optional file manifest worth the surface now, or is
  "sub-components in folders + bundled assets" enough for v1 (manifest later, with multi-asset)?
- **Track D:** agree to split routing into its own later task and keep `generatorOptions` in the
  page config?
- **Naming:** the data→placeholder map — `generatorOptions.map`? `fields`? `bind`? And the
  registry for trees — extend `components/registry.json`, or a new `components.json`?
- **One nice consequence to aim for:** A + B + C together mean the standard product/custom
  detail page is *pure config* — `data_model` + a template page + a `map` + a `carousel`
  component — with **no site-authored generator**. Custom generators (and `*.build.js`) remain
  the escape hatch for the non-standard 5%.
