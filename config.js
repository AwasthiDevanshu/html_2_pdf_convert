// Central place for tunables. No env vars by design — edit and redeploy.

export const PORT = 9006;

export const API_KEY = "iebfu43bfu43bfu43bf43bfu43bf43bfu4";

// IMPORTANT: Use the exact path found in your environment
export const EXECUTABLE_PATH = "/root/.cache/puppeteer/chrome/linux-142.0.7444.175/chrome-linux64/chrome";

// How many /convert requests may run at once. Extra requests queue in FIFO
// order rather than piling up unbounded work on the browser pool.
export const MAX_CONCURRENT_CONVERSIONS = 10;

// Warm browser pool: instances are launched once at startup and reused
// across requests (a fresh *page* is opened/closed per request, not a fresh
// *browser*), removing Chrome's ~1-2s cold-start cost from the request path.
export const BROWSER_POOL_SIZE = 4;

// A browser is recycled after this many conversions, to bound the effect of
// any slow memory growth within a single long-lived Chrome process.
export const MAX_JOBS_PER_BROWSER = 200;

export const NAVIGATION_TIMEOUT_MS = 60_000;
export const IMAGE_LOAD_TIMEOUT_MS = 20_000;
export const IMAGE_PREFETCH_TIMEOUT_MS = 15_000;

// Upper bound on how long a request may wait in the concurrency queue before
// it's rejected with 503 instead of hanging indefinitely under sustained load.
export const QUEUE_WAIT_TIMEOUT_MS = 45_000;

export const MAX_BODY_SIZE = "50mb";
