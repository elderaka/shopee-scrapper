import type { Browser, BrowserContext, Page } from 'playwright-core';

// Randomizer
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// Main logic
export async function Humanize(
  browser: Browser | BrowserContext,
  stopSignal: { stopped: boolean },
  sessionId: string
): Promise<void> {
  console.log(`[Humanization] Started humanization for session ${sessionId}`);
  
  const getCurrentPage = (): Page | null => {
    try {
      let pages: Page[] = [];
      if ('contexts' in browser) {
        const contexts = browser.contexts();
        if (contexts.length > 0) {
          pages = contexts[0]!.pages();
        }
      } else {
        pages = browser.pages();
      }
      return pages.length > 0 ? pages[pages.length - 1]! : null;
    } catch {
      return null;
    }
  };
  
  const mouseMover = async () => {
    while (!stopSignal.stopped) {
      try {
        const page = getCurrentPage();
        if (page && !page.isClosed()) {
          const viewport = page.viewportSize() || { width: 1280, height: 720 };
          
          // Randomly choose movement pattern
          const pattern = randomInt(1, 4);
          
          if (pattern === 1) {
            // Jittery movement
            for (let i = 0; i < randomInt(2, 5); i++) {
              const x = randomInt(50, viewport.width - 50);
              const y = randomInt(50, viewport.height - 50);
              await page.mouse.move(x, y, { steps: randomInt(1, 3) });
              await randomDelay(50, 150);
            }
          } else if (pattern === 2) {
            // Slow smooth movement
            const x = randomInt(100, viewport.width - 100);
            const y = randomInt(100, viewport.height - 100);
            await page.mouse.move(x, y, { steps: randomInt(20, 40) });
          } else if (pattern === 3) {
            // Curved movement
            const startX = randomInt(100, viewport.width - 100);
            const startY = randomInt(100, viewport.height - 100);
            const midX = randomInt(100, viewport.width - 100);
            const midY = randomInt(100, viewport.height - 100);
            const endX = randomInt(100, viewport.width - 100);
            const endY = randomInt(100, viewport.height - 100);
            
            await page.mouse.move(startX, startY, { steps: randomInt(5, 10) });
            await randomDelay(100, 300);
            await page.mouse.move(midX, midY, { steps: randomInt(8, 15) });
            await randomDelay(100, 300);
            await page.mouse.move(endX, endY, { steps: randomInt(5, 12) });
          } else {
            // Medium speed normal movement
            const x = randomInt(100, viewport.width - 100);
            const y = randomInt(100, viewport.height - 100);
            await page.mouse.move(x, y, { steps: randomInt(8, 18) });
          }
        }
      } catch {
      }
      await randomDelay(1000, 6000); 
    }
  };
  
  // Random scrolling
  const scroller = async () => {
    while (!stopSignal.stopped) {
      try {
        const page = getCurrentPage();
        if (page && !page.isClosed()) {
          const scrollType = randomInt(1, 4);
          
          if (scrollType === 1) {
            // Reading scroll
            for (let i = 0; i < randomInt(2, 5); i++) {
              const scrollAmount = randomInt(50, 150);
              await page.mouse.wheel(0, scrollAmount);
              await randomDelay(200, 800);
            }
          } else if (scrollType === 2) {
            // Skimming scroll
            const scrollAmount = randomInt(500, 1200);
            await page.mouse.wheel(0, scrollAmount);
          } else if (scrollType === 3) {
            // going back up
            const scrollAmount = randomInt(-800, -200);
            await page.mouse.wheel(0, scrollAmount);
          } else {
            // Frantic random scroll
            const scrollAmount = randomInt(-400, 600);
            await page.mouse.wheel(0, scrollAmount);
          }
        }
      } catch {
      }
      await randomDelay(2000, 8000); 
    }
  };
  
  // click-hold-drag
  const dragger = async () => {
    while (!stopSignal.stopped) {
      try {
        const page = getCurrentPage();
        if (page && !page.isClosed()) {
          const viewport = page.viewportSize() || { width: 1280, height: 720 };
          const dragType = randomInt(1, 3);
          
          if (dragType === 1) {
            // Short drag
            const startX = randomInt(200, viewport.width - 200);
            const startY = randomInt(200, viewport.height - 200);
            const endX = startX + randomInt(-100, 100);
            const endY = startY + randomInt(-80, 80);
            
            await page.mouse.move(startX, startY, { steps: randomInt(2, 5) });
            await page.mouse.down();
            await randomDelay(50, 150);
            await page.mouse.move(endX, endY, { steps: randomInt(3, 8) });
            await page.mouse.up();
          } else if (dragType === 2) {
            // Long drag
            const startX = randomInt(200, viewport.width - 300);
            const startY = randomInt(200, viewport.height - 300);
            const endX = startX + randomInt(-400, 400);
            const endY = startY + randomInt(-300, 300);
            
            await page.mouse.move(startX, startY, { steps: randomInt(8, 15) });
            await page.mouse.down();
            await randomDelay(300, 700);
            await page.mouse.move(endX, endY, { steps: randomInt(20, 35) });
            await randomDelay(200, 400);
            await page.mouse.up();
          } else {
            // Erratic drag
            const startX = randomInt(200, viewport.width - 300);
            const startY = randomInt(200, viewport.height - 300);
            
            await page.mouse.move(startX, startY, { steps: randomInt(5, 10) });
            await page.mouse.down();
            await randomDelay(100, 300);
            
            for (let i = 0; i < randomInt(2, 4); i++) {
              const moveX = startX + randomInt(-250, 250);
              const moveY = startY + randomInt(-200, 200);
              await page.mouse.move(moveX, moveY, { steps: randomInt(5, 15) });
              await randomDelay(100, 400);
            }
            
            await page.mouse.up();
          }
        }
      } catch {
      }
      await randomDelay(6000, 18000); 
    }
  };
  
  // Running all humanizer concurrently
  await Promise.allSettled([
    mouseMover(),
    scroller(),
    dragger()
  ]);
  
  console.log(`[Humanization] Stopped humanization for session ${sessionId}`);
}
