import { describe, expect, it } from 'vitest';
import { cookieMatcher, cookieNames, domainVariants, purgeCookies } from '../src/cleanup.js';
import { cookiePatternsFor } from '../src/vendors.js';

/** Minimal cookie jar: identity is name+domain+path, an expiry in the past deletes. */
function jar(initial) {
  const store = new Map(); // key -> value
  const key = (name, domain, path) => `${name}|${domain}|${path}`;
  (initial || []).forEach(({ name, value, domain = '', path = '/' }) => store.set(key(name, domain, path), value));
  return {
    get cookie() {
      return Array.from(store.entries())
        .map(([k, v]) => `${k.split('|')[0]}=${v}`)
        .join('; ');
    },
    set cookie(str) {
      const parts = str.split(';').map((p) => p.trim());
      const [name, value] = parts[0].split('=');
      const attrs = {};
      parts.slice(1).forEach((p) => {
        const [k, v] = p.split('=');
        attrs[k.toLowerCase()] = v;
      });
      const domain = (attrs.domain || '').replace(/^\./, '');
      const path = attrs.path || '/';
      const expired = attrs.expires && new Date(attrs.expires) < new Date();
      // A domain cookie is stored without the leading dot, like browsers do.
      const k = key(name, domain, path);
      if (expired) store.delete(k);
      else store.set(k, value);
    },
    size: () => store.size,
  };
}

describe('cookieMatcher', () => {
  it('matches exact names and * wildcards only', () => {
    expect(cookieMatcher('_ga').test('_ga')).toBe(true);
    expect(cookieMatcher('_ga').test('_ga_ABC')).toBe(false);
    expect(cookieMatcher('_ga_*').test('_ga_ABC123')).toBe(true);
    expect(cookieMatcher('_ga_*').test('_ga')).toBe(false);
    expect(cookieMatcher('_hp2_id.*').test('_hp2_idX123')).toBe(false);
    expect(cookieMatcher('_hp2_id.*').test('_hp2_id.123')).toBe(true);
    expect(cookieMatcher('mp_*_mixpanel').test('mp_abc_mixpanel')).toBe(true);
  });
});

describe('domainVariants', () => {
  it('walks from the host up to the registrable domain, with and without leading dot', () => {
    expect(domainVariants('app.shop.example.com')).toEqual([
      '',
      'app.shop.example.com', '.app.shop.example.com',
      'shop.example.com', '.shop.example.com',
      'example.com', '.example.com',
    ]);
  });

  it('only tries the host-only form for localhost and IPs', () => {
    expect(domainVariants('localhost')).toEqual(['']);
    expect(domainVariants('127.0.0.1')).toEqual(['']);
  });
});

describe('purgeCookies', () => {
  it('deletes matching cookies on the exact host and on parent domains, keeps the rest', () => {
    const doc = jar([
      { name: '_ga', value: 'GA1', domain: 'example.com' },
      { name: '_ga_ABC', value: 'GS1', domain: 'example.com' },
      { name: '_fbp', value: 'fb', domain: '' },
      { name: '_hjSessionUser_1', value: 'hj', domain: 'www.example.com' },
      { name: 'tc_consent', value: 'keep', domain: '' },
      { name: 'session', value: 'keep', domain: '' },
    ]);
    const removed = purgeCookies(doc, ['_ga', '_ga_*', '_fbp', '_hjSessionUser_*', 'tc_consent'], {
      hostname: 'www.example.com',
      path: '/',
      keep: ['tc_consent'],
    });
    expect(removed.sort()).toEqual(['_fbp', '_ga', '_ga_ABC', '_hjSessionUser_1']);
    expect(cookieNames(doc.cookie).sort()).toEqual(['session', 'tc_consent']);
  });

  it('also tries the current directory path', () => {
    const doc = jar([{ name: '_gcl_au', value: 'x', domain: 'example.com', path: '/shop' }]);
    const removed = purgeCookies(doc, ['_gcl_au'], { hostname: 'example.com', path: '/shop/item' });
    expect(removed).toEqual(['_gcl_au']);
    expect(doc.size()).toBe(0);
  });

  it('returns an empty list when nothing matches and writes nothing', () => {
    const doc = jar([{ name: 'session', value: 'keep' }]);
    expect(purgeCookies(doc, ['_ga'], { hostname: 'example.com' })).toEqual([]);
    expect(doc.cookie).toBe('session=keep');
  });
});

describe('cookiePatternsFor', () => {
  it('collects the cookie names of every vendor in the given categories', () => {
    const marketing = cookiePatternsFor(['marketing']);
    expect(marketing).toEqual(expect.arrayContaining(['_fbp', '_fbc', '_gcl_au', 'VISITOR_INFO1_LIVE', '__hstc']));
    expect(marketing).not.toContain('_ga');
    expect(marketing).not.toContain('tc_consent');
    expect(cookiePatternsFor(['analytics'])).toContain('_ga_*');
  });

  it('includes per-site vendors and their purge patterns', () => {
    const patterns = cookiePatternsFor(['personalization'], [
      { id: 'acme', category: 'personalization', cookies: [{ name: 'acme_sid' }], purge: ['acme_*'] },
    ]);
    expect(patterns).toContain('acme_sid');
    expect(patterns).toContain('acme_*');
    expect(patterns).toContain('intercom-id-*');
  });

  it('deletes everything a tracker leaves behind, not only the cookies shown in the panel', () => {
    const doc = jar([
      { name: '_ga', value: 'x', domain: 'example.com' },
      { name: '_ga_ABC', value: 'x', domain: 'example.com' },
      { name: '_gat_UA-1', value: 'x', domain: 'example.com' },
      { name: '_hjFirstSeen', value: 'x', domain: 'example.com' },
      { name: '_hjAbsoluteSessionInProgress', value: 'x', domain: 'example.com' },
      { name: '_gcl_aw', value: 'x', domain: 'example.com' },
      { name: '_gcl_gs', value: 'x', domain: 'example.com' },
      { name: '_tt_enable_cookie', value: 'x', domain: 'example.com' },
      { name: '__hs_opt_out', value: 'x', domain: 'example.com' },
      { name: 'ln_or', value: 'x', domain: 'example.com' },
      { name: 'session', value: 'keep' },
      { name: 'tc_consent', value: 'keep' },
    ]);
    const removed = purgeCookies(doc, cookiePatternsFor(['analytics', 'marketing', 'personalization']), {
      hostname: 'www.example.com',
      keep: ['tc_consent'],
    });
    expect(removed).toHaveLength(10);
    expect(cookieNames(doc.cookie).sort()).toEqual(['session', 'tc_consent']);
  });

  it('leaves cookies of allowed categories alone', () => {
    const doc = jar([
      { name: '_ga', value: 'x', domain: 'example.com' },
      { name: '_hjFirstSeen', value: 'x', domain: 'example.com' },
      { name: '_fbp', value: 'x', domain: 'example.com' },
      { name: '_gcl_aw', value: 'x', domain: 'example.com' },
    ]);
    const removed = purgeCookies(doc, cookiePatternsFor(['marketing']), { hostname: 'www.example.com' });
    expect(removed.sort()).toEqual(['_fbp', '_gcl_aw']);
    expect(cookieNames(doc.cookie).sort()).toEqual(['_ga', '_hjFirstSeen']);
  });
});
