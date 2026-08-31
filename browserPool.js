import puppeteer from "puppeteer-core";
import { BROWSER_POOL_SIZE, EXECUTABLE_PATH, MAX_JOBS_PER_BROWSER } from "./config.js";
import { logger } from "./logger.js";

const LAUNCH_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

// Warm pool of long-lived Chrome instances. Launching Chrome is the slowest
// part of a cold PDF conversion (~1-2s); keeping browsers alive and only
// opening/closing a *page* per request removes that cost from every request
// after startup.
class BrowserPool {
  constructor(size) {
    this.size = size;
    this.entries = []; // { browser, jobs, launching: Promise|null }
  }

  async init() {
    this.entries = await Promise.all(
      Array.from({ length: this.size }, () => this._launchEntry())
    );
    logger.info("browser_pool_ready", { size: this.size });
  }

  async _launchEntry() {
    const browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      headless: "new",
      args: LAUNCH_ARGS
    });
    const entry = { browser, jobs: 0 };
    browser.once("disconnected", () => {
      // Chrome crashed or was killed out from under us — replace it lazily,
      // on next acquire, rather than immediately (avoids a launch storm if
      // several browsers die together, e.g. during shutdown).
      entry.browser = null;
      logger.warn("browser_disconnected");
    });
    return entry;
  }

  // Picks the least-loaded live browser, relaunching any that died or aged out.
  async acquire() {
    let entry = this.entries.reduce((least, e) => (e.jobs < least.jobs ? e : least), this.entries[0]);

    if (!entry.browser) {
      const fresh = await this._launchEntry();
      Object.assign(entry, fresh);
      logger.info("browser_relaunched");
    } else if (entry.jobs >= MAX_JOBS_PER_BROWSER) {
      const old = entry.browser;
      const fresh = await this._launchEntry();
      Object.assign(entry, fresh);
      logger.info("browser_recycled", { reason: "max_jobs_reached" });
      old.close().catch((err) => logger.warn("old_browser_close_failed", { error: err.message }));
    }

    entry.jobs++;
    return { browser: entry.browser, release: () => entry.jobs-- };
  }

  async closeAll() {
    await Promise.all(
      this.entries.map((e) => (e.browser ? e.browser.close().catch(() => {}) : Promise.resolve()))
    );
  }
}

export const browserPool = new BrowserPool(BROWSER_POOL_SIZE);
