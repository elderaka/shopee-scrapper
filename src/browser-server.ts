/**
 * browser-server.ts
 *
 * Run this on your LOCAL MACHINE (Windows) to expose a Camoufox browser
 * as a WebSocket server that the VPS can connect to.
 *
 * Usage:
 *   npm run browser-server
 *
 * Then set CAMOUFOX_WS_URL=ws://<your-local-ip>:<port> in the VPS .env
 */

import { launchServer } from 'camoufox-js';
import { config } from 'dotenv';

config();

const PORT = parseInt(process.env.BROWSER_SERVER_PORT || '4444', 10);
const WS_PATH = process.env.BROWSER_SERVER_PATH || 'camoufox';
const PROXY_URL = process.env.PROXY_URL || process.env.PROXY || '';

console.log('[BROWSER-SERVER] Starting Camoufox remote server...');
console.log(`[BROWSER-SERVER] Port: ${PORT} | Path: /${WS_PATH}`);

const serverOptions: any = {
  headless: false,  // Run with visible browser window on your machine
  locale: 'id-ID',
  os: ['windows', 'windows', 'windows', 'macos', 'linux'] as any,
  screen: {
    minWidth: 1280,
    maxWidth: 1920,
    minHeight: 720,
    maxHeight: 1080,
  },
  humanize: true,
  config: {
    'battery:charging': true,
    'battery:chargingTime': 0,
    'battery:dischargingTime': Infinity,
    'battery:level': 0.67,
  },
  port: PORT,
  ws_path: WS_PATH,
};

if (PROXY_URL) {
  serverOptions.proxy = PROXY_URL;
  console.log('[BROWSER-SERVER] Using proxy from .env');
} else {
  console.log('[BROWSER-SERVER] No proxy configured');
}

launchServer(serverOptions).then((server) => {
  const wsEndpoint = server.wsEndpoint();
  console.log(`\n[BROWSER-SERVER] ✅ Ready!`);
  console.log(`[BROWSER-SERVER] WebSocket endpoint: ${wsEndpoint}`);
  console.log(`[BROWSER-SERVER] Set this in your VPS .env:`);
  console.log(`[BROWSER-SERVER]   CAMOUFOX_WS_URL=${wsEndpoint.replace('localhost', '<YOUR_LOCAL_IP>')}\n`);
  console.log('[BROWSER-SERVER] Keeping server alive. Press Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    console.log('\n[BROWSER-SERVER] Shutting down...');
    await server.close();
    process.exit(0);
  });
}).catch((err) => {
  console.error('[BROWSER-SERVER] Failed to start:', err.message);
  process.exit(1);
});
