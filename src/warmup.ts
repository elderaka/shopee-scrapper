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
export async function warmupSession(isRotation: boolean = false): Promise<{
  browser: Browser | BrowserContext;
  sessionId: string;
}> {
  console.log(`[WARMUP] Starting session warmup (Rotation: ${isRotation})...`);

  for (let attempt = 1; ; attempt++) {
    const sessionId = generateSessionId();
    console.log(`[WARMUP-V2] Attempt ${attempt} | Session: ${sessionId}`);
    
    // ── SUPER-FAST HANDOVER ──
    // We check for the session file BEFORE we even create the browser or check IPs.
    // Skip this if we are intentionally rotating due to a block.
    if (!isRotation && fs.existsSync(SESSION_PATH)) {
      console.log(`[WARMUP-V2] Saved session found at ${SESSION_PATH}. Jumping to LIVE mode!`);
      const browser = await createBrowser(sessionId);
      let page: Page | null = null;
      
      // Safety: Correctly handle both Browser and BrowserContext return types
      if (browser && typeof (browser as any).contexts === 'function') {
        const b = (browser as unknown as Browser);
        const contexts = b.contexts();
        const firstCtx = contexts.length > 0 ? (contexts[0] as BrowserContext) : await b.newContext();
        const pages = firstCtx.pages();
        page = pages.length > 0 ? (pages[0] as Page) : await firstCtx.newPage();
      } else if (browser) {
        const ctx = (browser as unknown as BrowserContext);
        const pages = ctx.pages();
        page = pages.length > 0 ? (pages[0] as Page) : await ctx.newPage();
      }

      if (page) {
        setActiveSession(browser!, sessionId, { stopped: false }, null, page);
        console.log("[SERVER-V2] Session handover complete. Ready for searches.");
        return { browser: browser!, sessionId };
      }
    }

    let browser: Browser | BrowserContext | null = null;
    let page: Page | null = null;
    const humanizeStopSignal = { stopped: false };
    let humanizeTask: Promise<void> | null = null;

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
      browser = await createBrowser(sessionId);

      // ── FAST-TRACK HANDOVER ──
      // If we have a saved session file, we trust it and go LIVE immediately.
      // This allows the VPS to skip the 'warmup' navigation entirely.
      if (fs.existsSync(SESSION_PATH)) {
        console.log(`[WARMUP] Valid session file detected (${SESSION_PATH}). Going LIVE instantly.`);
        
        // Ensure we have a Page object for the session manager
        if (browser && "contexts" in (browser as any)) {
          const ctx = (browser as unknown as BrowserContext);
          const pages = ctx.pages();
          page = pages.length > 0 ? (pages[0] as Page) : await ctx.newPage();
        } else if (browser) {
          const b = (browser as unknown as Browser);
          const contexts = b.contexts();
          const firstCtx = contexts[0];
          if (firstCtx) {
            const pages = firstCtx.pages();
            page = pages.length > 0 ? (pages[0] as Page) : await firstCtx.newPage();
          } else {
            page = await b.newPage();
          }
        }

        if (page) {
          setActiveSession(browser!, sessionId, { stopped: false }, null, page);
          return { browser: browser!, sessionId };
        }
      }

      const startHumanize = (): Promise<void> =>
        Humanize(browser!, humanizeStopSignal, sessionId).finally(() => {
          if (!humanizeStopSignal.stopped) {
            console.log(
              `[Humanization] Restarting humanization for session ${sessionId}`,
            );
            humanizeTask = startHumanize();
          }
        });

      // Visit Shopee homepage to build trust
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
      console.log(
        `[WARMUP] Visiting Shopee homepage to build trust: ${HOMEPAGE_URL}`,
      );
      try {
        await page.goto(HOMEPAGE_URL, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
      } catch (e: any) {
        console.log(
          "[WARMUP] Homepage timeout, checking if page is accessible...",
        );
        try {
          await page.evaluate(() => document.readyState);
        } catch {
          throw e;
        }
      }

      // ── Step 2: Do light humanization then poll until on /buyer/login ──
      // ── Step 2: Polling with Visibility ──
      console.log(
        "[WARMUP] Waiting for browser to reach login page (up to 30s)...",
      );
      const maxLoginWaitMs = 30000;
      const pollIntervalMs = 2000;
      let elapsed = 0;
      let onLoginPage = false;

      while (elapsed < maxLoginWaitMs) {
        const currentUrl = page.url();
        const currentTitle = await page.title().catch(() => "Unknown");
        console.log(
          `[WARMUP] Current State | URL: ${currentUrl} | Title: "${currentTitle}"`,
        );

        if (currentUrl.includes("/buyer/login")) {
          onLoginPage = true;
          console.log(`[WARMUP] Login page detected!`);
          break;
        }

        // Take a debug screenshot every 10s if we're still waiting
        if (elapsed % 10000 === 0 && elapsed > 0) {
          console.log(
            "[WARMUP] Taking diagnostic screenshot: debug_warmup.png",
          );
          await page
            .screenshot({ path: "debug_warmup.png", fullPage: true })
            .catch(() => {});
        }

        await delay(pollIntervalMs);
        elapsed += pollIntervalMs;
      }

      if (!onLoginPage) {
        console.log(
          "[WARMUP] Auto-redirect failed. Forcing navigation to login page...",
        );
        try {
          await page.goto("https://shopee.co.id/buyer/login", {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          await page
            .screenshot({ path: "debug_manual_nav.png" })
            .catch(() => {});
        } catch (e: any) {
          console.log(
            `[WARMUP] Manual navigation failed: ${e.message}. Saving debug_failed_nav.png`,
          );
          await page
            .screenshot({ path: "debug_failed_nav.png" })
            .catch(() => {});
        }
      }

      // ── Step 3: Fast Proactive Modal & Login Search ──
      console.log(
        "[WARMUP] On login page. Proactively checking for Modal or Login Form...",
      );

      let phaseDetected: "modal" | "login" | "none" = "none";
      let checkElapsed = 0;
      const maxCheckMs = 15000; // max total wait

      while (checkElapsed < maxCheckMs) {
        const currentUrl = page.url();
        const currentTitle = await page.title().catch(() => "Unknown");

        // Immediate Antibot Check
        if (
          currentUrl.includes("captcha") ||
          currentTitle.toLowerCase().includes("captcha") ||
          currentTitle.toLowerCase().includes("blocked") ||
          currentTitle.toLowerCase().includes("access denied")
        ) {
          console.log(
            `[WARMUP] Antibot detected! (Title: "${currentTitle}", URL: ${currentUrl}). Restarting session...`,
          );
          throw new Error("AntibotBlock");
        }

        phaseDetected = (await page
          .evaluate(() => {
            // Check for login form first (priority)
            if (document.querySelector('input[name="loginKey"]'))
              return "login";

            // Check for Bahasa modal
            const headerText = "Pilih bahasa Anda";
            const btnText = "Bahasa Indonesia";
            const searchable = Array.from(
              document.querySelectorAll("button, div, p, span, h1, h2, h3"),
            );
            const hasHeader = searchable.some((el) =>
              el.textContent?.includes(headerText),
            );
            const hasBtn = searchable.some(
              (el) =>
                el.textContent?.trim() === btnText ||
                el.classList.contains("vsIIDR"),
            );
            if (hasHeader || hasBtn) return "modal";

            return "none";
          })
          .catch(() => "none")) as any;

        if (phaseDetected !== "none") break;
        await delay(1000);
        checkElapsed += 1000;

        if (checkElapsed % 5000 === 0) {
          console.log(`[WARMUP] Still polling... State: "${currentTitle}"`);
        }
      }

      // Handle Modal if detected
      if (phaseDetected === "modal") {
        console.log("[WARMUP] Bahasa modal detected. Clicking...");
        const clicked = await page
          .evaluate(() => {
            const btn =
              (document.querySelector("button.vsIIDR") as HTMLElement) ||
              (Array.from(
                document.querySelectorAll("button, div, p, span"),
              ).find(
                (el) => el.textContent?.trim() === "Bahasa Indonesia",
              ) as HTMLElement);
            if (btn) {
              btn.click();
              return true;
            }
            return false;
          })
          .catch(() => false);
        if (clicked) {
          console.log("[WARMUP] Clicked Bahasa Indonesia. Waiting 2s...");
          await delay(2000);
        }
      }

      // ── Step 3b: Fill in credentials ──
      if (SHOPEE_PHONE && SHOPEE_PASSWORD) {
        console.log(
          `[WARMUP] Preparing to fill credentials for ${SHOPEE_PHONE}...`,
        );

        try {
          // Final check for the form
          await page.waitForSelector('input[name="loginKey"]', {
            timeout: 15000,
          });

          console.log("[WARMUP] Typing phone number...");
          await humanType(page, 'input[name="loginKey"]', SHOPEE_PHONE);
          await delay(300);

          console.log("[WARMUP] Tabbing to password...");
          await page.keyboard.press("Tab");
          await delay(300);

          console.log("[WARMUP] Typing password...");
          await humanType(page, 'input[name="password"]', SHOPEE_PASSWORD);
          await delay(800);

          console.log("[WARMUP] Submitting login (Enter)...");
          await page.keyboard.press("Enter");

          console.log(
            "[WARMUP] Login submitted. Waiting for redirect/verification...",
          );
          await delay(8000); // Wait for potential verification link page

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
            console.log(
              `[WARMUP] Security verification prompt detected at ${currentUrl}!`,
            );

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
                  console.log(
                    "[WARMUP] Checking for confirmation modal (OK button)...",
                  );

                  // Wait up to 10s for the modal context or the button itself
                  const okButtonClicked = await page.evaluate(async () => {
                    // Helper to find OK-ish buttons
                    const findOkBtn = () => {
                      const selectors = [
                        "button",
                        'div[role="button"]',
                        '[class*="button"]',
                      ];
                      for (const selector of selectors) {
                        const elements = Array.from(
                          document.querySelectorAll(selector),
                        );
                        const btn = elements.find((el) => {
                          const text = el.textContent?.trim().toUpperCase();
                          return (
                            text === "OK" ||
                            text === "OKE" ||
                            text === "SAYA MENGERTI" ||
                            text === "LANJUT"
                          );
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
                        if (checks++ > 20) {
                          // 5 seconds total
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
                    console.log(
                      "[WARMUP] OK button not detected or not clickable.",
                    );
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
        console.log(
          `[WARMUP] Warning: Could not save storageState: ${saveErr.message}`,
        );
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
      if (error.message === "AntibotBlock") {
        console.log(
          "[WARMUP] Session burned by antibot. Retrying immediately with a fresh session...",
        );
      } else {
        console.log(`[WARMUP] Error: ${error.message}`);
      }

      humanizeStopSignal.stopped = true;
      try {
        if (page) await page.close();
        if (browser) await browser.close();
      } catch {}

      await delay(3000); // Cooling off
      continue;
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
  return await warmupSession(true); // Always force fresh navigation on rotation
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Emulates a human typing by randomizing the delay between keystrokes
async function humanType(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
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
