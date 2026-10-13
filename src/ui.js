// Binds the Webflow component to consent actions. Reads attributes only;
// classes, copy, and layout stay in the Designer.
//
//   [data-tc="root"]           wraps everything below
//   [data-tc="banner"]         first-visit banner
//   [data-tc="preferences"]    category panel
//   [data-tc="float"]          persistent "Preferences" button, shown once a choice exists
//   [data-tc-category="…"]     row (or input) for one category inside the panel
//   [data-tc-action="…"]       accept-all | reject-all | open-preferences | save | close | toggle
//   [data-tc-element="open-preferences"]  any element anywhere, e.g. a footer link
//   [data-tc-element="accordion"]         collapsible box; any `toggle` inside it (chevron button,
//                                         title) flips data-tc-open, and every toggle reflects the state
//   [data-tc-element="details"]           the part of an accordion that is hidden while closed
//   [data-tc-element="chevron"]           rotates 180° while its accordion is open
//   [data-tc-element="switch"]            wrapper around a category checkbox (optional)
//   [data-tc-vendor]                      vendor block inside a row's details. Empty or "sample" = template,
//                                         replaced by the detected vendors; any other value = hand-written, kept
//   [data-tc-field="vendor-name|vendor-privacy|cookie|cookie-name|cookie-purpose|cookie-duration|empty"]
//                                         slots inside the vendor template and the per-row empty message
//
// State classes, so the Designer can style states as combo classes:
//   is-on    on the switch wrapper and its children while the checkbox is checked
//   is-open  on an accordion, its toggle, and its chevron while data-tc-open="true"

import { isAllowed } from './consent.js';

const FOCUSABLE = 'button, [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
const ACTIONABLE = '[data-tc-action], [data-tc-element="open-preferences"]';

export function bindUI(doc, handlers) {
  const root = doc.querySelector('[data-tc="root"]');
  const banner = root ? root.querySelector('[data-tc="banner"]') : null;
  const prefs = root ? root.querySelector('[data-tc="preferences"]') : null;
  const float = root ? root.querySelector('[data-tc="float"]') : null;
  let lastFocus = null;
  let chosen = false;

  function isVisible(el) {
    return Boolean(el) && el.getAttribute('data-tc-visible') === 'true';
  }

  function setVisible(el, on) {
    if (!el) return;
    if (on) el.setAttribute('data-tc-visible', 'true');
    else el.removeAttribute('data-tc-visible');
  }

  function update() {
    const panelsOpen = isVisible(banner) || isVisible(prefs);
    setVisible(float, chosen && !panelsOpen);
    setVisible(root, panelsOpen || isVisible(float));
  }

  function focusFirst(el) {
    const target = el && el.querySelector(FOCUSABLE);
    if (target) target.focus();
  }

  function showBanner() {
    setVisible(prefs, false);
    setVisible(banner, true);
    update();
  }

  function showPreferences() {
    if (!prefs) return;
    if (handlers.beforeOpen) handlers.beforeOpen();
    if (!lastFocus) lastFocus = doc.activeElement;
    setVisible(banner, false);
    setVisible(prefs, true);
    update();
    focusFirst(prefs);
  }

  function hideAll() {
    setVisible(banner, false);
    setVisible(prefs, false);
    update();
    if (lastFocus && typeof lastFocus.focus === 'function' && doc.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  function rows() {
    if (!root) return [];
    const out = [];
    root.querySelectorAll('[data-tc-category]').forEach((row) => {
      const input = row.matches('input') ? row : row.querySelector('input[type="checkbox"]');
      if (input) out.push({ category: row.getAttribute('data-tc-category'), input });
    });
    return out;
  }

  function setClass(el, name, on) {
    if (!el || !el.classList) return;
    if (on) el.classList.add(name);
    else el.classList.remove(name);
  }

  /** Mirrors a checkbox into the is-on class on its switch wrapper and the wrapper's children. */
  function reflect(input) {
    const wrap = input.closest('[data-tc-element="switch"]') || input.parentElement;
    if (!wrap || wrap === root) return;
    setClass(wrap, 'is-on', input.checked);
    for (const child of wrap.children) setClass(child, 'is-on', input.checked);
  }

  /** Reflects consent into the checkboxes and the float button. Essential stays checked and disabled. */
  function sync(consent) {
    chosen = Boolean(consent && consent.chosen);
    for (const { category, input } of rows()) {
      input.checked = isAllowed(consent, category);
      if (category === 'essential') {
        input.checked = true;
        input.disabled = true;
      }
      reflect(input);
    }
    update();
  }

  /** Reads the checkboxes into `{ analytics: bool, … }`. */
  function read() {
    const out = {};
    for (const { category, input } of rows()) {
      if (category !== 'essential') out[category] = input.checked;
    }
    return out;
  }

  // ---- Vendor list ----

  const templates = new Map(); // row -> vendor template (a clone taken before the samples are removed)
  let fallbackTemplate = null;

  function isSample(el) {
    const value = el.getAttribute('data-tc-vendor');
    return value === '' || value === 'sample';
  }

  function field(scope, name) {
    return scope.querySelectorAll(`[data-tc-field="${name}"]`);
  }

  function setText(scope, name, value) {
    field(scope, name).forEach((el) => {
      el.textContent = value;
    });
  }

  function resetOpenState(node) {
    node.removeAttribute('data-tc-open');
    node.classList.remove('is-open');
    node.querySelectorAll('.is-open').forEach((el) => el.classList.remove('is-open'));
    node.querySelectorAll('[aria-expanded]').forEach((el) => el.setAttribute('aria-expanded', 'false'));
    node.querySelectorAll('[data-tc-open]').forEach((el) => el.removeAttribute('data-tc-open'));
  }

  function fillVendor(template, vendor) {
    const node = template.cloneNode(true);
    node.setAttribute('data-tc-vendor', vendor.id);
    node.setAttribute('data-tc-generated', '');
    resetOpenState(node);
    setText(node, 'vendor-name', vendor.name);
    field(node, 'vendor-privacy').forEach((link) => {
      if (vendor.privacy) link.setAttribute('href', vendor.privacy);
      else link.remove();
    });
    const cookieTemplates = Array.from(field(node, 'cookie'));
    if (cookieTemplates.length) {
      const cookieTemplate = cookieTemplates[0];
      const parent = cookieTemplate.parentNode;
      cookieTemplates.forEach((el) => el.remove());
      vendor.cookies.forEach((cookie) => {
        const item = cookieTemplate.cloneNode(true);
        setText(item, 'cookie-name', cookie.name);
        setText(item, 'cookie-purpose', cookie.purpose);
        setText(item, 'cookie-duration', cookie.duration);
        parent.appendChild(item);
      });
    }
    return node;
  }

  /**
   * Fills every category row with the vendors detected for it. The first vendor block in a
   * row (`data-tc-vendor` empty or "sample") is the template; blocks with another value are
   * hand-written and kept. Safe to call repeatedly.
   */
  function renderVendors(vendors) {
    if (!root) return;
    const list = Array.isArray(vendors) ? vendors : [];
    const rowsWithDetails = [];
    root.querySelectorAll('[data-tc-category]').forEach((row) => {
      const details = row.querySelector('[data-tc-element="details"]');
      if (!details) return;
      rowsWithDetails.push([row, details]);
      if (templates.has(row)) return;
      const first = details.querySelector('[data-tc-vendor]');
      if (first) {
        templates.set(row, first.cloneNode(true));
        if (!fallbackTemplate) fallbackTemplate = templates.get(row);
      }
    });

    rowsWithDetails.forEach(([row, details]) => {
      const category = row.getAttribute('data-tc-category');
      const template = templates.get(row) || fallbackTemplate;
      if (!template) return;

      details.querySelectorAll('[data-tc-vendor]').forEach((el) => {
        if (isSample(el) || el.hasAttribute('data-tc-generated')) el.remove();
      });
      const kept = new Set();
      details.querySelectorAll('[data-tc-vendor]').forEach((el) => kept.add(el.getAttribute('data-tc-vendor')));

      const empty = details.querySelector('[data-tc-field="empty"]');
      const items = list.filter((v) => v.category === category && !kept.has(v.id));
      items.forEach((vendor) => {
        const node = fillVendor(template, vendor);
        if (empty) details.insertBefore(node, empty);
        else details.appendChild(node);
      });
      if (empty) {
        if (items.length || kept.size) empty.setAttribute('hidden', '');
        else empty.removeAttribute('hidden');
      }
    });
  }

  function toggle(target) {
    const box = target.closest('[data-tc-element="accordion"]');
    if (!box) return;
    const open = box.getAttribute('data-tc-open') !== 'true';
    box.setAttribute('data-tc-open', open ? 'true' : 'false');
    setClass(box, 'is-open', open);
    // An accordion may have several toggles (the chevron button and the title). All of
    // them reflect the new state, not only the one that was clicked. Toggles of nested
    // accordions belong to their own box and are skipped.
    box.querySelectorAll('[data-tc-action="toggle"]').forEach((el) => {
      if (el.closest('[data-tc-element="accordion"]') !== box) return;
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') el.setAttribute('aria-expanded', open ? 'true' : 'false');
      setClass(el, 'is-open', open);
      const chevron = el.querySelector('[data-tc-element="chevron"]') || (el.matches('[data-tc-element="chevron"]') ? el : null);
      setClass(chevron, 'is-open', open);
    });
  }

  function run(target, event) {
    const action = target.getAttribute('data-tc-action') || 'open-preferences';
    if (target.tagName === 'A' || target.closest('form')) event.preventDefault();

    switch (action) {
      case 'accept-all':
        handlers.acceptAll();
        break;
      case 'reject-all':
        handlers.rejectAll();
        break;
      case 'save':
        handlers.save(read());
        break;
      case 'open-preferences':
        showPreferences();
        break;
      case 'close':
        handlers.close();
        break;
      case 'toggle':
        toggle(target);
        break;
      default:
        break;
    }
  }

  doc.addEventListener('click', (event) => {
    const target = event.target && event.target.closest ? event.target.closest(ACTIONABLE) : null;
    if (!target) return;
    // A real link inside an action area (privacy policy inside a toggle header) keeps working.
    const link = event.target.closest('a[href]');
    if (link && link !== target && target.contains(link)) return;
    run(target, event);
  });

  // A switch flipped by the visitor updates its is-on class before "Save" is pressed.
  doc.addEventListener('change', (event) => {
    const input = event.target;
    if (!root || !input || !input.matches || !input.matches('input[type="checkbox"]') || !root.contains(input)) return;
    if (input.closest('[data-tc-category]')) reflect(input);
  });

  // Webflow checkboxes live inside a Form Block. Keep it from submitting.
  doc.addEventListener('submit', (event) => {
    if (root && root.contains(event.target)) event.preventDefault();
  });

  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isVisible(prefs)) {
      handlers.close();
      return;
    }
    // Divs with role="button" (Webflow has no button element outside forms) act on Enter and Space.
    if ((event.key === 'Enter' || event.key === ' ') && event.target && event.target.matches) {
      const target = event.target.matches(ACTIONABLE) && event.target.getAttribute('role') === 'button' ? event.target : null;
      if (target && target.tagName !== 'BUTTON' && target.tagName !== 'A') run(target, event);
    }
  });

  return { root, banner, prefs, float, hasUI: Boolean(root), showBanner, showPreferences, hideAll, sync, read, renderVendors };
}
