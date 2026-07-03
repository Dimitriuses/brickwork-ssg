// Products Component - Client-side pagination
// All product cards are rendered into the page at build time; this script
// shows one "page" of cards at a time and renders Bootstrap pagination
// controls. The page size is set in advance via the `PRODUCTS_PER_PAGE`
// component variable, exposed on the section as data-products-per-page.

(function () {
  function initProductsPagination(section) {
    const perPage = parseInt(section.getAttribute('data-products-per-page'), 10);
    const grid = section.querySelector('.products-grid');
    const nav = section.querySelector('.products-pagination');
    if (!grid || !nav) return;

    const items = Array.from(grid.children);

    // Pagination disabled when not configured, invalid, or everything fits on one page.
    if (!Number.isFinite(perPage) || perPage < 1 || items.length <= perPage) {
      if (nav) nav.remove();
      return;
    }

    const pageCount = Math.ceil(items.length / perPage);
    let current = 1;

    function showPage(page, scroll) {
      current = Math.min(Math.max(1, page), pageCount);
      const start = (current - 1) * perPage;
      const end = start + perPage;

      items.forEach((item, i) => {
        item.style.display = i >= start && i < end ? '' : 'none';
      });

      renderControls();

      if (scroll) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function makeItem(label, page, opts) {
      opts = opts || {};
      const li = document.createElement('li');
      li.className = 'page-item' +
        (opts.active ? ' active' : '') +
        (opts.disabled ? ' disabled' : '');

      const a = document.createElement('a');
      a.className = 'page-link';
      a.href = '#';
      a.innerHTML = label;
      if (opts.ariaLabel) a.setAttribute('aria-label', opts.ariaLabel);

      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (opts.disabled || opts.active) return;
        showPage(page, true);
      });

      li.appendChild(a);
      return li;
    }

    function renderControls() {
      const ul = document.createElement('ul');
      ul.className = 'pagination justify-content-center';

      ul.appendChild(makeItem('&laquo;', current - 1, {
        disabled: current === 1,
        ariaLabel: 'Previous'
      }));

      for (let p = 1; p <= pageCount; p++) {
        ul.appendChild(makeItem(String(p), p, { active: p === current }));
      }

      ul.appendChild(makeItem('&raquo;', current + 1, {
        disabled: current === pageCount,
        ariaLabel: 'Next'
      }));

      nav.innerHTML = '';
      nav.appendChild(ul);
    }

    showPage(1, false);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.products-section').forEach(initProductsPagination);
  });
})();
