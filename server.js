/**
 * Vrc2Link — Node.js server entry point.
 * Usage: node server.js  (default port 3000, or set PORT env var)
 */

import { createServer } from 'http';
import { handleRequest } from './src/index.js';

const PORT = process.env.PORT || 7890;

createServer(async (req, res) => {
  try {
    // Build Web Request from Node request
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }

    let body = null;
    if (req.method === 'POST') {
      body = await new Promise(resolve => {
        let data = '';
        req.on('data', c => data += c);
        req.on('end', () => resolve(data || null));
      });
    }

    const webReq = new Request(url.toString(), { method: req.method, headers, body });
    const webRes = await handleRequest(webReq);

    // Write response
    const resHeaders = {};
    for (const [k, v] of webRes.headers.entries()) resHeaders[k] = v;
    res.writeHead(webRes.status, resHeaders);

    const text = await webRes.text();
    res.end(text);
  } catch (err) {
    console.error('server error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: true, code: 500, message: 'Internal server error' }));
  }
}).listen(PORT, () => {
  console.log(`Vrc2Link → http://localhost:${PORT}`);
  console.log('Endpoints: /api/parse  /r');
});
