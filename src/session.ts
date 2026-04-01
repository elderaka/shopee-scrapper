import type { Browser, BrowserContext, Page } from 'playwright-core';

let activeBrowser: Browser | BrowserContext | null = null;
let activeSessionId: string | null = null;
let activeHumanizeStopSignal: { stopped: boolean } | null = null;
let activeHumanizeTask: Promise<void> | null = null;
let activePage: Page | null = null;

export function getActiveSession() {
  return {
    browser: activeBrowser,
    sessionId: activeSessionId,
    humanizeStopSignal: activeHumanizeStopSignal,
    humanizeTask: activeHumanizeTask,
    page: activePage
  };
}

export function setActiveSession(
  browser: Browser | BrowserContext | null,
  sessionId: string | null,
  humanizeStopSignal?: { stopped: boolean } | null,
  humanizeTask?: Promise<void> | null,
  page?: Page | null
) {
  activeBrowser = browser;
  activeSessionId = sessionId;
  if (humanizeStopSignal !== undefined) activeHumanizeStopSignal = humanizeStopSignal;
  if (humanizeTask !== undefined) activeHumanizeTask = humanizeTask;
  if (page !== undefined) activePage = page;
}

export async function closeActiveSession() {
  if (activeHumanizeStopSignal) {
    activeHumanizeStopSignal.stopped = true;
  }
  if (activePage && !activePage.isClosed()) {
    try { await activePage.close(); } catch {}
  }
  if (activeBrowser) {
    try { await activeBrowser.close(); } catch {}
  }
  activeBrowser = null;
  activeSessionId = null;
  activeHumanizeStopSignal = null;
  activeHumanizeTask = null;
  activePage = null;
}
