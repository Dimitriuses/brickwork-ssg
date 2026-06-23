// Header Component Build Script
// Builds the navbar from config.json: the logo (site.logo) and the nav items
// (top-level `nav` array, flattened onto vars.NAV as [{ label, url }, ...]).

const { raw, escapeHtml } = require('../../lib/html');

function build(vars, loadComponent, replaceVariables) {
  const navItems = Array.isArray(vars.NAV) ? vars.NAV : [];

  const navHtml = navItems.map(item => `
        <li class="nav-item">
          <a class="nav-link" href="${escapeHtml(item.url || '#')}">${escapeHtml(item.label || '')}</a>
        </li>`).join('');

  const headerVars = {
    ...vars,
    // Fall back to the bundled logo if none is configured.
    SITE_LOGO: vars.SITE_LOGO || 'assets/images/logo.jpg',
    NAV_ITEMS: raw(navHtml)
  };

  const template = loadComponent('header');
  return replaceVariables(template, headerVars);
}

module.exports = { build };
