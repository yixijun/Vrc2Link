import { createServer } from 'node:http';

import { loadConfig } from './src/config.js';
import { handleRequest } from './src/index.js';

const config = loadConfig();
const parsedPort = Number.parseInt(config.PORT || '7890', 10);
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 7890;

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }

    const webResponse = await handleRequest(new Request(url, {
      method: request.method,
      headers,
    }), { env: config });
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    response.end(Buffer.from(await webResponse.arrayBuffer()));
  } catch (error) {
    console.error(`[server] ${error.message}`);
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      error: { code: 'internal_error', message: 'Internal server error' },
    }));
  }
}).listen(port, () => {
  console.log(`Vrc2Link listening on http://localhost:${port}`);
  console.log('Endpoints: /api  /play');
});
