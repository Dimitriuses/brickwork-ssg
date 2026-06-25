// Example SITE-authored component (lives in the site, not the engine). Proves a
// site can ship its own component - template + build logic + CSS - resolved
// site-first by brickwork-ssg (Phase A), and that it can declare its own
// sub-component in pricing.json (Phase B): each plan renders via `priceRow`.
function build(vars, loadComponent, replaceVariables) {
  const plans = Array.isArray(vars.PLANS) ? vars.PLANS : [];
  const row = loadComponent('priceRow');
  const items = plans
    .map(p => replaceVariables(row, { NAME: p.name, PRICE: p.price }))
    .join('');
  return loadComponent('pricing')
    .replace('{{PRICING_TITLE}}', vars.PRICING_TITLE || 'Plans')
    .replace('{{PRICING_ITEMS}}', items);
}

module.exports = { build };
