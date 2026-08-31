// Minimal structured (JSON) logger. No dependency needed for this scale —
// one line per event, machine-parseable by any log aggregator.

function log(level, msg, fields = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    msg,
    ...fields
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (msg, fields) => log("info", msg, fields),
  warn: (msg, fields) => log("warn", msg, fields),
  error: (msg, fields) => log("error", msg, fields)
};

let counter = 0;
export function nextRequestId() {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${counter}`;
}
