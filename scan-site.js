// Setup-time crawl. Reads a site's sitemap, fetches each page's HTML, and matches
// script and iframe addresses against the vendor registry. A Google Tag Manager
// container on those pages is fetched once and its active tags are matched too.
// The published banner still detects tags on the page the visitor is looking at;
// this list is what data-tc-vendors forces in so services that live on other pages
// still appear.

import { JSDOM } from 'jsdom';
import { detectVendors } from './src/vendors.js';

export const PAGE_LIMIT = 40;

function decodeXml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** { isIndex, locs } from a sitemap or sitemap index document. */
export function readSitemap(xml) {
  const locs = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let match;
  while ((match = re.exec(String(xml)))) locs.push(decodeXml(match[1].trim()));
  return { isIndex: /<sitemapindex[\s>]/i.test(xml), locs };
}

/** Sitemap addresses declared in robots.txt. */
export function sitemapUrlsFromRobots(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*sitemap:\s*(\S+)/i);
      return match ? match[1] : '';
    })
    .filter(Boolean);
}

export function siteHost(hostname) {
  return String(hostname).toLowerCase().replace(/^www\./, '');
}

export function isPrivateHostname(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

/** Adds https:// when the address has no scheme, so "povio.com" is a valid site. */
export function normalizeSiteUrl(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Enter a website address.');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('Enter a website address, such as povio.com.');
  }
  return url.href;
}

/** Public http(s) URL. Rejects localhost, private networks, and other schemes. */
export function isPublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (!url.hostname || isPrivateHostname(url.hostname)) return false;
  return true;
}

export function sameSite(pageUrl, origin) {
  try {
    return siteHost(new URL(pageUrl).hostname) === siteHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Recognized vendors in one HTML document, without the consent cookie itself. */
export function vendorsFromHtml(html, pageUrl, cookieDays) {
  const doc = new JSDOM(String(html), { url: pageUrl }).window.document;
  return detectVendors(doc, { base: pageUrl, cookieDays }).filter((vendor) => vendor.id !== 'tiny-consent');
}

/** Container URLs referenced by a page, from a loader or a noscript iframe. */
export function gtmContainerUrls(html) {
  const ids = new Set();
  const text = String(html || '');
  const linked = /googletagmanager\.com\/(?:gtm\.js|ns\.html)\?[^"'\\\s]*\bid=(GTM-[A-Z0-9]+)/gi;
  for (const match of text.matchAll(linked)) ids.add(match[1].toUpperCase());
  if (/googletagmanager\.com\/gtm\.js/i.test(text)) {
    for (const match of text.matchAll(/['"](GTM-[A-Z0-9]+)['"]/g)) ids.add(match[1].toUpperCase());
  }
  return [...ids].map((id) => `https://www.googletagmanager.com/gtm.js?id=${id}`);
}

const GTM_TAG_VENDORS = {
  __gaawe: 'google-analytics',
  __awct: 'google-ads',
  __awec: 'google-ads',
  __sp: 'google-ads',
  __gclidw: 'google-ads',
};

function jsonObjectAfter(source, marker) {
  const at = source.indexOf(marker);
  if (at < 0) return null;
  const start = source.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function collectStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
}

/**
 * Vendor ids configured as active tags inside a gtm.js container.
 * The container's own library mentions many hosts it does not actually fire,
 * so only the tag list, custom HTML, and script permissions are read.
 */
export function vendorIdsFromGtm(source) {
  const data = jsonObjectAfter(String(source || ''), 'var data =');
  const tags = data && data.resource && Array.isArray(data.resource.tags) ? data.resource.tags : [];
  const ids = new Set();
  const texts = [];
  tags.forEach((tag) => {
    if (!tag || !tag.function || tag.function === '__paused') return;
    if (tag.function === '__googtag') {
      ids.add(String(tag.vtp_tagId || '').startsWith('AW-') ? 'google-ads' : 'google-analytics');
    } else if (GTM_TAG_VENDORS[tag.function]) ids.add(GTM_TAG_VENDORS[tag.function]);
    if (tag.function === '__html' && tag.vtp_html) texts.push(String(tag.vtp_html));
    const permissions = data.permissions && data.permissions[tag.function];
    if (permissions) collectStrings(permissions, texts);
  });
  if (texts.length) {
    const html = `<script>${texts.join('\n').replace(/<\/script/gi, '<\\/script')}</script>`;
    vendorsFromHtml(html, 'https://www.googletagmanager.com/gtm.js').forEach((vendor) => ids.add(vendor.id));
  }
  return [...ids];
}

function vendorsForIds(ids, cookieDays) {
  const wanted = new Set(ids);
  const doc = { querySelectorAll() { return []; } };
  return detectVendors(doc, { include: [...wanted], cookieDays }).filter((vendor) => wanted.has(vendor.id));
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function fetchText(url, { fetchImpl, timeoutMs, hops }) {
  if (!isPublicHttpUrl(url)) throw new Error('That address is not a public website.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'user-agent': 'TinyConsentScan/1.0',
        accept: 'text/html,application/xml,text/plain,*/*',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || hops >= 3) throw new Error('The site redirected too many times.');
      return fetchText(new URL(location, url).href, { fetchImpl, timeoutMs, hops: hops + 1 });
    }
    const bytes = await response.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(bytes.slice(0, 1_500_000));
    return {
      ok: response.ok,
      status: response.status,
      type: response.headers.get('content-type') || '',
      text,
      url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} input site address
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.limit]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.cookieDays]
 */
export async function scanSite(input, options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const limit = opts.limit || PAGE_LIMIT;
  const timeoutMs = opts.timeoutMs || 8000;
  const start = normalizeSiteUrl(input);
  if (!isPublicHttpUrl(start)) throw new Error('Use a public http or https website.');
  const origin = new URL(start).origin;
  const request = (url) => fetchText(url, { fetchImpl, timeoutMs, hops: 0 });

  const sitemapCandidates = [];
  try {
    const robots = await request(`${origin}/robots.txt`);
    if (robots.ok) sitemapUrlsFromRobots(robots.text).forEach((url) => sitemapCandidates.push(url));
  } catch {
    // A missing robots.txt just means we try the usual sitemap paths.
  }
  sitemapCandidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);

  const pages = new Set([start]);
  const seenSitemaps = new Set();

  async function walkSitemap(url, depth) {
    if (depth > 3 || seenSitemaps.has(url) || pages.size >= limit) return;
    if (!isPublicHttpUrl(url)) return;
    seenSitemaps.add(url);
    let doc;
    try {
      doc = await request(url);
    } catch {
      return;
    }
    if (!doc.ok) return;
    const { isIndex, locs } = readSitemap(doc.text);
    const queue = [];
    locs.forEach((loc) => {
      let absolute;
      try {
        absolute = new URL(loc, url).href;
      } catch {
        return;
      }
      const looksLikeSitemap = isIndex || /\.xml($|\?)/i.test(absolute);
      if (looksLikeSitemap) queue.push(absolute);
      else if (sameSite(absolute, origin) && isPublicHttpUrl(absolute) && pages.size < limit) pages.add(absolute);
    });
    for (const child of queue) {
      if (pages.size >= limit && !isIndex) break;
      await walkSitemap(child, depth + 1);
    }
  }

  for (const candidate of sitemapCandidates) {
    const before = pages.size;
    await walkSitemap(candidate, 0);
    if (pages.size > before) break;
  }

  const listed = [...pages];
  const targets = listed.slice(0, limit);
  const byId = new Map();
  let pagesScanned = 0;

  const pageResults = await mapLimit(targets, 4, async (page) => {
    let doc;
    try {
      doc = await request(page);
    } catch {
      return null;
    }
    if (!doc.ok) return null;
    const type = doc.type.toLowerCase();
    if (type && !type.includes('html') && !type.includes('xml') && !type.includes('text/plain')) return null;
    pagesScanned += 1;
    const found = vendorsFromHtml(doc.text, page, opts.cookieDays);
    found.forEach((vendor) => {
      const current = byId.get(vendor.id);
      if (current) current.pages += 1;
      else byId.set(vendor.id, { ...vendor, pages: 1 });
    });
    return { ids: found.map((vendor) => vendor.id), containers: gtmContainerUrls(doc.text) };
  });

  const containerUrls = [...new Set(pageResults.flatMap((page) => (page ? page.containers : [])))].slice(0, 4);
  const idsByContainer = new Map();
  await mapLimit(containerUrls, 2, async (url) => {
    let doc;
    try {
      doc = await request(url);
    } catch {
      return;
    }
    if (!doc.ok) return;
    idsByContainer.set(url, vendorIdsFromGtm(doc.text));
  });
  pageResults.forEach((page) => {
    if (!page) return;
    const already = new Set(page.ids);
    const extra = new Set();
    page.containers.forEach((url) => (idsByContainer.get(url) || []).forEach((id) => extra.add(id)));
    vendorsForIds([...extra].filter((id) => !already.has(id)), opts.cookieDays).forEach((vendor) => {
      const current = byId.get(vendor.id);
      if (current) current.pages += 1;
      else byId.set(vendor.id, { ...vendor, pages: 1 });
    });
  });

  const vendors = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    url: start,
    origin,
    pagesListed: listed.length,
    pagesScanned,
    capped: listed.length > limit,
    vendors,
  };
}
