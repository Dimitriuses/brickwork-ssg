// HTML escaping + a marker for trusted pre-built HTML.
//
// replaceVariables() escapes plain string/number values by default so that
// text from config.json, page JSON and product.json cannot inject markup.
// Component build scripts that assemble HTML fragments (carousels, lists,
// icons, the page body, ...) wrap those in raw() so they are inserted verbatim.
//
// Lives in lib/ so build.js and every component build script share one RawHtml
// class identity (require cache), which `value instanceof RawHtml` relies on.

class RawHtml {
  constructor(value) {
    this.value = value == null ? '' : String(value);
  }
  toString() {
    return this.value;
  }
}

// Wrap a value so replaceVariables() inserts it without HTML-escaping.
function raw(value) {
  return value instanceof RawHtml ? value : new RawHtml(value);
}

// Escape the five HTML-significant characters.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { RawHtml, raw, escapeHtml };
