// Shared slug helper for the build pipeline.
//
// A collection folder name (e.g. "product-005  (30)") is used both as an HTML
// element id (id="carousel-<name>" / data-bs-target="#carousel-<name>") and to
// derive the product page filename + link. Spaces, parentheses and other
// characters make invalid CSS selectors and ugly URLs, so every such use must
// go through slugify() to produce a safe, selector- and URL-safe id [a-z0-9-].
//
// Both the products component and the product-page generator call this with the
// same input, so a card's link always matches its generated page.
//
// Unicode-aware: it keeps any Unicode letter/number (\p{L}\p{N}) rather than only [a-z0-9], so a
// non-Latin name (e.g. Ukrainian «Цегла червона» -> "цегла-червона") produces a distinct, usable id
// instead of collapsing to the "item" fallback (which made every non-Latin item collide). ASCII input
// is unchanged ("Product 005 (30)" -> "product-005-30"). The "item" fallback now fires only for a name
// with no letters or numbers at all (e.g. punctuation only) — a genuine collision there surfaces as
// the build's loud page-name-collision error, and can be resolved with a per-item `data.slug`.
function slugify(name) {
  return String(name)
    .normalize('NFKC')                    // fold compatibility forms first
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')     // runs of non-(letter|number) -> single hyphen
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

module.exports = { slugify };
