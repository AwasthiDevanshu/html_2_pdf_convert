import express from "express";
import { PORT, API_KEY, MAX_BODY_SIZE } from "./config.js";
import { logger, nextRequestId } from "./logger.js";
import { browserPool } from "./browserPool.js";
import { acquireSlot, releaseSlot, activeCount, queueDepth } from "./queue.js";
import { convertHtmlToPdf } from "./convert.js";

const app = express();

app.use(express.text({ type: "text/html", limit: MAX_BODY_SIZE }));

// Assign a request ID up front so every log line for a request can be
// correlated, including auth failures.
app.use((req, res, next) => {
  req.id = nextRequestId();
  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    activeConversions: activeCount(),
    queueDepth: queueDepth()
  });
});

// API Key Authentication Middleware
app.use((req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key !== API_KEY) {
    logger.warn("unauthorized_request", { requestId: req.id, path: req.path });
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

app.post("/convert", async (req, res) => {
  const requestId = req.id;
  const startedAt = Date.now();

  const html = req.body;
  if (!html) {
    return res.status(400).json({ status: "error", message: "HTML body required" });
  }

  try {
    await acquireSlot();
  } catch (err) {
    logger.warn("queue_timeout", { requestId });
    return res.status(503).json({
      status: "error",
      message: "Server is busy. Please retry shortly.",
      details: err.message
    });
  }

  try {
    const pdfBuffer = await convertHtmlToPdf(html, requestId);
    const base64Pdf = Buffer.from(pdfBuffer).toString("base64");

    logger.info("conversion_succeeded", { requestId, durationMs: Date.now() - startedAt });

    res.status(200).json({
      status: "success",
      message: "PDF generated successfully and returned as Base64.",
      data: {
        pdf_base64: base64Pdf,
        filename: "document.pdf",
        mime_type: "application/pdf"
      }
    });
  } catch (err) {
    logger.error("conversion_failed", { requestId, durationMs: Date.now() - startedAt, error: err.message });
    res.status(500).json({
      status: "error",
      message: "PDF generation failed. Check server logs for details.",
      details: err.message
    });
  } finally {
    releaseSlot();
  }
});

let server;

async function start() {
  await browserPool.init();
  server = app.listen(PORT, () => {
    logger.info("server_started", { port: PORT });
  });
}

async function shutdown(signal) {
  logger.info("shutdown_initiated", { signal });
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await browserPool.closeAll();
  logger.info("shutdown_complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  logger.error("startup_failed", { error: err.message });
  process.exit(1);
});
