import { MAX_CONCURRENT_CONVERSIONS, QUEUE_WAIT_TIMEOUT_MS } from "./config.js";

// FIFO semaphore capping concurrent PDF conversions so we don't overload the
// browser pool. Requests beyond the cap wait their turn, up to a max wait
// before being rejected (503) rather than hanging indefinitely.
let active = 0;
const waiters = [];

export function queueDepth() {
  return waiters.length;
}

export function activeCount() {
  return active;
}

export function acquireSlot() {
  if (active < MAX_CONCURRENT_CONVERSIONS) {
    active++;
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const waiter = { resolve, timedOut: false };
    const timer = setTimeout(() => {
      waiter.timedOut = true;
      const idx = waiters.indexOf(waiter);
      if (idx !== -1) waiters.splice(idx, 1);
      reject(new Error("Timed out waiting for an available conversion slot"));
    }, QUEUE_WAIT_TIMEOUT_MS);
    waiter.resolve = () => {
      clearTimeout(timer);
      resolve();
    };
    waiters.push(waiter);
  });
}

export function releaseSlot() {
  const next = waiters.shift();
  if (next) {
    next.resolve(); // hand the slot straight to the next waiter
  } else {
    active--;
  }
}
