import { Camoufox } from "camoufox-js";
import { firefox } from "playwright-core";
import type { Browser, BrowserContext } from "playwright-core";
import http from "http";
import https from "https";
import { config } from "dotenv";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

//Error for proxy authentication failures
export class ProxyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyAuthError';
  }
}

// ENV Config
config();
const proxy = process.env.PROXY_URL || process.env.PROXY || "";
const HEADLESS = process.env.HEADLESS || "true";
const IP_TEST_URL = process.env.IP_TEST_URL || "http://ipinfo.thordata.com";
export const SHOPEE_PHONE = process.env.SHOPEE_PHONE || "";
export const SHOPEE_PASSWORD = process.env.SHOPEE_PASSWORD || "";
export const CAMOUFOX_WS_URL = process.env.CAMOUFOX_WS_URL || "";

// Proxy configuration
let server = "";
let port = "";
let username = "";
let password = "";
export const hasProxy = proxy.length > 0;

if (hasProxy) {
  try {
    const proxyUrl = new URL(proxy);
    server = proxyUrl.hostname;
    port = proxyUrl.port;
    username = proxyUrl.username;
    password = proxyUrl.password;
    if (server === "" || port === "") {
      throw new Error("Invalid proxy URL, missing server or port");
    }
  } catch (err) {
    // Fallback to old colon-separated format (server:port:username:password)
    const proxyParts = proxy.split(":");
    console.log(`Parsed proxy string parts: ${proxyParts[0]}, port: ${proxyParts[1]}, ${proxyParts[2]}, ****`);
    server = proxyParts[0] || "";
    port = proxyParts[1] || "";
    username = proxyParts[2] || "";
    password = proxyParts.slice(3).join(":");
  }
  console.log(`[PROXY] Using proxy: ${server}:${port}`);
} else {
  console.log('[PROXY] No proxy configured — running without proxy');
}

export function generateSessionId(): string {
  const prefix = Math.random().toString(36).slice(2, 5);
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}${timestamp}${random}`;
}
export function withSessionUsername(
  baseUsername: string,
  sessionId?: string,
): string {
  let updatedUsername = baseUsername;
  if (!updatedUsername.includes("-country-id")) {
    updatedUsername = `${updatedUsername}-country-id`;
  }

  if (!sessionId) return updatedUsername;
  //TD
  if (updatedUsername.includes("td-customer-")) {
    if (updatedUsername.includes("-sessid-")) {
      return updatedUsername.replace(/-sessid-[^-]+/, `-sessid-${sessionId}`);
    }
    return `${updatedUsername}-sessid-${sessionId}-sesstime-90`;
  }

  //BRD
  if (updatedUsername.includes("brd-customer-")) {
    if (updatedUsername.includes("-session-")) {
      return updatedUsername.replace(/-session-[^-]+/, `-session-${sessionId}`);
    }
    return `${updatedUsername}-session-${sessionId}`;
  }

  return `${updatedUsername}-session-${sessionId}`;
}

//Fast IP check through proxy server testing.
export async function checkIP(sessionId: string): Promise<{ ip: string; country: string; city: string }> {
  // If no proxy configured, skip the IP check entirely
  if (!hasProxy) {
    console.log('[IP] No proxy — skipping IP check');
    return { ip: 'direct', country: 'ID', city: 'local' };
  }

  const sessionUsername = withSessionUsername(username || "", sessionId);
  const proxyUrl = `http://${sessionUsername}:${password}@${server}:${port}`;
  
  const agent = IP_TEST_URL.startsWith('https://') 
    ? new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false })
    : new HttpProxyAgent(proxyUrl);

  const checkUrl = IP_TEST_URL;
  const requestModule = IP_TEST_URL.startsWith('https://') ? https : http;

  return new Promise((resolve, reject) => {
    const req = requestModule.get(
      checkUrl,
      {
        agent,
        timeout: 10000,
        insecureHTTPParser: true,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
        },
      },
      (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 403 && data.includes("authentication failed")) {
          console.error("\n[CRITICAL] Proxy authentication failed");
          console.error(`Response: ${data}`);
          reject(new ProxyAuthError("Proxy credentials are invalid or expired. Please update .env file with new proxy credentials."));
          return;
        }
        try {
          const ipInfo = JSON.parse(data);
          resolve({
            ip: `${ipInfo.asn?.asnum || "no-ip"}-${ipInfo.geo?.city || "unknown"}`,
            country: ipInfo.country || ipInfo.geo?.country || "unknown",
            city: ipInfo.geo?.city || "unknown",
          });
        } catch (e) {
          reject(new Error(`Failed to parse IP info response: ${e}`));
        }
      },
    );
    });

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("IP check timeout"));
    });
  });
}

//Create a Camoufox browser instance (local) or connect to remote server
export async function createBrowser(sessionId: string): Promise<Browser | BrowserContext> {
  console.log(`[CAMOUFOX] Session ID: ${sessionId}`);

  // ── Remote mode: connect to the browser-server running on local machine ──
  if (CAMOUFOX_WS_URL) {
    console.log(`[CAMOUFOX] Remote mode — connecting to: ${CAMOUFOX_WS_URL}`);
    const startTime = Date.now();
    try {
      const browser = await firefox.connect(CAMOUFOX_WS_URL);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[CAMOUFOX] Connected to remote browser in ${elapsed}s`);
      return browser;
    } catch (err: any) {
      throw new Error(`[CAMOUFOX] Failed to connect to remote browser at ${CAMOUFOX_WS_URL}: ${err.message}`);
    }
  }

  // ── Local mode: launch Camoufox on this machine (default) ──
  const camoufoxOptions: any = {
    headless: HEADLESS === "true",

    // OS distribution: Windows dominates (~70% real-world traffic)
    os: ["windows", "windows", "windows", "macos", "linux"] as any,

    locale: "id-ID",
    geoip: false,

    screen: {
      minWidth: 1280,
      maxWidth: 1920,
      minHeight: 720,
      maxHeight: 1080,
    },

    humanize: true,

    config: {
      "battery:charging": true,
      "battery:chargingTime": 0,
      "battery:dischargingTime": Infinity,
      "battery:level": 0.67,
    },

    persistent_context: false,
    ignore_https_errors: true,
  };

  if (hasProxy) {
    const PROXY_USERNAME = withSessionUsername(username || "", sessionId);
    const PROXY_PASSWORD = password || "";
    camoufoxOptions.proxy = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${server}:${port}`;
    console.log(`[CAMOUFOX] Proxy: ${server}:${port}`);
    console.log(`[CAMOUFOX] Username: ${PROXY_USERNAME}`);
  } else {
    console.log(`[CAMOUFOX] Running without proxy`);
  }

  const startTime = Date.now();
  let browser: any;

  try {
    browser = await Camoufox(camoufoxOptions);
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.error(`[CAMOUFOX] ERROR creating browser: ${msg}`);

    if (msg.toLowerCase().includes("authentication") || msg.toLowerCase().includes("proxy")) {
      throw new ProxyAuthError(`Browser creation failed due to proxy issue: ${msg}`);
    }

    throw err;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[CAMOUFOX] Browser ready in ${elapsed}s`);

  return browser;
}
