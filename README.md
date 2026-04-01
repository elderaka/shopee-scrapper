# Shopee.co.id Product Scraper

A web scraper that finds the **3 cheapest products** on Shopee Indonesia based on a keyword search.

## How It Works

1. Uses **Camoufox** (anti-detect Firefox browser) to navigate Shopee's search page
2. Waits for JavaScript-rendered product cards to load
3. Parses product names, prices, and links from the DOM
4. Sorts by price ascending and returns the 3 cheapest

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Browser Automation**: [Camoufox](https://camoufox.com/) (anti-detect browser based on Firefox)
- **Web Server**: Express.js
- **Anti-Detection**: Humanization (mouse movement, scrolling, drag patterns), residential proxies, session rotation

## Getting Started

### Prerequisites

- Node.js 22+
- (Optional) Residential proxy with Indonesian IP support

### Install & Run

```bash
npm install
npx camoufox-js fetch

# Development
npm run dev

# Production
npm run build
npm start
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `PROXY_URL` | — | Proxy URL (`http://user:pass@host:port`) |
| `HEADLESS` | `true` | Run browser headless |
| `WARMUP_URL` | `https://shopee.co.id` | Warmup URL |

## Usage

### Web UI

Open `http://localhost:3000` in your browser. Enter a keyword and click "Cari".

### API

```
GET /search?keyword=Compressor
```

Response:
```json
{
  "success": true,
  "keyword": "Compressor",
  "products": [
    {
      "name": "Mini Compressor Portable",
      "price": 45000,
      "priceFormatted": "Rp45.000",
      "link": "https://shopee.co.id/..."
    }
  ]
}
```

### Health Check

```
GET /health
```

## Deployment (Docker)

```bash
docker build -t shopee-scraper .
docker run -p 8080:8080 -e PORT=8080 shopee-scraper
```

## Output Format

```
1. Nama Product: XXX
   Harga: Rp XXX
   Link: https://shopee.co.id/xxx

2. Nama Product: XXX
   Harga: Rp XXX
   Link: https://shopee.co.id/xxx

3. Nama Product: XXX
   Harga: Rp XXX
   Link: https://shopee.co.id/xxx
```

## Scraping Approach

This scraper uses a **headless anti-detect browser** (Camoufox) to render Shopee's fully JavaScript-driven search results page, then extracts product data directly from the rendered DOM. This approach bypasses Shopee's heavy anti-bot protections by presenting a realistic browser fingerprint with human-like interaction patterns (mouse movements, scrolling, click-drag). Session rotation with residential proxies provides fallback if a session gets blocked.
