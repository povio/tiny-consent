// Region detection and per-region policies.
//
// A policy is what the script does before the visitor has chosen:
//   opt-in   nothing optional runs, the banner asks (GDPR, LGPD, Quebec Law 25)
//   opt-out  everything runs, the banner is a notice with an opt-out (CCPA and the other US state laws)
//   none     no banner, everything runs, the Preferences button stays available
//
// The region table maps region keys to policies. Keys, most specific first:
//   us-ca    country-region (ISO 3166-1 alpha-2 + ISO 3166-2 subdivision)
//   us       country
//   eu       a group name (see GROUPS)
//   *        everything else
//
// The blocker must decide synchronously, so the script always starts strict (opt-in) and
// relaxes once the region is known. Unknown regions stay opt-in.

export const POLICIES = ['opt-in', 'opt-out', 'none'];

const EEA = [
  'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'ie', 'it', 'lv', 'lt', 'lu', 'mt',
  'nl', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se', // EU 27
  'is', 'li', 'no', // EEA
];

export const GROUPS = {
  eu: EEA,
  eea: EEA,
  uk: ['gb'],
};

// US states with a comprehensive privacy law in force (opt-out of sale/sharing).
const US_OPT_OUT = ['ca', 'va', 'co', 'ct', 'ut', 'tx', 'or', 'mt', 'ia', 'de', 'nh', 'nj', 'tn', 'mn', 'md', 'in', 'ky', 'ne', 'ri'];

export const DEFAULT_REGIONS = ['eu:opt-in', 'gb:opt-in', 'ch:opt-in', 'br:opt-in', 'ca-qc:opt-in']
  .concat(US_OPT_OUT.map((state) => `us-${state}:opt-out`))
  .concat(['*:none'])
  .join(', ');

/** "eu:opt-in, us-ca:opt-out, *:none" -> Map { 'eu' => 'opt-in', … }. Unknown policies are skipped. */
export function parseRegions(attr) {
  const table = new Map();
  for (const entry of String(attr || '').split(/[\s,]+/)) {
    const colon = entry.lastIndexOf(':');
    if (colon < 0) continue;
    const key = entry.slice(0, colon).trim().toLowerCase();
    const policy = entry.slice(colon + 1).trim().toLowerCase();
    if (key && POLICIES.includes(policy)) table.set(key, policy);
  }
  return table;
}

const STRICTNESS = { 'opt-in': 2, 'opt-out': 1, none: 0 };

function stricter(a, b) {
  if (!a) return b;
  if (!b) return a;
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

function groupsOf(country) {
  return Object.keys(GROUPS).filter((name) => GROUPS[name].includes(country));
}

/**
 * Policy for a region. `region` is `{ country, region?, coarse? }` with lowercase codes.
 * A coarse region (from the timezone heuristic) gets the strictest policy that any
 * matching key could yield, so an uncertain guess never relaxes the rules.
 */
export function policyFor(region, table) {
  const map = table instanceof Map ? table : parseRegions(table || DEFAULT_REGIONS);
  if (!region || !region.country) return 'opt-in';
  const country = String(region.country).toLowerCase();
  const sub = region.region ? String(region.region).toLowerCase() : '';
  const fallback = map.get('*') || 'opt-in';

  if (!region.coarse) {
    if (sub && map.has(`${country}-${sub}`)) return map.get(`${country}-${sub}`);
    if (map.has(country)) return map.get(country);
    for (const name of groupsOf(country)) if (map.has(name)) return map.get(name);
    return fallback;
  }

  let policy = null;
  if (map.has(country)) policy = stricter(policy, map.get(country));
  for (const name of groupsOf(country)) if (map.has(name)) policy = stricter(policy, map.get(name));
  // A group name used as a coarse country ("eu" from a European timezone).
  if (GROUPS[country]) {
    for (const member of GROUPS[country]) {
      if (map.has(member)) policy = stricter(policy, map.get(member));
    }
  }
  const prefix = `${country}-`;
  for (const [key, value] of map) if (key.startsWith(prefix)) policy = stricter(policy, value);
  return policy || fallback;
}

// ---- Timezone heuristic (no network, coarse) ----

const EU_ZONES = /^(Europe\/|Atlantic\/(Reykjavik|Canary|Madeira|Azores|Faroe|Faeroe)$)/;
const US_ZONES =
  /^(US\/|Pacific\/Honolulu$|America\/(New_York|Detroit|Kentucky\/|Indiana\/|Chicago|Menominee|North_Dakota\/|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak))/;
const CA_ZONES =
  /^(Canada\/|America\/(Toronto|Montreal|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Moncton|Glace_Bay|Goose_Bay|Iqaluit|Whitehorse|Dawson|Yellowknife|Inuvik|Rankin_Inlet|Resolute|Cambridge_Bay|Swift_Current|Fort_Nelson|Creston|Blanc-Sablon|Atikokan))/;
const BR_ZONES =
  /^(Brazil\/|America\/(Sao_Paulo|Bahia|Fortaleza|Recife|Belem|Manaus|Maceio|Araguaina|Campo_Grande|Cuiaba|Porto_Velho|Boa_Vista|Rio_Branco|Eirunepe|Santarem|Noronha))/;

/** Coarse region from an IANA timezone. Returns null when the zone says nothing useful. */
export function regionFromTimezone(tz) {
  const zone = String(tz || '');
  if (!zone) return null;
  if (EU_ZONES.test(zone)) return { country: 'eu', coarse: true, source: 'timezone' };
  if (US_ZONES.test(zone)) return { country: 'us', coarse: true, source: 'timezone' };
  if (CA_ZONES.test(zone)) return { country: 'ca', coarse: true, source: 'timezone' };
  if (BR_ZONES.test(zone)) return { country: 'br', coarse: true, source: 'timezone' };
  if (/^(Africa|Asia|Australia|Pacific|Indian|Antarctica|America|Atlantic)\//.test(zone)) {
    return { country: '*', coarse: true, source: 'timezone' };
  }
  return null;
}

// ---- IP lookup response parsing ----

const US_STATES = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co', connecticut: 'ct', delaware: 'de',
  'district of columbia': 'dc', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia',
  kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn',
  mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj',
  'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or',
  pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut',
  vermont: 'vt', virginia: 'va', washington: 'wa', 'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy',
};
const CA_PROVINCES = {
  alberta: 'ab', 'british columbia': 'bc', manitoba: 'mb', 'new brunswick': 'nb', 'newfoundland and labrador': 'nl', 'nova scotia': 'ns',
  ontario: 'on', 'prince edward island': 'pe', quebec: 'qc', 'québec': 'qc', saskatchewan: 'sk', 'northwest territories': 'nt',
  nunavut: 'nu', yukon: 'yt',
};

function pick(data, keys) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Normalises the answer of common IP geolocation services (geojs.io, ipapi.co, ipinfo.io,
 * Cloudflare's /cdn-cgi/trace text) into `{ country, region }` with lowercase codes.
 */
export function parseLookup(payload) {
  let data = payload;
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (text.startsWith('{')) {
      try {
        data = JSON.parse(text);
      } catch {
        return null;
      }
    } else {
      data = {};
      for (const line of text.split(/\r?\n/)) {
        const eq = line.indexOf('=');
        if (eq > 0) data[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
  }
  if (!data || typeof data !== 'object') return null;

  const country = pick(data, ['country_code', 'countryCode', 'country_code2', 'country', 'loc']).toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) return null;

  let region = pick(data, ['region_code', 'regionCode', 'region_iso_code', 'state_code', 'region', 'state']).toLowerCase();
  if (region.includes('-')) region = region.split('-').pop();
  if (region && !/^[a-z0-9]{1,3}$/.test(region)) {
    const names = country === 'us' ? US_STATES : country === 'ca' ? CA_PROVINCES : {};
    region = names[region] || '';
  }
  return region ? { country, region } : { country };
}

// ---- Resolver ----

export const DEFAULT_LOOKUP_URL = 'https://get.geojs.io/v1/ip/geo.json';
const STORAGE_KEY = 'tc_region';

/** Parses a forced region like "us-ca", "DE", or "eu". */
export function parseRegionCode(code) {
  const value = String(code || '').trim().toLowerCase();
  if (!value) return null;
  const [country, region] = value.split('-');
  if (!country) return null;
  return region ? { country, region, source: 'forced' } : { country, source: 'forced' };
}

/**
 * @param {object} options
 * @param {Window} options.win
 * @param {'auto'|'timezone'|''} options.source
 * @param {string} [options.url] lookup endpoint for `auto`
 * @param {string} [options.forced] region code that skips detection
 * @param {number} [options.timeoutMs]
 */
export function createGeoResolver({ win, source, url, forced, timeoutMs = 1500 }) {
  function fromTimezone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return regionFromTimezone(tz);
    } catch {
      return null;
    }
  }

  function readCache() {
    try {
      const raw = win.sessionStorage && win.sessionStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      return data && data.country ? { ...data, source: 'cache' } : null;
    } catch {
      return null;
    }
  }

  function writeCache(region) {
    try {
      if (win.sessionStorage) win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ country: region.country, region: region.region }));
    } catch {
      /* storage blocked */
    }
  }

  function lookup() {
    if (typeof win.fetch !== 'function') return Promise.resolve(null);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => controller && controller.abort(), timeoutMs);
    return win
      .fetch(url || DEFAULT_LOOKUP_URL, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then((res) => (res.ok ? res.text() : null))
      .then((text) => {
        const region = text ? parseLookup(text) : null;
        return region ? { ...region, source: 'lookup' } : null;
      })
      .catch(() => null)
      .finally(() => clearTimeout(timer));
  }

  /** Resolves to `{ country, region?, coarse?, source }`; `{ country: null }` when nothing is known. */
  function resolve() {
    const override = parseRegionCode(forced || win.TinyConsentRegion);
    if (override) return Promise.resolve(override);
    if (source === 'timezone') return Promise.resolve(fromTimezone() || { country: null, source: 'unknown' });
    if (source !== 'auto') return Promise.resolve({ country: null, source: 'off' });

    const cached = readCache();
    if (cached) return Promise.resolve(cached);
    return lookup().then((region) => {
      if (region) {
        writeCache(region);
        return region;
      }
      return fromTimezone() || { country: null, source: 'unknown' };
    });
  }

  return { resolve };
}
