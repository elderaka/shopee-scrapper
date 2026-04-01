import type { Page } from 'playwright-core';
import { getActiveSession, setActiveSession } from './session.js';

// Custom error for blocked requests
export class BlockedError extends Error {
  status: number;
  blockType: 'rate_limit' | 'captcha' | 'connection';

  constructor(message: string, status: number, blockType: 'rate_limit' | 'captcha' | 'connection') {
    super(message);
    this.name = 'BlockedError';
    this.status = status;
    this.blockType = blockType;
  }
}

export interface ShopeeProduct {
  name: string;
  price: number;
  priceFormatted: string;
  link: string;
}

// Main scraping logic — search Shopee by keyword, return 3 cheapest products
export async function searchShopee(keyword: string): Promise<ShopeeProduct[]> {
  const startTime = Date.now();
  const session = getActiveSession();

  if (!session.browser) {
    throw new Error('No active browser session');
  }

  // Get or create page
  let page = session.page;
  if (!page || page.isClosed()) {
    console.log("[SCRAPER] Creating new page");
    page = await session.browser.newPage();
    setActiveSession(session.browser, session.sessionId, session.humanizeStopSignal, session.humanizeTask, page);
  } else {
    console.log("[SCRAPER] Reusing existing page");
  }

  const searchUrl = `https://shopee.co.id/search?keyword=${encodeURIComponent(keyword)}&page=0&sortBy=price&order=asc`;

  try {
    console.log(`[SCRAPER] Searching Shopee for: "${keyword}"`);
    console.log(`[SCRAPER] URL: ${searchUrl}`);

    let response: any = null;
    let status = 0;
    
    // Set up API interception BEFORE navigation
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('api/v4/search/search_items') && res.request().method() === 'GET',
      { timeout: 30000 }
    ).catch(e => {
      console.log(`[SCRAPER] API Interception failed: ${e.message}`);
      return null;
    });
    
    // Retry navigation up to 3 times for transient protocol errors
    for (let navAttempt = 1; navAttempt <= 3; navAttempt++) {
      try {
        response = await page.goto(searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        });
        status = response?.status() || 0;
        break; // Sucesss, exit retry loop
      } catch (navErr: any) {
        console.log(`[SCRAPER] Navigation attempt ${navAttempt} failed: ${navErr.message}`);
        if (navAttempt === 3) {
          throw navErr; // Give up on 3rd fail
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    console.log(`[SCRAPER] Page status: ${status}`);

    if (status === 429) {
      throw new BlockedError('Rate limited by Shopee', 429, 'rate_limit');
    }

    if (!status || status >= 400) {
      throw new BlockedError(`HTTP ${status}`, status || 0, 'connection');
    }

    // Check if we received the API response
    const apiRes = await responsePromise;
    if (!apiRes) {
      // API request not fired, check for CAPTCHA or block page
      const pageContent = await page.content();
      if (pageContent.includes('captcha') || pageContent.includes('verify')) {
        const title = await page.title();
        if (title.toLowerCase().includes('verify') || title.toLowerCase().includes('captcha')) {
          throw new BlockedError('CAPTCHA detected on Shopee', 403, 'captcha');
        }
      }
      throw new BlockedError('Search API response not found within timeout', 0, 'connection');
    }

    console.log(`[SCRAPER] Intercepted Shopee API response!`);
    const jsonData = await apiRes.json();
    const items = jsonData.items || [];
    console.log(`[SCRAPER] API returned ${items.length} items`);

    if (items.length === 0) {
      throw new BlockedError('No products found — API returned 0 items', 0, 'connection');
    }

    console.log("[SCRAPER] Parsing product data from JSON...");
    const products: ShopeeProduct[] = [];
    
    for (const item of items) {
      if (!item.item_basic) continue;
      
      const { name, price: rawPrice, shopid, itemid } = item.item_basic;
      
      // Shopee raw price contains 5 trailing zeros
      const price = rawPrice / 100000;
      const priceFormatted = `Rp${price.toLocaleString('id-ID')}`;
      
      // Construct the shopee product link
      const link = `https://shopee.co.id/product/${shopid}/${itemid}`;
      
      if (name && price > 0) {
        products.push({ name, price, priceFormatted, link });
      }
    }

    console.log(`[SCRAPER] Successfully parsed ${products.length} products`);

    // Sort by price ascending and take the 3 cheapest
    products.sort((a, b) => a.price - b.price);
    const cheapest3 = products.slice(0, 3);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[SCRAPER] Success! Found ${products.length} products, returning top 3 cheapest (${elapsed}s)`);

    return cheapest3;

  } catch (error) {
    if (error instanceof BlockedError) throw error;

    const msg = String((error as any)?.message || error);
    console.error(`[SCRAPER] Error: ${msg}`);

    if (msg.includes('timeout') || msg.includes('Timeout')) {
      throw new BlockedError(`Navigation timeout: ${msg}`, 0, 'connection');
    }

    throw error;
  }
}
