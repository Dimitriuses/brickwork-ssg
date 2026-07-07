// Contact Icons Component Build Script
// Renders social/contact icon links from config.json's `social` object, surfaced as the structured
// `SOCIAL` var (the engine keeps top-level config objects whole, alongside the flattened scalars) —
// so this reads `vars.SOCIAL` instead of re-reading config.json from disk.
// Self-contained: engine helpers come from the 4th `helpers` arg, so a deployed copy needs no engine
// lib/ on a relative path; the Viber glyph is inlined (no external image dependency to deploy).

function build(vars, loadComponent, replaceVariables, { raw, escapeHtml }) {
  // Bootstrap Icons for the known platforms. Viber has no Bootstrap icon, so it renders an inline SVG
  // (a phone glyph) — self-contained, unlike the old hardcoded assets/images/*.svg a fresh adopting
  // site never had.
  const iconMap = {
    'telegram': { icon: 'bi-telegram', label: 'Telegram' },
    'whatsapp': { icon: 'bi-whatsapp', label: 'WhatsApp' },
    'instagram': { icon: 'bi-instagram', label: 'Instagram' },
    'signal': { icon: 'bi-signal', label: 'Signal' },
    'viber': { inlineSvg: true, label: 'Viber' },
    'facebook': { icon: 'bi-facebook', label: 'Facebook' },
    'twitter': { icon: 'bi-twitter', label: 'Twitter' },
    'linkedin': { icon: 'bi-linkedin', label: 'LinkedIn' },
    'youtube': { icon: 'bi-youtube', label: 'YouTube' },
    'github': { icon: 'bi-github', label: 'GitHub' },
    'email': { icon: 'bi-envelope', label: 'Email' },
    'phone': { icon: 'bi-telephone', label: 'Phone' }
  };

  // A self-contained inline SVG (Bootstrap Icons "telephone" glyph, currentColor) used for Viber.
  const viberSvg = '<svg class="bi" width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">'
    + '<path d="M3.654 1.328a.678.678 0 0 0-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.6 17.6 0 0 0 4.168 6.608 17.6 17.6 0 0 0 6.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 0 0-.063-1.015l-2.307-1.794a.68.68 0 0 0-.58-.122l-2.19.547a1.75 1.75 0 0 1-1.657-.459L5.482 8.062a1.75 1.75 0 0 1-.46-1.657l.548-2.19a.68.68 0 0 0-.122-.58z"/></svg>';

  // Read social links from the structured config var (fall back to an empty object).
  const socialLinks = (vars && typeof vars.SOCIAL === 'object' && vars.SOCIAL) ? vars.SOCIAL : {};

  let iconsHtml = '';
  Object.entries(socialLinks).forEach(([platform, url]) => {
    if (!url) return; // skip empty links
    const iconInfo = iconMap[platform.toLowerCase()];
    if (!iconInfo) return; // skip unknown platforms

    // Escape the URL (attribute-safe) — every other build script escapes; this one didn't. rel=noopener
    // hardens the target=_blank links.
    const href = escapeHtml(url);
    const label = escapeHtml(iconInfo.label);
    const inner = iconInfo.inlineSvg ? viberSvg : `<i class="bi ${iconInfo.icon}"></i>`;
    iconsHtml += `
          <a href="${href}" target="_blank" rel="noopener" aria-label="${label}">
            ${inner}
          </a>`;
  });

  if (!iconsHtml.trim()) {
    iconsHtml = '<!-- No social links configured in config.json -->';
  }

  const template = loadComponent('contactIcons');
  return replaceVariables(template, { SOCIAL_ICONS: raw(iconsHtml) });
}

module.exports = { build };
