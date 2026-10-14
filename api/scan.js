// Vercel serverless equivalent of the dev server's GET /api/scan.
import { scanSite } from '../scan-site.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    res.status(405).json({ error: 'Use GET.' });
    return;
  }
  const target = req.query.url || '';
  const days = Number(req.query.days) || 180;
  try {
    const result = await scanSite(target, { cookieDays: days });
    res.setHeader('cache-control', 'no-store');
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'The scan failed.' });
  }
}
