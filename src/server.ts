import express from 'express';
import type { Request, Response } from 'express';
import { searchShopee, BlockedError } from './scraper.js';
import { warmupSession, rotateSession } from './warmup.js';
import { getActiveSession } from './session.js';
import { ProxyAuthError } from './browser.js';

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_RETRIES = 3;

let isServerReady = false;
let isWarmingUp = false;

// Global request logger
app.use((req, res, next) => {
  console.log(`[EXPRESS] ${req.method} ${req.url}`);
  next();
});

// Request queue system
interface QueuedRequest {
  keyword: string;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  id: string;
}

const requestQueue: QueuedRequest[] = [];
let isProcessingQueue = false;
let requestCounter = 0;

// When starting the server, warm it up first
(async () => {
  console.log('[SERVER] Starting warmup...');
  isWarmingUp = true;
  try {
    await warmupSession();
    isServerReady = true;
    console.log('[SERVER] Ready to handle requests');
  } catch (error) {
    if (error instanceof ProxyAuthError) {
      console.error('[SERVER] Proxy authentication failed during warmup.');
      console.error('[SERVER] Server will remain in not_ready state.');
    } else {
      console.error('[SERVER] Warmup failed:', error);
    }
  } finally {
    isWarmingUp = false;
  }
})();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Queue processor
async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;

  isProcessingQueue = true;
  console.log(`[QUEUE] Starting queue processing - ${requestQueue.length} requests pending`);

  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (!request) break;

    console.log(`[QUEUE] Processing request ${request.id} - ${requestQueue.length} remaining`);

    try {
      const result = await scrapeWithRetry(request.keyword);
      request.resolve(result);
    } catch (error) {
      request.reject(error);
    }

    if (requestQueue.length > 0) {
      const delayMs = 3000 + Math.random() * 4000;
      console.log(`[QUEUE] Waiting ${(delayMs / 1000).toFixed(1)}s before next request...`);
      await delay(delayMs);
    }
  }

  isProcessingQueue = false;
  console.log('[QUEUE] Queue processing complete');
}

// Scrape with retry + session rotation on block
async function scrapeWithRetry(keyword: string): Promise<any> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[SERVER] Scraping attempt ${attempt}/${MAX_RETRIES}: "${keyword}"`);
      const result = await searchShopee(keyword);
      console.log(`[SERVER] Scraping successful on attempt ${attempt}`);
      return result;

    } catch (error) {
      if (error instanceof BlockedError) {
        console.log(`[SERVER] Blocked (${error.blockType}: ${error.message})`);

        if (attempt < MAX_RETRIES) {
          console.log(`[SERVER] Rotating session before retry...`);
          isWarmingUp = true;
          try {
            await rotateSession();
            console.log('[SERVER] New session ready');
          } catch (rotateError) {
            if (rotateError instanceof ProxyAuthError) {
              console.error('[SERVER] Proxy auth failed during rotation');
              throw rotateError;
            }
            console.error('[SERVER] Rotation failed:', rotateError);
          } finally {
            isWarmingUp = false;
          }
        } else {
          console.log(`[SERVER] Max retries reached, giving up`);
          throw error;
        }
      } else {
        console.error('[SERVER] Non-block error:', error);
        throw error;
      }
    }
  }

  throw new Error('Max retries reached');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── ROUTES ───

// Health check
app.get('/health', (req: Request, res: Response) => {
  const session = getActiveSession();
  res.json({
    status: isServerReady ? 'ready' : (isWarmingUp ? 'warming_up' : 'not_ready'),
    hasSession: !!session.browser,
    sessionId: session.sessionId,
  });
});

// HTML Frontend
app.get('/', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(getHtmlPage());
});

// Search API endpoint
app.get('/search', async (req: Request, res: Response) => {
  const keyword = req.query.keyword as string;

  if (!keyword || keyword.trim().length === 0) {
    res.status(400).json({ error: 'keyword query parameter is required' });
    return;
  }

  if (isWarmingUp) {
    res.status(503).json({
      error: 'Server is warming up a new session',
      status: 'warming_up',
      retry_after: 10
    });
    return;
  }

  if (!isServerReady) {
    res.status(503).json({ error: 'Service not ready', retry_after: 5 });
    return;
  }

  // Add to queue
  requestCounter++;
  const requestId = `REQ-${requestCounter}`;
  console.log(`[SERVER] Queuing search "${keyword}" as ${requestId} - Queue size: ${requestQueue.length + 1}`);

  const queuePromise = new Promise((resolve, reject) => {
    requestQueue.push({ keyword: keyword.trim(), resolve, reject, id: requestId });
    processQueue();
  });

  try {
    const products = await queuePromise;
    res.json({
      success: true,
      keyword: keyword.trim(),
      products,
    });
  } catch (error) {
    if (error instanceof ProxyAuthError) {
      res.status(502).json({
        error: 'Proxy authentication failed',
        message: 'Proxy credentials are invalid or expired.',
      });
    } else if (error instanceof BlockedError) {
      res.status(429).json({ error: 'Blocked by Shopee after max retries', blockType: error.blockType });
    } else {
      console.error('[SERVER] Error:', error);
      res.status(500).json({ error: 'Scraping failed' });
    }
  }
});

// ─── HTML FRONTEND ───

function getHtmlPage(): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Shopee Scraper Test</title>
  <style>
    body {
      font-family: "Calibri", "Arial", sans-serif;
      font-size: 11pt;
      margin: 40px;
      color: #000;
      background-color: #fff;
      line-height: 1.4;
    }
    .instructions {
      margin-bottom: 30px;
    }
    .instructions p {
      margin: 10px 0;
    }
    ul {
      margin: 10px 0;
      padding-left: 40px;
    }
    li {
      margin-bottom: 5px;
    }
    .example-title {
      font-weight: bold;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    .result-box {
      background-color: #E6E6E6;
      padding: 30px;
      width: 700px;
      min-height: 400px;
      border: none;
    }
    .search-area {
      margin-top: 20px;
      margin-bottom: 20px;
    }
    input[type="text"] {
      padding: 3px;
      width: 250px;
      border: 1px solid #767676;
    }
    button {
      padding: 2px 10px;
    }
    .product-item {
      margin-bottom: 40px;
    }
    .product-label {
      margin-bottom: 15px;
    }
    .error {
      color: red;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="instructions">
    <p>Requirements:</p>
    <ul>
      <li>The program should accept a keyword input (example: "Compressor").</li>
      <li>Scrape product data from Shopee based on the keyword.</li>
      <li>Retrieve 3 products with the lowest price from the search results.</li>
    </ul>

    <p>Output Format:<br>
    Display the result in the following format:</p>
    <ul>
      <li>Product Name</li>
      <li>Product Price</li>
      <li>Product Link</li>
    </ul>

    <p class="example-title">Example Output:</p>
  </div>

  <div class="search-area">
    <form id="searchForm">
      <input type="text" id="keywordInput" placeholder='example: "Compressor"' required>
      <button type="submit" id="searchBtn">Search</button>
    </form>
    <div id="loading" style="display: none; margin-top: 10px;">Searching...</div>
  </div>

  <div id="results" class="result-box">
    <!-- Results will appear here -->
  </div>

  <script>
    const form = document.getElementById('searchForm');
    const input = document.getElementById('keywordInput');
    const btn = document.getElementById('searchBtn');
    const results = document.getElementById('results');
    const loading = document.getElementById('loading');

    form.addEventListener('submit', async (e) => {  
      e.preventDefault();
      const keyword = input.value.trim();
      if (!keyword) return;

      btn.disabled = true;
      results.innerHTML = '';
      loading.style.display = 'block';

      try {
        const res = await fetch('/search?keyword=' + encodeURIComponent(keyword));
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Request failed');
        }

        if (!data.products || data.products.length === 0) {
          results.innerHTML = '<div>No products found.</div>';
          return;
        }

        let html = '';
        data.products.forEach((product, i) => {     
          html += \`
            <div class="product-item">
              <div class="product-label">\${i + 1}. Nama Product: \${escapeHtml(product.name)}</div>
              <div class="product-label">Harga: \${escapeHtml(product.priceFormatted || 'Rp ' + Number(product.price).toLocaleString('id-ID'))}</div>
              <div class="product-label">Link: <a href="\${escapeHtml(product.link)}" target="_blank">\${escapeHtml(product.link)}</a></div>
            </div>
          \`;
        });

        results.innerHTML = html;

      } catch (err) {
        results.innerHTML = \`<div class="error">Error: \${escapeHtml(err.message)}</div>\`;
      } finally {
        btn.disabled = false;
        loading.style.display = 'none';
      }
    });

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
  </script>
</body>
</html>`;
}
