// Footer Component Build Script
// Builds the footer "Links" list from the same config.json `nav` array used by
// the header (flattened onto vars.NAV as [{ label, url }, ...]), using the
// footer's own link markup. {{COMPONENT:contactIcons}} is resolved afterwards
// by buildComponent.

const { raw, escapeHtml } = require('../../lib/html');

function build(vars, loadComponent, replaceVariables) {
  const navItems = Array.isArray(vars.NAV) ? vars.NAV : [];

  const linksHtml = navItems.map(item =>
    `<li><a href="${escapeHtml(item.url || '#')}" class="text-white-50">${escapeHtml(item.label || '')}</a></li>`
  ).join('\n          ');

  const footerVars = {
    ...vars,
    FOOTER_LINKS: raw(linksHtml)
  };

  const template = loadComponent('footer');
  return replaceVariables(template, footerVars);
}

module.exports = { build };
