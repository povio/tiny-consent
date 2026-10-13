// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createBlocker, matchPattern, parseBlockAttr } from '../src/blocker.js';
import defaultPatterns from '../src/blocklist.js';
import { categoriesAllowed, createConsent, defaultConsent } from '../src/consent.js';

describe('matchPattern', () => {
  it('matches the host and its subdomains', () => {
    expect(matchPattern('https://www.googletagmanager.com/gtag/js?id=1', defaultPatterns)).toBe('analytics');
    expect(matchPattern('https://connect.facebook.net/en_US/fbevents.js', defaultPatterns)).toBe('marketing');
    expect(matchPattern('https://widget.intercom.io/widget/abc', defaultPatterns)).toBe('personalization');
  });

  it('does not match look-alike hosts', () => {
    expect(matchPattern('https://notyoutube.com/embed', defaultPatterns)).toBeNull();
    expect(matchPattern('https://cdn.example.com/app.js', defaultPatterns)).toBeNull();
  });

  it('requires the path prefix when the pattern has one', () => {
    expect(matchPattern('https://www.google.com/maps/embed?pb=1', defaultPatterns)).toBe('marketing');
    expect(matchPattern('https://www.google.com/recaptcha/api.js', defaultPatterns)).toBeNull();
  });

  it('resolves relative URLs against the page and ignores them', () => {
    expect(matchPattern('./tracker.js', defaultPatterns, 'https://example.com/page')).toBeNull();
    expect(matchPattern('//www.googletagmanager.com/gtm.js', defaultPatterns, 'https://example.com/')).toBe('analytics');
    expect(matchPattern('about:blank', defaultPatterns)).toBeNull();
  });

  it('checks patterns in order so site overrides win', () => {
    const patterns = parseBlockAttr('googletagmanager.com:essential').concat(defaultPatterns);
    expect(matchPattern('https://www.googletagmanager.com/gtm.js', patterns)).toBe('essential');
  });
});

describe('parseBlockAttr', () => {
  it('defaults to marketing and accepts paths', () => {
    expect(parseBlockAttr('cdn.a.com, b.com:analytics www.c.com/pixel:marketing')).toEqual([
      ['cdn.a.com', 'marketing'],
      ['b.com', 'analytics'],
      ['www.c.com/pixel', 'marketing'],
    ]);
    expect(parseBlockAttr('')).toEqual([]);
  });
});

function setup(consent) {
  const state = { consent };
  const blocker = createBlocker({
    doc: document,
    patterns: defaultPatterns,
    base: 'https://example.com/',
    isAllowed: (categories) => categoriesAllowed(state.consent, categories),
  });
  return { state, blocker };
}

describe('createBlocker', () => {
  it('neutralizes dynamically created scripts on blocked hosts', () => {
    document.body.innerHTML = '';
    const { blocker } = setup(defaultConsent());
    blocker.start();

    const script = document.createElement('script');
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-1';
    document.head.appendChild(script);

    expect(script.getAttribute('type')).toBe('text/plain');
    expect(script.hasAttribute('src')).toBe(false);
    expect(script.getAttribute('data-tc-src')).toBe('https://www.googletagmanager.com/gtag/js?id=G-1');
    expect(script.getAttribute('data-tc-category')).toBe('analytics');
    expect(script.hasAttribute('data-tc-auto')).toBe(true);

    const fine = document.createElement('script');
    fine.src = 'https://cdn.example.com/app.js';
    expect(fine.getAttribute('src')).toBe('https://cdn.example.com/app.js');
    expect(fine.hasAttribute('data-tc-category')).toBe(false);

    blocker.stop();
    script.remove();
  });

  it('activates marked tags only for allowed categories', () => {
    document.body.innerHTML = `
      <script type="text/plain" data-tc-src="https://cdn.example.com/a.js" data-tc-category="analytics" data-x="1"></script>
      <script type="text/plain" data-tc-src="https://cdn.example.com/m.js" data-tc-category="marketing"></script>
      <script type="text/plain" data-tc-src="https://cdn.example.com/am.js" data-tc-category="analytics, marketing"></script>
      <iframe data-tc-src="https://www.youtube-nocookie.com/embed/x" data-tc-category="marketing"></iframe>
      <div data-tc-element="placeholder" data-tc-category="marketing"></div>
      <label data-tc-category="analytics"><input type="checkbox"></label>
    `;
    const { state, blocker } = setup(createConsent(defaultConsent(), { analytics: true }));

    expect(blocker.activate()).toBe(1);
    const activated = document.querySelector('script[data-tc-activated]');
    expect(activated.getAttribute('src')).toBe('https://cdn.example.com/a.js');
    expect(activated.getAttribute('data-x')).toBe('1');
    expect(activated.hasAttribute('data-tc-src')).toBe(false);
    expect(document.querySelectorAll('script[type="text/plain"]').length).toBe(2);
    expect(document.querySelector('iframe').hasAttribute('src')).toBe(false);
    expect(document.querySelector('[data-tc-element="placeholder"]')).not.toBeNull();

    state.consent = createConsent(state.consent, { marketing: true });
    expect(blocker.activate()).toBe(4);
    expect(document.querySelectorAll('script[type="text/plain"]').length).toBe(0);
    expect(document.querySelector('iframe').getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/x');
    expect(document.querySelector('[data-tc-element="placeholder"]')).toBeNull();

    // A second pass is a no-op.
    expect(blocker.activate()).toBe(0);
  });

  it('runs inline marked scripts with their text', () => {
    document.body.innerHTML = '<script type="text/plain" data-tc-category="analytics">window.__ran = 1;</script>';
    const { blocker } = setup(createConsent(defaultConsent(), { analytics: true }));
    blocker.activate();
    const script = document.querySelector('script[data-tc-activated]');
    expect(script.textContent).toBe('window.__ran = 1;');
    expect(script.getAttribute('type')).toBeNull();
  });
});
