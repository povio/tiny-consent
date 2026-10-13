import { describe, it, expect } from 'vitest';
import { gtmContainerUrls, isPrivateHostname, isPublicHttpUrl, readSitemap, sameSite, scanSite, sitemapUrlsFromRobots, vendorIdsFromGtm } from '../scan-site.js';

function jsonResponse(body, status = 200, type = 'text/html') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === 'content-type' ? type : null) },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

describe('sitemap parsing', () => {
  it('reads page addresses and sitemap indexes', () => {
    const pages = readSitemap('<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b?x=1&amp;y=2</loc></url></urlset>');
    expect(pages.isIndex).toBe(false);
    expect(pages.locs).toEqual(['https://example.com/a', 'https://example.com/b?x=1&y=2']);
    const index = readSitemap('<sitemapindex><sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap></sitemapindex>');
    expect(index.isIndex).toBe(true);
    expect(index.locs).toEqual(['https://example.com/sitemap-1.xml']);
  });

  it('reads Sitemap lines from robots.txt', () => {
    expect(sitemapUrlsFromRobots('User-agent: *\nSitemap: https://example.com/sitemap.xml\n')).toEqual(['https://example.com/sitemap.xml']);
  });
});

describe('address checks', () => {
  it('rejects private and local hosts', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('127.0.0.1')).toBe(true);
    expect(isPrivateHostname('10.1.2.3')).toBe(true);
    expect(isPrivateHostname('192.168.0.4')).toBe(true);
    expect(isPrivateHostname('169.254.169.254')).toBe(true);
    expect(isPublicHttpUrl('http://127.0.0.1/')).toBe(false);
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('https://example.com/pricing')).toBe(true);
  });

  it('treats www and the bare host as one site', () => {
    expect(sameSite('https://www.example.com/a', 'https://example.com')).toBe(true);
    expect(sameSite('https://other.example/a', 'https://example.com')).toBe(false);
  });
});

describe('scanSite', () => {
  it('collects vendors from the sitemap pages and skips other hosts', async () => {
    const files = {
      'https://example.com/robots.txt': 'Sitemap: https://example.com/sitemap.xml\n',
      'https://example.com/sitemap.xml': `<urlset>
        <url><loc>https://example.com/</loc></url>
        <url><loc>https://example.com/pricing</loc></url>
        <url><loc>https://evil.example/steal</loc></url>
      </urlset>`,
      'https://example.com/': '<html><script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script></html>',
      'https://example.com/pricing': '<html><script src="https://connect.facebook.net/en_US/fbevents.js"></script></html>',
    };
    const fetched = [];
    const result = await scanSite('https://example.com', {
      fetchImpl: async (url) => {
        fetched.push(url);
        if (!files[url]) return jsonResponse('missing', 404, 'text/plain');
        const type = url.endsWith('.xml') ? 'application/xml' : url.endsWith('.txt') ? 'text/plain' : 'text/html';
        return jsonResponse(files[url], 200, type);
      },
    });
    expect(fetched).not.toContain('https://evil.example/steal');
    expect(result.pagesScanned).toBe(2);
    expect(result.vendors.map((vendor) => vendor.id).sort()).toEqual(['google-analytics', 'meta-pixel']);
    expect(result.vendors.find((vendor) => vendor.id === 'google-analytics').cookies.some((cookie) => cookie.name === '_ga')).toBe(true);
  });

  it('follows a sitemap index and still scans the address that was entered', async () => {
    const files = {
      'https://shop.example/robots.txt': '',
      'https://shop.example/sitemap.xml': '<sitemapindex><sitemap><loc>https://shop.example/pages.xml</loc></sitemap></sitemapindex>',
      'https://shop.example/pages.xml': '<urlset><url><loc>https://shop.example/about</loc></url></urlset>',
      'https://shop.example/blog': '<html><script src="https://www.googletagmanager.com/gtm.js?id=GTM-1"></script></html>',
      'https://shop.example/about': '<html><p>About</p></html>',
    };
    const result = await scanSite('https://shop.example/blog', {
      fetchImpl: async (url) => jsonResponse(files[url] || '', files[url] ? 200 : 404, url.includes('xml') ? 'application/xml' : 'text/html'),
    });
    expect(result.vendors.map((vendor) => vendor.id)).toEqual(['google-tag-manager']);
    expect(result.pagesListed).toBe(2);
  });

  it('reads active tags inside a Google Tag Manager container', async () => {
    const container = `var data = ${JSON.stringify({
      resource: {
        tags: [
          { function: '__googtag', vtp_tagId: 'G-TEST' },
          { function: '__paused', vtp_originalTagType: 'awct' },
          { function: '__html', vtp_html: '<script src="https://connect.facebook.net/en_US/fbevents.js"></script>' },
          { function: '__cvt_1' },
        ],
      },
      permissions: { __cvt_1: { inject_script: { urls: ['https://static.ads-twitter.com/uwt.js'] } } },
    })}`;
    function library(){ return "https://www.youtube.com/embed/library"; }
    const ids = vendorIdsFromGtm(`${container}\n${library.toString()}`).sort();
    expect(ids).toEqual(['google-analytics', 'meta-pixel', 'x-pixel']);
    const snippet = `(function(){ j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i; })(window, document, 'script', 'dataLayer', 'GTM-PJSPT6J');`;
    expect(gtmContainerUrls(snippet)).toEqual(['https://www.googletagmanager.com/gtm.js?id=GTM-PJSPT6J']);
    expect(gtmContainerUrls('<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>')).toEqual([]);
  });

  it('adds the container tags to the scan', async () => {
    const container = `var data = ${JSON.stringify({
      resource: { tags: [{ function: '__gaawe', vtp_measurementIdOverride: 'G-1' }, { function: '__awct', vtp_conversionId: '1' }] },
    })}`;
    const files = {
      'https://example.com/robots.txt': '',
      'https://example.com/sitemap.xml': '<urlset><url><loc>https://example.com/</loc></url></urlset>',
      'https://example.com/': `<html><script>j.src='https://www.googletagmanager.com/gtm.js?id='+i</script><script>'GTM-TEST1'</script><script src="https://www.google.com/recaptcha/api.js"></script></html>`,
      'https://www.googletagmanager.com/gtm.js?id=GTM-TEST1': container,
    };
    const result = await scanSite('https://example.com', {
      fetchImpl: async (url) => jsonResponse(files[url] || '', files[url] ? 200 : 404, url.includes('gtm.js') ? 'application/javascript' : 'text/html'),
    });
    expect(result.vendors.map((vendor) => vendor.id).sort()).toEqual(['google-ads', 'google-analytics', 'google-tag-manager', 'recaptcha']);
  });

  it('adds https when the address has no scheme', async () => {
    const fetched = [];
    const result = await scanSite('povio.com', {
      fetchImpl: async (url) => {
        fetched.push(url);
        return jsonResponse('<html></html>');
      },
    });
    expect(result.url).toBe('https://povio.com/');
    expect(fetched[0]).toBe('https://povio.com/robots.txt');
  });

  it('refuses a private address before fetching it', async () => {
    let called = false;
    await expect(scanSite('http://127.0.0.1/', { fetchImpl: async () => { called = true; return jsonResponse(''); } })).rejects.toThrow(/public/);
    expect(called).toBe(false);
  });
});
