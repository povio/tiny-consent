import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REGIONS,
  createGeoResolver,
  parseLookup,
  parseRegionCode,
  parseRegions,
  policyFor,
  regionFromTimezone,
} from '../src/geo.js';

describe('parseRegions', () => {
  it('parses keys and policies, skipping unknown policies', () => {
    const table = parseRegions('eu:opt-in, US-CA:opt-out, br:maybe, *:none');
    expect(table.get('eu')).toBe('opt-in');
    expect(table.get('us-ca')).toBe('opt-out');
    expect(table.has('br')).toBe(false);
    expect(table.get('*')).toBe('none');
  });

  it('ships a default table with GDPR, US state laws, and a none fallback', () => {
    const table = parseRegions(DEFAULT_REGIONS);
    expect(table.get('eu')).toBe('opt-in');
    expect(table.get('gb')).toBe('opt-in');
    expect(table.get('us-ca')).toBe('opt-out');
    expect(table.get('*')).toBe('none');
  });
});

describe('policyFor', () => {
  const table = parseRegions(DEFAULT_REGIONS);

  it('matches country-region before country before group before *', () => {
    expect(policyFor({ country: 'us', region: 'ca' }, table)).toBe('opt-out');
    expect(policyFor({ country: 'us', region: 'ny' }, table)).toBe('none');
    expect(policyFor({ country: 'de' }, table)).toBe('opt-in');
    expect(policyFor({ country: 'no' }, table)).toBe('opt-in');
    expect(policyFor({ country: 'gb' }, table)).toBe('opt-in');
    expect(policyFor({ country: 'ca', region: 'qc' }, table)).toBe('opt-in');
    expect(policyFor({ country: 'ca', region: 'on' }, table)).toBe('none');
    expect(policyFor({ country: 'jp' }, table)).toBe('none');
  });

  it('accepts a group name as a forced region', () => {
    expect(policyFor({ country: 'eu' }, table)).toBe('opt-in');
  });

  it('stays opt-in when the region is unknown', () => {
    expect(policyFor(null, table)).toBe('opt-in');
    expect(policyFor({ country: null }, table)).toBe('opt-in');
  });

  it('falls back to opt-in when the table has no * entry', () => {
    expect(policyFor({ country: 'jp' }, parseRegions('eu:opt-in'))).toBe('opt-in');
  });

  it('uses the strictest matching policy for coarse (timezone) regions', () => {
    expect(policyFor({ country: 'us', coarse: true }, table)).toBe('opt-out');
    expect(policyFor({ country: 'eu', coarse: true }, table)).toBe('opt-in');
    expect(policyFor({ country: 'ca', coarse: true }, table)).toBe('opt-in');
    expect(policyFor({ country: '*', coarse: true }, table)).toBe('none');
  });

  it('a custom table can ask everyone', () => {
    expect(policyFor({ country: 'jp' }, parseRegions('*:opt-in'))).toBe('opt-in');
  });
});

describe('regionFromTimezone', () => {
  it('maps zones to coarse regions', () => {
    expect(regionFromTimezone('Europe/Berlin')).toMatchObject({ country: 'eu', coarse: true });
    expect(regionFromTimezone('Atlantic/Reykjavik')).toMatchObject({ country: 'eu' });
    expect(regionFromTimezone('America/Los_Angeles')).toMatchObject({ country: 'us' });
    expect(regionFromTimezone('America/Toronto')).toMatchObject({ country: 'ca' });
    expect(regionFromTimezone('America/Sao_Paulo')).toMatchObject({ country: 'br' });
    expect(regionFromTimezone('Asia/Tokyo')).toMatchObject({ country: '*' });
    expect(regionFromTimezone('America/Mexico_City')).toMatchObject({ country: '*' });
  });

  it('returns null for missing or unknown zones', () => {
    expect(regionFromTimezone('')).toBeNull();
    expect(regionFromTimezone('UTC')).toBeNull();
  });
});

describe('parseLookup', () => {
  it('reads geojs.io style JSON with region names', () => {
    expect(parseLookup({ country_code: 'US', region: 'California' })).toEqual({ country: 'us', region: 'ca' });
    expect(parseLookup({ country_code: 'CA', region: 'Quebec' })).toEqual({ country: 'ca', region: 'qc' });
    expect(parseLookup({ country_code: 'DE', region: 'Bavaria' })).toEqual({ country: 'de' });
  });

  it('reads ipapi.co / ipinfo.io style fields', () => {
    expect(parseLookup({ country_code: 'US', region_code: 'TX' })).toEqual({ country: 'us', region: 'tx' });
    expect(parseLookup({ country: 'US', region: 'New York' })).toEqual({ country: 'us', region: 'ny' });
    expect(parseLookup({ country: 'FR', region_iso_code: 'FR-IDF' })).toEqual({ country: 'fr', region: 'idf' });
  });

  it('reads Cloudflare trace text and JSON strings', () => {
    expect(parseLookup('fl=1\nip=1.2.3.4\nloc=NL\ntls=TLSv1.3\n')).toEqual({ country: 'nl' });
    expect(parseLookup('{"country_code":"BR"}')).toEqual({ country: 'br' });
  });

  it('rejects garbage', () => {
    expect(parseLookup('not json')).toBeNull();
    expect(parseLookup({ country: 'USA' })).toBeNull();
    expect(parseLookup(null)).toBeNull();
  });
});

describe('parseRegionCode', () => {
  it('splits country and region', () => {
    expect(parseRegionCode('US-CA')).toMatchObject({ country: 'us', region: 'ca' });
    expect(parseRegionCode('de')).toMatchObject({ country: 'de' });
    expect(parseRegionCode('')).toBeNull();
  });
});

function fakeWindow(overrides = {}) {
  const store = new Map();
  return {
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    ...overrides,
  };
}

describe('createGeoResolver', () => {
  it('returns the forced region without a lookup', async () => {
    const fetch = vi.fn();
    const r = createGeoResolver({ win: fakeWindow({ fetch }), source: 'auto', forced: 'us-ca' });
    await expect(r.resolve()).resolves.toMatchObject({ country: 'us', region: 'ca', source: 'forced' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('honours window.TinyConsentRegion', async () => {
    const r = createGeoResolver({ win: fakeWindow({ TinyConsentRegion: 'eu' }), source: 'auto' });
    await expect(r.resolve()).resolves.toMatchObject({ country: 'eu' });
  });

  it('fetches, parses, and caches the lookup', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('{"country_code":"US","region":"Texas"}') });
    const win = fakeWindow({ fetch });
    const r = createGeoResolver({ win, source: 'auto', url: 'https://geo.example/json' });
    await expect(r.resolve()).resolves.toMatchObject({ country: 'us', region: 'tx', source: 'lookup' });
    expect(fetch).toHaveBeenCalledWith('https://geo.example/json', expect.objectContaining({ credentials: 'omit' }));
    await expect(r.resolve()).resolves.toMatchObject({ country: 'us', region: 'tx', source: 'cache' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the timezone when the lookup fails', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const r = createGeoResolver({ win: fakeWindow({ fetch }), source: 'auto' });
    const result = await r.resolve();
    expect(result.source === 'timezone' || result.source === 'unknown').toBe(true);
  });

  it('is off without a source', async () => {
    const r = createGeoResolver({ win: fakeWindow(), source: '' });
    await expect(r.resolve()).resolves.toMatchObject({ country: null, source: 'off' });
  });
});
