import { describe, expect, it } from 'vitest';
import {
  allConsent,
  categoriesAllowed,
  cookieString,
  createConsent,
  defaultConsent,
  isAllowed,
  isDowngrade,
  parseCategories,
  parseConsent,
  readCookie,
  serializeConsent,
} from '../src/consent.js';

describe('defaultConsent', () => {
  it('denies every optional category in opt-in mode', () => {
    const c = defaultConsent({ mode: 'opt-in' });
    expect(c.chosen).toBe(false);
    expect(c.essential).toBe(true);
    expect(c.analytics).toBe(false);
    expect(c.marketing).toBe(false);
    expect(c.personalization).toBe(false);
  });

  it('allows every optional category in opt-out mode', () => {
    const c = defaultConsent({ mode: 'opt-out' });
    expect(c.analytics).toBe(true);
    expect(c.marketing).toBe(true);
    expect(c.personalization).toBe(true);
  });

  it('denies marketing in opt-out mode when GPC is on', () => {
    const c = defaultConsent({ mode: 'opt-out', gpc: true });
    expect(c.analytics).toBe(true);
    expect(c.marketing).toBe(false);
  });
});

describe('cookie round trip', () => {
  it('serializes and parses a decision', () => {
    const decided = createConsent(defaultConsent(), { analytics: true, marketing: false }, new Date('2026-01-02T03:04:05Z'));
    const parsed = parseConsent(serializeConsent(decided));
    expect(parsed).toEqual({
      v: 1,
      t: '2026-01-02T03:04:05.000Z',
      chosen: true,
      essential: true,
      analytics: true,
      marketing: false,
      personalization: false,
    });
  });

  it('never stores essential as false', () => {
    const decided = createConsent(defaultConsent(), { essential: false, analytics: true });
    expect(decided.essential).toBe(true);
  });

  it('returns null for garbage, wrong version, or empty values', () => {
    expect(parseConsent('')).toBeNull();
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent('not%20json')).toBeNull();
    expect(parseConsent(encodeURIComponent(JSON.stringify({ v: 2, t: 'x', a: 1 })))).toBeNull();
    expect(parseConsent(encodeURIComponent(JSON.stringify({ v: 1, a: 1 })))).toBeNull();
  });

  it('reads one cookie out of a cookie header', () => {
    const header = 'foo=1; tc_consent=abc%3D; bar=baz';
    expect(readCookie(header, 'tc_consent')).toBe('abc%3D');
    expect(readCookie(header, 'missing')).toBeNull();
    expect(readCookie('', 'tc_consent')).toBeNull();
    expect(readCookie('junk; tc_consent=x', 'tc_consent')).toBe('x');
  });

  it('builds a Lax first-party cookie string', () => {
    expect(cookieString('tc_consent', 'v', { days: 1 })).toBe('tc_consent=v; Max-Age=86400; Path=/; SameSite=Lax');
    expect(cookieString('tc_consent', 'v', { days: 1, secure: true })).toMatch(/; Secure$/);
    expect(cookieString('tc_consent', '', { days: -1 })).toContain('Max-Age=-86400');
  });
});

describe('category gating', () => {
  const consent = createConsent(defaultConsent(), { analytics: true });

  it('always allows essential', () => {
    expect(isAllowed(defaultConsent(), 'essential')).toBe(true);
  });

  it('blocks unknown categories', () => {
    expect(isAllowed(consent, 'ads')).toBe(false);
    expect(categoriesAllowed(consent, 'ads')).toBe(false);
    expect(categoriesAllowed(consent, '')).toBe(false);
  });

  it('parses comma and space separated lists', () => {
    expect(parseCategories('analytics, Marketing  personalization')).toEqual(['analytics', 'marketing', 'personalization']);
  });

  it('requires every listed category', () => {
    expect(categoriesAllowed(consent, 'analytics')).toBe(true);
    expect(categoriesAllowed(consent, 'analytics, marketing')).toBe(false);
    expect(categoriesAllowed(consent, ['essential', 'analytics'])).toBe(true);
  });

  it('detects downgrades', () => {
    const all = createConsent(defaultConsent(), allConsent(true));
    const none = createConsent(all, allConsent(false));
    expect(isDowngrade(all, none)).toBe(true);
    expect(isDowngrade(none, all)).toBe(false);
    expect(isDowngrade(defaultConsent(), none)).toBe(false);
  });
});
