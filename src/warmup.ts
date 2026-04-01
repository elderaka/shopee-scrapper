import type { Browser, BrowserContext, Page } from "playwright-core";
import {
  createBrowser,
  generateSessionId,
  checkIP,
  SHOPEE_PHONE,
  SHOPEE_PASSWORD,
} from "./browser.js";
import { Humanize } from "./humanization.js";
import { setActiveSession, closeActiveSession } from "./session.js";
import { SESSION_PATH } from "./browser.js";
import fs from "fs";

// Shopee warmup URL


// Create a newly warmed-up session against Shopee
export async function warmupSession(): Promise<{
  browser: Browser | BrowserContext;
  sessionId: string;
}> {
  console.log("[WARMUP] Starting session warmup...");

  for (let attempt = 1; ; attempt++) {
    const sessionId = generateSessionId();
    console.log(`[WARMUP] Attempt ${attempt} | Session: ${sessionId}`);

    try {
      // Quick IP check
      const ipInfo = await checkIP(sessionId);
      console.log(`[WARMUP] IP: ${ipInfo.ip} | Country: ${ipInfo.country}`);

      if (ipInfo.country !== "ID") {
        console.log(
          `[WARMUP] Got Non-Indonesian IP (${ipInfo.country}), trying next...`,
        );
        await delay(500);
        continue;
      }

      console.log(`[WARMUP] Indonesian IP found! Creating browser...`);
      const browser = await createBrowser(sessionId);

      const humanizeStopSignal = { stopped: false };
      let humanizeTask: Promise<void> | null = null;

      const startHumanize = (): Promise<void> =>
        Humanize(browser, humanizeStopSignal, sessionId).finally(() => {
          if (!humanizeStopSignal.stopped) {
            console.log(
              `[Humanization] Restarting humanization for session ${sessionId}`,
            );
            humanizeTask = startHumanize();
          }
        });

      // Visit Shopee homepage to build trust
      let page: Page;
      // Try to get the existing blank tab opened by the browser launch
      if ("contexts" in browser) {
        const contexts = browser.contexts();
        if (contexts.length > 0) {
          const ctx = contexts[0] as BrowserContext;
          const pages = ctx.pages();
          page = pages.length > 0 ? (pages[0] as Page) : await ctx.newPage();
        } else {
          page = await browser.newPage();
        }
      } else {
        const pages = browser.pages();
        page = pages.length > 0 ? (pages[0] as Page) : await browser.newPage();
      }
      // ── Step 1: Visit Shopee HOMEPAGE first to build session trust ──
      const HOMEPAGE_URL = "https://shopee.co.id";
      console.log(`[WARMUP] Visiting Shopee homepage to build trust: ${HOMEPAGE_URL}`);
      try {
        await page.goto(HOMEPAGE_URL, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
      } catch (e: any) {
        console.log("[WARMUP] Homepage timeout, checking if page is accessible...");
        try {
          await page.evaluate(() => document.readyState);
        } catch {
          throw e;
        }
      }

      // ── Step 2: Do light humanization then poll until on /buyer/login ──
      // The homepage often auto-redirects to login. We just wait for it.
      console.log("[WARMUP] Waiting for browser to reach login page (up to 30s)...");
      const maxLoginWaitMs = 30000;
      const pollIntervalMs = 1000;
      let elapsed = 0;
      let onLoginPage = false;

      // Do some mouse movement while we wait
      const humanizePoll = (async () => {
        try {
          await page.mouse.move(300, 400, { steps: 15 });
          await delay(800);
          await page.mouse.wheel(0, 200);
          await delay(1200 + Math.random() * 1500);
          await page.mouse.move(600, 300, { steps: 12 });
        } catch { /* ignore if page navigates */ }
      })();

      while (elapsed < maxLoginWaitMs) {
        const currentUrl = page.url();
        if (currentUrl.includes("/buyer/login")) {
          onLoginPage = true;
          console.log(`[WARMUP] Login page detected at ${currentUrl}`);
          break;
        }
        await delay(pollIntervalMs);
        elapsed += pollIntervalMs;
      }
      await humanizePoll.catch(() => {});

      if (!onLoginPage) {
        console.log("[WARMUP] Not redirected automatically, navigating to login page manually...");
        try {
          await page.goto("https://shopee.co.id/buyer/login", {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
        } catch (e: any) {
          console.log("[WARMUP] Login page timeout, continuing...");
          try { await page.evaluate(() => document.readyState); } catch { throw e; }
        }
      }

      // ── Step 3: Now on login page — handle Bahasa modal ──
      console.log("[WARMUP] On login page. Waiting 10 seconds for Bahasa modal...");
      await delay(10000);
      try {
        let modalRetries = 0;
        const maxModalRetries = 5;

        while (modalRetries < maxModalRetries) {
          const modalExists = await page.evaluate(() => {
            const headerText = "Pilih bahasa Anda";
            const btnText = "Bahasa Indonesia";
            const hasHeader = Array.from(document.querySelectorAll('*')).some(el => el.textContent?.includes(headerText));
            const hasBtn = Array.from(document.querySelectorAll('button, div')).some(el => el.textContent?.trim() === btnText || el.classList.contains('vsIIDR'));
            return hasHeader || hasBtn;
          }).catch(() => false);

          if (!modalExists) {
            if (modalRetries > 0) console.log("[WARMUP] Bahasa modal cleared.");
            break;
          }

          console.log(`[WARMUP] Bahasa modal detected (Attempt ${modalRetries + 1}). Clicking...`);
          const clicked = await page.evaluate(() => {
            const btn = document.querySelector('button.vsIIDR') as HTMLElement ||
                        Array.from(document.querySelectorAll('button, div')).find(el => el.textContent?.trim() === "Bahasa Indonesia") as HTMLElement;
            if (btn) { btn.click(); return true; }
            return false;
          }).catch(() => false);

          if (clicked) {
            await delay(2000);
          } else {
            console.log("[WARMUP] Could not find click target in modal.");
            break;
          }
          modalRetries++;
        }
      } catch (err: any) {
        console.log(`[WARMUP] Error handling Bahasa modal: ${err.message}`);
      }
      await delay(2000);

      // Check if we landed on a real Shopee page (not a block page)
      let title = await page.title();
      console.log(
        `[WARMUP] Initial Page title: "${title}" | URL: ${page.url()}`,
      );

      if (
        title.toLowerCase().includes("captcha") ||
        title.toLowerCase().includes("verify") ||
        title.toLowerCase().includes("blocked")
      ) {
        console.log(`[WARMUP] Session appears blocked right away, retrying...`);
        humanizeStopSignal.stopped = true;
        await page.close();
        await browser.close();
        await delay(2000);
        continue;
      }

      console.log(`[WARMUP] Login Page title: "${title}"`);

      // Fill in credentials if provided
      if (SHOPEE_PHONE && SHOPEE_PASSWORD) {
        console.log(
          `[WARMUP] Filling login credentials for ${SHOPEE_PHONE}...`,
        );

        try {
          // Wait for login form
          await page.waitForSelector('input[name="loginKey"]', {
            timeout: 30000,
          });

          // Type phone number with human-like cadence
          await humanType(page, 'input[name="loginKey"]', SHOPEE_PHONE);
          await delay(500);

          // Press Tab to go to Password field (User request)
          console.log("[WARMUP] Pressing Tab to reach password field...");
          await page.keyboard.press("Tab");
          await delay(500);

          // Type password with human-like cadence
          await humanType(page, 'input[name="password"]', SHOPEE_PASSWORD);
          await delay(1000);

          // Press Enter instead of clicking login button (which might be covered by modals)
          console.log("[WARMUP] Pressing Enter to Log In...");
          await page.keyboard.press("Enter");

          // Wait to see what happens next (captcha, verification, or success)
          // User suggested adding more delay because it's still loading
          console.log("[WARMUP] Waiting 10 seconds for redirect/verification page...");
          await delay(10000);

          // 2.5 Handle Captcha
          let currentUrl = page.url();
          if (
            currentUrl.includes("/verify/captcha") ||
            currentUrl.includes("captcha")
          ) {
            console.log(
              "[WARMUP] Captcha detected! WAITING 60 SECONDS for you to solve it manually in the browser window...",
            );
            try {
              // Wait for navigation away from captcha page
              await page.waitForNavigation({
                timeout: 60000,
                waitUntil: "domcontentloaded",
              });
              console.log("[WARMUP] Captcha solved! Continuing login flow...");
            } catch (err) {
              console.log(
                "[WARMUP] Timeout waiting for captcha solution. Assuming it was solved or bypassed.",
              );
            }
            await delay(3000);
          }

          // 3. Handle Security Verification
          currentUrl = page.url();
          const pageContent = await page.content();
          
          if (
            currentUrl.includes("/verify/") ||
            pageContent.includes("Untuk keamanan akun") ||
            pageContent.includes("pemeriksaan keamanan") ||
            pageContent.includes("Verifikasi")
          ) {
            console.log(`[WARMUP] Security verification prompt detected at ${currentUrl}!`);

            try {
              // Click "Verifikasi melalui token" or similar
              // Sometime it's hidden and need to scroll
              const verifyBtn = await page.waitForSelector(
                'button:has-text("token"), button:has-text("Token"), [class*="verif"]:has-text("token"), :has-text("Verifikasi melalui token")',
                { timeout: 8000 },
              );
              
              if (verifyBtn) {
                console.log("[WARMUP] Scrolling to verification button...");
                await verifyBtn.scrollIntoViewIfNeeded();
                await delay(1000);

                console.log("[WARMUP] Clicking 'Verifikasi melalui token'...");
                await verifyBtn.click();
                await delay(2000);

                // Look for an 'OK' button that might appear after clicking the link button
                try {
                  console.log("[WARMUP] Checking for confirmation modal (OK button)...");
                  
                  // Wait up to 10s for the modal context or the button itself
                  const okButtonClicked = await page.evaluate(async () => {
                    // Helper to find OK-ish buttons
                    const findOkBtn = () => {
                      const selectors = ['button', 'div[role="button"]', '[class*="button"]'];
                      for (const selector of selectors) {
                        const elements = Array.from(document.querySelectorAll(selector));
                        const btn = elements.find(el => {
                          const text = el.textContent?.trim().toUpperCase();
                          return text === "OK" || text === "OKE" || text === "SAYA MENGERTI" || text === "LANJUT";
                        });
                        if (btn) return btn as HTMLElement;
                      }
                      return null;
                    };

                    // Try immediate find
                    let btn = findOkBtn();
                    if (btn) {
                      btn.click();
                      return true;
                    }

                    // If not found, wait a bit (this runs inside the page)
                    return new Promise((resolve) => {
                      let checks = 0;
                      const interval = setInterval(() => {
                        btn = findOkBtn();
                        if (btn) {
                          btn.click();
                          clearInterval(interval);
                          resolve(true);
                        }
                        if (checks++ > 20) { // 5 seconds total
                          clearInterval(interval);
                          resolve(false);
                        }
                      }, 250);
                    });
                  });

                  if (okButtonClicked) {
                    console.log("[WARMUP] OK button clicked via JS!");
                    await delay(2000);
                  } else {
                    console.log("[WARMUP] OK button not detected or not clickable.");
                  }
                } catch (e) {
                  console.log("[WARMUP] Error during OK button handling.");
                }

                // Wait for user action on phone and page redirect (up to 60 seconds)
                console.log(
                  "[WARMUP] WAITING up to 60 SECONDS... Please click the verification link sent to your phone/WhatsApp.",
                );

                try {
                  await page.waitForNavigation({
                    timeout: 60000,
                    waitUntil: "domcontentloaded",
                  });
                  console.log(
                    "[WARMUP] Page navigated! Verification likely successful.",
                  );
                } catch (navErr) {
                  console.log(
                    "[WARMUP] Timeout waiting for navigation after verification. Assuming manual intervention or back to login screen.",
                  );
                }

                // Extra delay to let things settle
                await delay(3000);
              }
            } catch (vErr) {
              console.log(
                "[WARMUP] Could not find the 'Verifikasi menggunakan link' option, or it timed out.",
              );
            }
          } else {
            console.log(
              "[WARMUP] No additional security verification prompt detected, or login completed instantly.",
            );
          }
        } catch (err: any) {
          console.log(`[WARMUP] Error during login flow: ${err.message}`);
        }
      } else {
        console.log(
          "[WARMUP] No SHOPEE_PHONE or SHOPEE_PASSWORD provided in .env. Skipping login automation and hoping for the best.",
        );
        await delay(5000);
      }

      console.log(`[WARMUP] Login flow complete. Session ready!`);

      // ── Step 4: Save the storageState (Handover to VPS or next run) ──
      try {
        let ctx: BrowserContext;
        if ("contexts" in browser) {
          ctx = browser.contexts()[0] as BrowserContext;
        } else {
          ctx = browser as unknown as BrowserContext;
        }
        
        if (ctx) {
          const state = await ctx.storageState();
          fs.writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2));
          console.log(`[WARMUP] Session state saved to ${SESSION_PATH}`);
        }
      } catch (saveErr: any) {
        console.log(`[WARMUP] Warning: Could not save storageState: ${saveErr.message}`);
      }

      // Start humanization only AFTER all the fragile login clicking is done
      console.log("[WARMUP] Starting humanization...");
      humanizeTask = startHumanize();
      setActiveSession(
        browser,
        sessionId,
        humanizeStopSignal,
        humanizeTask,
        page,
      );
      return { browser, sessionId };
    } catch (error: any) {
      console.log(`[WARMUP] Error: ${error.message}`);
    }

    await delay(2000);
  }
}

// Close current session and rotate to a freshly created one
export async function rotateSession(): Promise<{
  browser: Browser | BrowserContext;
  sessionId: string;
}> {
  console.log("[WARMUP] Rotating session...");
  await closeActiveSession();
  return warmupSession();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Emulates a human typing by randomizing the delay between keystrokes
async function humanType(page: Page, selector: string, text: string): Promise<void> {
  const el = await page.$(selector);
  if (el) {
    await el.focus();
    for (const char of text) {
      // Base delay plus a random variance (e.g. 30ms to 120ms total)
      const pressDelay = Math.floor(10 + Math.random() * 40);
      const afterDelay = Math.floor(20 + Math.random() * 70);
      await page.keyboard.type(char, { delay: pressDelay });
      await delay(afterDelay);
    }
  }
}
