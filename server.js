import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import { getClientIp } from './src/client-ip.js';
import { loadConfig } from './src/config.js';
import { handleRequest } from './src/index.js';
import { createSqliteState } from './src/state.js';

const config = loadConfig();
const parsedPort = Number.parseInt(config.PORT || '7890', 10);
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 7890;
const sqlitePath = resolve(process.cwd(), config.SQLITE_PATH || 'data/vrc2link.sqlite');
const state = createSqliteState(sqlitePath);
const cleanupTimer = setInterval(() => state.purgeExpired(), 60_000);
cleanupTimer.unref();
const trustProxy = String(config.TRUST_PROXY).toLowerCase() === 'true';
const logger = (entry) => console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  ...entry,
}));

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }

    const requestInit = {
      method: request.method,
      headers,
    };
    const hasRequestBody = Number(request.headers['content-length']) > 0 ||
      request.headers['transfer-encoding'] != null;
    if (request.method !== 'GET' && request.method !== 'HEAD' && hasRequestBody) {
      requestInit.body = Readable.toWeb(request);
      requestInit.duplex = 'half';
    }

    const webResponse = await handleRequest(new Request(url, requestInit), {
      env: config,
      state,
      logger,
      clientIp: getClientIp(headers, request.socket.remoteAddress, trustProxy),
    });
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    if (!webResponse.body) {
      response.end();
      return;
    }
    Readable.fromWeb(webResponse.body).pipe(response);
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'server_error',
      errorName: error.name,
    }));
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      error: { code: 'internal_error', message: 'Internal server error' },
    }));
  }
});

server.listen(port, () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'server_started',
    port,
    sqlitePath,
  }));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => {
      clearInterval(cleanupTimer);
      state.close();
      process.exit(0);
    });
  });
}
