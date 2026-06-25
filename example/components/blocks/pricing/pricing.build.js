// Example SITE-authored component (lives in the site, not the engine). Proves a
// site can ship its own component - template + build logic + CSS - resolved
// site-first by brickwork-ssg (Phase A).
function build(vars, loadComponent, replaceVariables) {
  const plans = Array.isArray(vars.PLANS) ? vars.PLANS : [];
  const items = plans
    .map(p => `<li><strong>${p.name}</strong> &mdash; ${p.price}</li>`)
    .join('');
  return loadComponent('pricing')
    .replace('{{PRICING_TITLE}}', vars.PRICING_TITLE || 'Plans')
    .replace('{{PRICING_ITEMS}}', items);
}

module.exports = { build };
