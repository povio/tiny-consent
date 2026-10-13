// Bundles src/tiny-consent.js into a single synchronous IIFE.
//   node build.mjs          -> dist/tiny-consent.js + dist/tiny-consent.min.js
//   node build.mjs --serve  -> same, rebuilt on change, served at http://localhost:8787/
//                              GET /api/scan?url= scans that site's sitemap for trackers

import http from 'node:http';
import * as esbuild from 'esbuild';
import { scanSite } from './scan-site.js';

const serve = process.argv.includes('--serve');

const common = {
  entryPoints: ['src/tiny-consent.js'],
  bundle: true,
  format: 'iife',
  target: ['es2018'],
  legalComments: 'none',
};

const readable = { ...common, outfile: 'dist/tiny-consent.js' };
const minified = { ...common, outfile: 'dist/tiny-consent.min.js', minify: true };

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(json);
}

async function handleScan(res, searchParams) {
  const target = searchParams.get('url') || '';
  const days = Number(searchParams.get('days')) || 180;
  try {
    const result = await scanSite(target, { cookieDays: days });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error.message || 'The scan failed.' });
  }
}

if (serve) {
  const ctx = await esbuild.context(readable);
  await ctx.watch();
  const internal = await ctx.serve({ servedir: '.', host: '127.0.0.1', port: 0 });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/scan') {
      handleScan(res, url.searchParams);
      return;
    }
    const headers = { ...req.headers, host: `127.0.0.1:${internal.port}` };
    const proxied = http.request(
      { hostname: '127.0.0.1', port: internal.port, path: req.url, method: req.method, headers },
      (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxied.on('error', () => {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Dev server proxy failed.');
    });
    req.pipe(proxied);
  });
  server.listen(8787, () => {
    console.log('Serving at http://localhost:8787/');
  });
} else {
  await Promise.all([esbuild.build(readable), esbuild.build(minified)]);
  console.log('Built dist/tiny-consent.js and dist/tiny-consent.min.js');
}
