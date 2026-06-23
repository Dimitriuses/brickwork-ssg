// Shared slug helper for the build pipeline.
//
// A collection folder name (e.g. "product-005  (30)") is used both as an HTML
// element id (id="carousel-<name>" / data-bs-target="#carousel-<name>") and to
// derive the product page filename + link. Spaces, parentheses and other
// characters make invalid CSS selectors and ugly URLs, so every such use must
// go through slugify() to produce a safe, selector- and URL-safe id [a-z0-9-].
//
// Both the products component and the product-page generator call this with the
// same input, so a card's link always matches its generated page. Matches the
// scheme in rename-products.py so on-disk renames and build output agree.
function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric runs -> single hyphen
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

module.exports = { slugify };
