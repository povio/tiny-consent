// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { REGISTRY, detectVendors, mergeVendors } from '../src/vendors.js';
import { bindUI } from '../src/ui.js';
import defaultPatterns from '../src/blocklist.js';

function docWith(html) {
  const doc = document.implementation.createHTMLDocument('');
  doc.body.innerHTML = html;
  return doc;
}

const ids = (list) => list.map((v) => v.id);

describe('detectVendors', () => {
  it('always lists Tiny Consent with the configured cookie lifetime', () => {
    const list = detectVendors(docWith(''), { cookieDays: 90 });
    expect(ids(list)).toEqual(['tiny-consent']);
    expect(list[0].category).toBe('essential');
    expect(list[0].cookies[0]).toEqual({ name: 'tc_consent', purpose: 'Stores the cookie choices you make here.', duration: '90 days' });
  });

  it('matches script and iframe sources, including blocked ones kept in data-tc-src', () => {
    const doc = docWith(`
      <script type="text/plain" data-tc-src="https://www.googletagmanager.com/gtag/js?id=G-1" data-tc-category="analytics"></script>
      <iframe data-tc-src="https://www.youtube-nocookie.com/embed/x" data-tc-category="marketing"></iframe>
      <script src="https://cdn.example.com/app.js"></script>
    `);
    const list = detectVendors(doc);
    expect(ids(list).sort()).toEqual(['google-analytics', 'tiny-consent', 'youtube']);
    const yt = list.find((v) => v.id === 'youtube');
    expect(yt.category).toBe('marketing');
    expect(yt.privacy).toMatch(/^https:/);
    expect(yt.cookies.map((c) => c.name)).toEqual(['VISITOR_INFO1_LIVE', 'YSC']);
  });

  it('tells Google Analytics and Google Tag Manager apart by path', () => {
    const gtm = docWith('<script src="https://www.googletagmanager.com/gtm.js?id=GTM-1"></script>');
    expect(ids(detectVendors(gtm))).toContain('google-tag-manager');
    expect(ids(detectVendors(gtm))).not.toContain('google-analytics');
  });

  it('finds vendors named inside inline snippets that have not run yet', () => {
    const doc = docWith(`
      <script type="text/plain" data-tc-category="marketing">
        !function(f,b,e,v,n,t,s){ t.src=v }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '123');
      </script>
      <noscript><img src="https://www.facebook.com/tr?id=123" /></noscript>
    `);
    expect(ids(detectVendors(doc))).toContain('meta-pixel');
  });

  it('force-includes ids from the include list and sorts by name', () => {
    const list = detectVendors(docWith(''), { include: ['hubspot', 'meta-pixel'] });
    expect(ids(list)).toEqual(['hubspot', 'meta-pixel', 'tiny-consent']);
  });

  it('lets per-site entries add and override vendors', () => {
    const doc = docWith('<script src="https://cdn.acme-chat.test/widget.js"></script><script src="https://static.hotjar.com/c/hotjar-1.js"></script>');
    const list = detectVendors(doc, {
      extra: [
        { id: 'acme-chat', name: 'Acme Chat', category: 'personalization', privacy: 'https://acme.test/privacy', hosts: ['acme-chat.test'], cookies: [{ name: 'acme_sid', purpose: 'Chat session', duration: '1 day' }] },
        { id: 'hotjar', name: 'Hotjar (via Contentsquare)' },
      ],
    });
    const acme = list.find((v) => v.id === 'acme-chat');
    expect(acme).toMatchObject({ name: 'Acme Chat', category: 'personalization', privacy: 'https://acme.test/privacy' });
    expect(acme.cookies).toEqual([{ name: 'acme_sid', purpose: 'Chat session', duration: '1 day' }]);
    const hotjar = list.find((v) => v.id === 'hotjar');
    expect(hotjar.name).toBe('Hotjar (via Contentsquare)');
    expect(hotjar.cookies.length).toBeGreaterThan(0);
  });

  it('covers every host on the default block list', () => {
    const vendors = mergeVendors(REGISTRY, []);
    const missing = defaultPatterns
      .map(([pattern]) => pattern)
      .filter((pattern) => !vendors.some((v) => v.hosts.some((h) => h === pattern || pattern.endsWith(h) || h.startsWith(pattern))));
    expect(missing).toEqual([]);
  });
});

const PANEL = `
<div data-tc="root">
  <div data-tc="preferences">
    <div data-tc-category="essential" data-tc-element="accordion">
      <div data-tc-element="details" id="essential-details">
        <div data-tc-vendor="sample" data-tc-element="accordion" data-tc-open="true" class="is-open">
          <div data-tc-field="vendor-name">Sample</div>
          <a href="#" data-tc-field="vendor-privacy">Privacy</a>
          <div data-tc-field="cookie">
            <span data-tc-field="cookie-name">x</span>
            <span data-tc-field="cookie-purpose">y</span>
            <span data-tc-field="cookie-duration">z</span>
          </div>
        </div>
        <p data-tc-field="empty" id="essential-empty">Nothing</p>
      </div>
    </div>
    <div data-tc-category="marketing" data-tc-element="accordion">
      <input type="checkbox" />
      <div data-tc-element="details" id="marketing-details">
        <div data-tc-vendor="sample">
          <div data-tc-field="vendor-name">Sample</div>
          <a href="#" data-tc-field="vendor-privacy">Privacy</a>
          <div data-tc-field="cookie"><span data-tc-field="cookie-name">x</span></div>
        </div>
        <div data-tc-vendor="in-house" id="in-house"><div data-tc-field="vendor-name">Our own pixel</div></div>
        <p data-tc-field="empty" id="marketing-empty">Nothing</p>
      </div>
    </div>
    <div data-tc-category="personalization" data-tc-element="accordion">
      <input type="checkbox" />
      <div data-tc-element="details" id="personalization-details">
        <p data-tc-field="empty" id="personalization-empty">Nothing</p>
      </div>
    </div>
  </div>
</div>`;

const VENDORS = [
  { id: 'tiny-consent', name: 'Tiny Consent', category: 'essential', privacy: '', cookies: [{ name: 'tc_consent', purpose: 'Choices', duration: '180 days' }] },
  { id: 'meta-pixel', name: 'Meta Pixel', category: 'marketing', privacy: 'https://fb.test/privacy', cookies: [{ name: '_fbp', purpose: 'Ads', duration: '90 days' }, { name: '_fbc', purpose: 'Click', duration: '90 days' }] },
  { id: 'in-house', name: 'Registry copy', category: 'marketing', privacy: '', cookies: [] },
];

function setupPanel() {
  const doc = docWith(PANEL);
  const ui = bindUI(doc, { acceptAll: vi.fn(), rejectAll: vi.fn(), save: vi.fn(), close: vi.fn() });
  return { doc, ui };
}

describe('renderVendors', () => {
  it('replaces the sample with one filled block per vendor and fills the cookie rows', () => {
    const { doc, ui } = setupPanel();
    ui.renderVendors(VENDORS);
    const blocks = doc.querySelectorAll('#marketing-details [data-tc-vendor]');
    expect(Array.from(blocks).map((b) => b.getAttribute('data-tc-vendor'))).toEqual(['in-house', 'meta-pixel']);
    const meta = doc.querySelector('[data-tc-vendor="meta-pixel"]');
    expect(meta.querySelector('[data-tc-field="vendor-name"]').textContent).toBe('Meta Pixel');
    expect(meta.querySelector('[data-tc-field="vendor-privacy"]').getAttribute('href')).toBe('https://fb.test/privacy');
    expect(Array.from(meta.querySelectorAll('[data-tc-field="cookie-name"]')).map((c) => c.textContent)).toEqual(['_fbp', '_fbc']);
    expect(doc.getElementById('marketing-empty').hasAttribute('hidden')).toBe(true);
  });

  it('keeps hand-written blocks and does not duplicate their id', () => {
    const { doc, ui } = setupPanel();
    ui.renderVendors(VENDORS);
    expect(doc.getElementById('in-house')).toBeTruthy();
    expect(doc.querySelectorAll('[data-tc-vendor="in-house"]')).toHaveLength(1);
    expect(doc.getElementById('in-house').textContent).toContain('Our own pixel');
  });

  it('removes the privacy link when a vendor has none and starts generated accordions closed', () => {
    const { doc, ui } = setupPanel();
    ui.renderVendors(VENDORS);
    const tc = doc.querySelector('#essential-details [data-tc-vendor="tiny-consent"]');
    expect(tc).toBeTruthy();
    expect(tc.querySelector('[data-tc-field="vendor-privacy"]')).toBeNull();
    expect(tc.hasAttribute('data-tc-open')).toBe(false);
    expect(tc.classList.contains('is-open')).toBe(false);
    expect(doc.getElementById('essential-empty').hasAttribute('hidden')).toBe(true);
  });

  it('shows the empty message when nothing was detected and borrows a template from another row', () => {
    const { doc, ui } = setupPanel();
    ui.renderVendors(VENDORS);
    expect(doc.getElementById('personalization-empty').hasAttribute('hidden')).toBe(false);
    expect(doc.querySelectorAll('#personalization-details [data-tc-vendor]')).toHaveLength(0);

    ui.renderVendors(VENDORS.concat({ id: 'intercom', name: 'Intercom', category: 'personalization', privacy: '', cookies: [] }));
    expect(doc.querySelectorAll('#personalization-details [data-tc-vendor="intercom"]')).toHaveLength(1);
    expect(doc.getElementById('personalization-empty').hasAttribute('hidden')).toBe(true);
  });

  it('is idempotent across re-renders', () => {
    const { doc, ui } = setupPanel();
    ui.renderVendors(VENDORS);
    ui.renderVendors(VENDORS);
    expect(doc.querySelectorAll('#marketing-details [data-tc-vendor]')).toHaveLength(2);
    ui.renderVendors([]);
    expect(doc.querySelectorAll('#marketing-details [data-tc-vendor]')).toHaveLength(1);
    expect(doc.getElementById('marketing-empty').hasAttribute('hidden')).toBe(true); // hand-written block still counts
    expect(doc.getElementById('essential-empty').hasAttribute('hidden')).toBe(false);
  });
});
