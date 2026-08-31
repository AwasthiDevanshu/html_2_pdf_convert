import { IMAGE_PREFETCH_TIMEOUT_MS } from "./config.js";
import { logger } from "./logger.js";

// Pull every http(s) image URL out of the raw HTML (src="", srcset="", and CSS url(...))
export function extractImageUrls(html) {
  const urls = new Set();

  for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    if (/^https?:\/\//i.test(match[1])) urls.add(match[1]);
  }

  for (const match of html.matchAll(/<img\b[^>]*\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
    for (const entry of match[1].split(",")) {
      const url = entry.trim().split(/\s+/)[0];
      if (/^https?:\/\//i.test(url)) urls.add(url);
    }
  }

  for (const match of html.matchAll(/url\(([^)]+)\)/gi)) {
    const inner = match[1].trim().replace(/^["']|["']$/g, "");
    if (/^https?:\/\//i.test(inner)) urls.add(inner);
  }

  return [...urls];
}

// Fetch every image URL concurrently and cache the response bytes/content-type.
// Individually timed out and failure-tolerant: one slow/broken image never
// blocks the others, and always falls back to a live Chrome fetch (see
// server.js request interception) rather than failing the whole conversion.
export async function prefetchImages(urls, requestId) {
  const cache = new Map();

  await Promise.all(
    urls.map(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), IMAGE_PREFETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return;
        const buffer = Buffer.from(await response.arrayBuffer());
        cache.set(url, {
          buffer,
          contentType: response.headers.get("content-type") || "application/octet-stream"
        });
      } catch (err) {
        logger.warn("image_prefetch_failed", { requestId, url, error: err.message });
      } finally {
        clearTimeout(timer);
      }
    })
  );

  return cache;
}
