import { browserPool } from "./browserPool.js";
import { extractImageUrls, prefetchImages } from "./images.js";
import { DEFAULT_PRINT_CSS } from "./printStyles.js";
import { NAVIGATION_TIMEOUT_MS, IMAGE_LOAD_TIMEOUT_MS } from "./config.js";
import { logger } from "./logger.js";

// Renders HTML to a PDF buffer using a page from the warm browser pool.
export async function convertHtmlToPdf(html, requestId) {
  const imageUrls = extractImageUrls(html);
  // Prefetching runs while we acquire a page — both are pure latency with
  // no dependency on each other.
  const prefetchPromise = imageUrls.length
    ? prefetchImages(imageUrls, requestId)
    : Promise.resolve(new Map());

  const { browser, release } = await browserPool.acquire();
  let page;

  try {
    page = await browser.newPage();
    const imageCache = await prefetchPromise;

    // Serve prefetched images straight from memory instead of letting Chrome
    // re-fetch each one over the network (avoids per-origin connection
    // limits and repeated DNS/TLS overhead).
    if (imageCache.size) {
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        // request.respond()/continue() throw if the request was already
        // handled (e.g. Chrome cancelled it) — swallow to avoid crashing.
        try {
          const cached = imageCache.get(request.url());
          if (cached) {
            request.respond({ status: 200, contentType: cached.contentType, body: cached.buffer });
          } else {
            request.continue();
          }
        } catch (err) {
          logger.warn("request_interception_error", { requestId, url: request.url(), error: err.message });
        }
      });
    }

    // domcontentloaded fires once the DOM is parsed, without waiting for the
    // network to go fully idle — networkidle0 was fragile for large
    // documents (any lingering connection, e.g. a font or tracking pixel,
    // resets its 500ms idle timer and can stall the whole navigation).
    // Images are guaranteed separately by the explicit wait below.
    await page.setContent(`${DEFAULT_PRINT_CSS}${html}`, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS
    });

    // Explicitly wait for every <img> to finish loading (or fail) before
    // printing — networkidle0/domcontentloaded can both resolve before a
    // slow/late image finishes decoding.
    await page.evaluate(async (timeoutMs) => {
      const images = Array.from(document.querySelectorAll("img"));
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            setTimeout(done, timeoutMs);
          });
        })
      );
    }, IMAGE_LOAD_TIMEOUT_MS);

    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" }
    });
  } finally {
    if (page) {
      await page.close().catch((err) => logger.warn("page_close_failed", { requestId, error: err.message }));
    }
    release();
  }
}
