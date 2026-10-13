// Tiny Consent entry. Load synchronously as the first custom code in <head>:
//
//   <script src="https://your-host/tiny-consent.js"
//           data-tc-mode="opt-in"
//           data-tc-cookie-days="180"
//           data-tc-block="cdn.example.com:analytics"
//           data-tc-vendors="meta-pixel"
//           data-tc-geo="auto"
//           data-tc-regions="eu:opt-in, us-ca:opt-out, *:none"></script>
//
// The preferences panel lists the vendors detected on the page (see vendors.js).
// `data-tc-vendors` forces registry entries in; `window.TinyConsentVendors` adds or
// overrides entries per site.
//
// With `data-tc-geo` the rules depend on where the visitor is (see geo.js): the script
// starts strict, resolves the region, then shows the opt-in banner, an opt-out notice, or
// nothing. `data-tc-region="us-ca"` (or `window.TinyConsentRegion`) forces a region.

import {
  COOKIE_NAME,
  OPTIONAL_CATEGORIES,
  allConsent,
  categoriesAllowed,
  cookieString,
  createConsent,
  defaultConsent,
  isAllowed,
  isDowngrade,
  parseConsent,
  readCookie,
  serializeConsent,
} from './consent.js';
import { createBlocker, parseBlockAttr } from './blocker.js';
import defaultPatterns from './blocklist.js';
import { bindUI } from './ui.js';
import { cookiePatternsFor, detectVendors } from './vendors.js';
import { purgeCookies } from './cleanup.js';
import { DEFAULT_REGIONS, POLICIES, createGeoResolver, parseRegionCode, parseRegions, policyFor } from './geo.js';

const VERSION = '1.0.0';

// Injected only when the script runs, so the Designer canvas shows everything.
// Elements with data-tc-variant="opt-in opt-out none" show only under the listed policies.
const BOOT_CSS = [
  'html.tc-boot [data-tc="root"]:not([data-tc-visible="true"]),',
  'html.tc-boot [data-tc="banner"]:not([data-tc-visible="true"]),',
  'html.tc-boot [data-tc="preferences"]:not([data-tc-visible="true"]),',
  'html.tc-boot [data-tc="float"]:not([data-tc-visible="true"]),',
  'html.tc-boot [data-tc-element="accordion"]:not([data-tc-open="true"]) [data-tc-element="details"],',
  'html.tc-boot [data-tc="root"] [hidden],',
  POLICIES.map((p) => `html.tc-boot[data-tc-policy="${p}"] [data-tc-variant]:not([data-tc-variant~="${p}"])`).join(','),
  '{display:none!important}',
  'html.tc-boot [data-tc-element="chevron"]{transition:transform 150ms ease}',
  'html.tc-boot [data-tc-element="accordion"][data-tc-open="true"]>[data-tc-element="chevron"],',
  'html.tc-boot [data-tc-element="accordion"][data-tc-open="true"]>:not([data-tc-element="details"]) [data-tc-element="chevron"]',
  '{transform:rotate(180deg)}',
].join('');

function readConfig(script) {
  const attr = (name, fallback) => {
    const value = script ? script.getAttribute(name) : null;
    return value === null || value === '' ? fallback : value;
  };
  return {
    mode: attr('data-tc-mode', 'opt-in') === 'opt-out' ? 'opt-out' : 'opt-in',
    cookieDays: Number(attr('data-tc-cookie-days', 180)) || 180,
    cookieName: attr('data-tc-cookie-name', COOKIE_NAME),
    reload: attr('data-tc-reload', 'true') !== 'false',
    block: attr('data-tc-block', ''),
    purge: attr('data-tc-purge', 'true') !== 'false',
    vendors: attr('data-tc-vendors', '')
      .split(/[\s,]+/)
      .filter(Boolean),
    geo: ['auto', 'timezone'].includes(attr('data-tc-geo', '')) ? attr('data-tc-geo', '') : '',
    geoUrl: attr('data-tc-geo-url', ''),
    region: attr('data-tc-region', ''),
    regions: attr('data-tc-regions', DEFAULT_REGIONS),
  };
}

(function init(win, doc) {
  if (win.TinyConsent && win.TinyConsent.__tc) return;

  const script = doc.currentScript || doc.querySelector('script[src*="tiny-consent"]');
  const config = readConfig(script);
  const gpc = Boolean(win.navigator && win.navigator.globalPrivacyControl === true);
  const patterns = parseBlockAttr(config.block).concat(defaultPatterns);
  const secure = Boolean(win.location && win.location.protocol === 'https:');

  // Geolocation: the region table decides the policy; `mode` only applies when geo is off.
  // Until the region is known everything optional stays blocked (opt-in), the banner waits.
  const geoOn = Boolean(config.geo || config.region || win.TinyConsentRegion);
  const regionTable = parseRegions(config.regions);
  let region = null;
  let policy = geoOn ? 'opt-in' : config.mode;
  const resolver = createGeoResolver({ win, source: config.geo, url: config.geoUrl, forced: config.region });

  let consent = parseConsent(readCookie(doc.cookie, config.cookieName)) || defaultConsent({ mode: policy, gpc });
  let ui = null;

  const emit = (name, detail) => doc.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  const getConsent = () => ({ ...consent });

  const blocker = createBlocker({
    doc,
    patterns,
    base: win.location ? win.location.href : undefined,
    isAllowed: (categories) => categoriesAllowed(consent, categories),
    onBlock: (el) => emit('tc:block', { element: el }),
    onActivate: (el) => emit('tc:activate', { element: el }),
  });
  blocker.start();

  const style = doc.createElement('style');
  style.setAttribute('data-tc', 'boot');
  style.textContent = BOOT_CSS;
  (doc.head || doc.documentElement).appendChild(style);
  doc.documentElement.classList.add('tc-boot');
  doc.documentElement.setAttribute('data-tc-policy', policy);

  function persist() {
    doc.cookie = cookieString(config.cookieName, serializeConsent(consent), { days: config.cookieDays, secure });
  }

  /** Deletes the known cookies of every vendor whose category is currently denied. */
  function purge() {
    if (!config.purge) return [];
    const denied = OPTIONAL_CATEGORIES.filter((category) => !isAllowed(consent, category));
    if (!denied.length) return [];
    const removed = purgeCookies(doc, cookiePatternsFor(denied, win.TinyConsentVendors), {
      hostname: win.location ? win.location.hostname : '',
      path: win.location ? win.location.pathname : '/',
      keep: [config.cookieName],
    });
    if (removed.length) emit('tc:purge', { cookies: removed, categories: denied });
    return removed;
  }

  // Trackers that ran before the script (or before the visitor said no) may set or refresh
  // their cookies at any point, so the purge runs now, once the DOM is ready, after load,
  // and while the page is being left.
  purge();
  win.addEventListener('load', purge);
  win.addEventListener('pagehide', purge);

  function closePanels() {
    if (!ui) return;
    if (consent.chosen) ui.hideAll();
    else ui.showBanner();
  }

  function apply(changes) {
    const previous = consent;
    consent = createConsent(previous, changes);
    persist();
    purge();
    if (ui) {
      ui.sync(consent);
      ui.hideAll();
    }
    blocker.activate();
    emit('tc:consent', getConsent());
    if (isDowngrade(previous, consent)) {
      // Trackers that are still running write their cookies again as the page is left
      // (GA refreshes its session cookie on pagehide). Registered now, after theirs, this
      // listener runs last; the next page load purges once more on top of that.
      win.addEventListener('pagehide', () => purge(), { once: true });
      // Scripts that already ran cannot be unloaded. A reload is the only way to stop them.
      if (config.reload) win.location.reload();
    }
  }

  /** Puts the page in the state a new visitor from the current region would see. */
  function applyPolicy() {
    doc.documentElement.setAttribute('data-tc-policy', policy);
    if (consent.chosen) return;
    if (policy === 'none') {
      // No consent requirement here: record a choice so the banner never shows,
      // keep the Preferences button, and still honor a Global Privacy Control signal.
      apply({ ...allConsent(true), marketing: !gpc });
      return;
    }
    const next = defaultConsent({ mode: policy, gpc });
    if (OPTIONAL_CATEGORIES.some((category) => next[category] !== consent[category])) {
      consent = next;
      if (ui) ui.sync(consent);
      blocker.activate();
      emit('tc:consent', getConsent());
    }
    if (ui) ui.showBanner();
  }

  function setRegion(code) {
    const next = typeof code === 'string' ? parseRegionCode(code) : code;
    if (!next || !next.country) return;
    region = next;
    policy = geoOn ? policyFor(region, regionTable) : config.mode;
    const label = region.region ? `${region.country}-${region.region}` : region.country;
    doc.documentElement.setAttribute('data-tc-region', label);
    emit('tc:region', { region: { ...region }, policy });
    applyPolicy();
  }

  function resolveRegion() {
    return resolver.resolve().then((found) => {
      if (found && found.country) setRegion(found);
      else applyPolicy(); // unknown: stay opt-in and ask
      return region ? { ...region } : null;
    });
  }

  function reset() {
    doc.cookie = cookieString(config.cookieName, '', { days: -1, secure });
    consent = defaultConsent({ mode: policy === 'none' ? 'opt-in' : policy, gpc });
    purge();
    if (ui) ui.sync(consent);
    emit('tc:consent', getConsent());
    if (geoOn && !region) resolveRegion();
    else applyPolicy();
  }

  let vendors = [];

  /** Re-scans the page for tracker tags and rebuilds the vendor lists in the panel. */
  function refreshVendors() {
    vendors = detectVendors(doc, {
      extra: win.TinyConsentVendors,
      include: config.vendors,
      cookieDays: config.cookieDays,
      base: win.location ? win.location.href : undefined,
    });
    if (ui) ui.renderVendors(vendors);
    return vendors.map((v) => ({ ...v }));
  }

  function ready() {
    ui = bindUI(doc, {
      acceptAll: () => apply(allConsent(true)),
      rejectAll: () => apply(allConsent(false)),
      save: (changes) => apply(changes),
      close: closePanels,
      beforeOpen: refreshVendors,
    });
    refreshVendors();
    ui.sync(consent);
    purge();
    blocker.activate();
    emit('tc:consent', getConsent());
    // Region is resolved even when a choice exists so data-tc-region and the variants are right;
    // applyPolicy() leaves a stored choice alone.
    if (geoOn) resolveRegion();
    else applyPolicy();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ready);
  else ready();

  win.TinyConsent = {
    __tc: true,
    version: VERSION,
    config: { ...config, gpc },
    getConsent,
    getRegion: () => (region ? { ...region, policy } : null),
    getPolicy: () => policy,
    setRegion,
    isAllowed: (category) => isAllowed(consent, category),
    setConsent: apply,
    acceptAll: () => apply(allConsent(true)),
    rejectAll: () => apply(allConsent(false)),
    open: () => ui && ui.showPreferences(),
    close: closePanels,
    reset,
    vendors: refreshVendors,
    purge,
  };
})(window, document);
