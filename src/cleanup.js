// Removes tracker cookies once their category is denied. Scripts that already ran keep
// going until the reload; this takes care of what they left behind.
//
// Only first-party cookies that JavaScript can see are reachable: HttpOnly cookies and
// third-party cookies set by iframes or pixel responses are out of reach for any script.
// Trackers set their cookies on the registrable domain (`.example.com`) with path `/`,
// sometimes on the exact host, so every delete is attempted on each domain variant.

const EXPIRED = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';

/** `_ga_*` -> /^_ga_.*$/ ; names without `*` match exactly. */
export function cookieMatcher(pattern) {
  const source = String(pattern)
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`);
}

/** Names present in a document.cookie string. */
export function cookieNames(cookieString) {
  return String(cookieString || '')
    .split(';')
    .map((part) => part.trim().split('=')[0])
    .filter(Boolean);
}

/** `app.shop.example.co.uk` -> ['', 'app.shop.example.co.uk', '.app.shop.example.co.uk', 'shop.example.co.uk', '.shop.example.co.uk', 'example.co.uk', '.example.co.uk', …]. */
export function domainVariants(hostname) {
  const host = String(hostname || '').toLowerCase();
  const variants = [''];
  if (!host || /^(\d+\.){3}\d+$/.test(host) || host === 'localhost') return variants;
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const domain = labels.slice(i).join('.');
    variants.push(domain, '.' + domain);
  }
  return variants;
}

/**
 * Deletes every cookie whose name matches one of the patterns.
 * @param {{ cookie: string }} store   document, or anything with a cookie getter/setter
 * @param {string[]} patterns          cookie names, `*` allowed
 * @param {{ hostname?: string, path?: string, keep?: string[] }} [options]
 * @returns {string[]} names that are gone afterwards
 */
export function purgeCookies(store, patterns, options) {
  const opts = options || {};
  const keep = new Set(opts.keep || []);
  const matchers = (patterns || []).map(cookieMatcher);
  const targets = cookieNames(store.cookie).filter((name) => !keep.has(name) && matchers.some((re) => re.test(name)));
  if (!targets.length) return [];

  const domains = domainVariants(opts.hostname);
  const paths = ['/'];
  const current = opts.path && opts.path !== '/' ? opts.path.replace(/\/[^/]*$/, '') || '/' : '';
  if (current && current !== '/') paths.push(current, current + '/');

  targets.forEach((name) => {
    domains.forEach((domain) => {
      paths.forEach((path) => {
        store.cookie = `${name}=; ${EXPIRED}; path=${path}${domain ? `; domain=${domain}` : ''}`;
      });
    });
  });

  const remaining = new Set(cookieNames(store.cookie));
  return targets.filter((name) => !remaining.has(name));
}
