// Example SITE-authored component. Proves a site can ship its own component
// (Phase A), declare a sub-component in pricing.json (Phase B), and receive the
// engine's helpers as a 4th argument (Phase C) - here `raw` to insert the
// assembled rows as HTML via replaceVariables.
function build(vars, loadComponent, replaceVariables, helpers) {
  const { raw } = helpers;
  const plans = Array.isArray(vars.PLANS) ? vars.PLANS : [];
  const row = loadComponent('priceRow');
  const items = plans
    .map(p => replaceVariables(row, { NAME: p.name, PRICE: p.price }))
    .join('');
  // `price_note` is a nested sub-component (its own folder + style.css under pricing/).
  const note = replaceVariables(loadComponent('price_note'), { NOTE: vars.NOTE || 'Prices exclude tax.' });
  return replaceVariables(loadComponent('pricing'), {
    PRICING_TITLE: vars.PRICING_TITLE || 'Plans',
    PRICING_ITEMS: raw(items),
    PRICE_NOTE: raw(note)
  });
}

module.exports = { build };
