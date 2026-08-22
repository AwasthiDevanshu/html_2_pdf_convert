import express from "express";
import puppeteer from 'puppeteer-core';

const app = express();
const API_KEY = "iebfu43bfu43bfu43bf43bfu43bf43bfu4";
// IMPORTANT: Use the exact path found in your environment
const EXECUTABLE_PATH = '/root/.cache/puppeteer/chrome/linux-142.0.7444.175/chrome-linux64/chrome';

// Pull every http(s) image URL out of the raw HTML (src="", srcset="", and CSS url(...))
function extractImageUrls(html) {
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

// Simple FIFO semaphore: caps concurrent PDF conversions so we don't spawn
// unbounded Chrome processes under load. Excess requests wait their turn.
const MAX_CONCURRENT_CONVERSIONS = 10;
let activeConversions = 0;
const conversionQueue = [];

function acquireConversionSlot() {
  if (activeConversions < MAX_CONCURRENT_CONVERSIONS) {
    activeConversions++;
    return Promise.resolve();
  }
  return new Promise((resolve) => conversionQueue.push(resolve));
}

function releaseConversionSlot() {
  const next = conversionQueue.shift();
  if (next) {
    next(); // hand the slot straight to the next waiter
  } else {
    activeConversions--;
  }
}

// Fetch every image URL concurrently and cache the response bytes/content-type.
async function prefetchImages(urls) {
  const cache = new Map();

  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const buffer = Buffer.from(await response.arrayBuffer());
        cache.set(url, {
          buffer,
          contentType: response.headers.get("content-type") || "application/octet-stream"
        });
      } catch (err) {
        console.warn(`Image prefetch failed for ${url}:`, err.message);
      }
    })
  );

  return cache;
}

// Use express.text to parse the incoming HTML body as a string
app.use(express.text({ type: "text/html", limit: '50mb' })); 

// API Key Authentication Middleware
app.use((req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key !== API_KEY) {
    // Note: Use .json() for JSON responses
    return res.status(401).json({ error: "Unauthorized" }); 
  }
  next();
});

// PDF Conversion Endpoint
app.post("/convert", async (req, res) => {
  let browser; // Declare browser outside try to ensure it's closed in finally

  await acquireConversionSlot();
  try {
    const html = req.body;

    if (!html) {
      // Return JSON even for errors for consistency
      return res.status(400).json({ status: "error", message: "HTML body required" });
    }

    // Kick off image prefetching in parallel with browser launch — both are
    // pure latency (network/process startup) with no dependency on each other.
    const imageUrls = extractImageUrls(html);
    const prefetchPromise = imageUrls.length ? prefetchImages(imageUrls) : Promise.resolve(new Map());

    // Launch Puppeteer with necessary arguments for server environment
    browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      headless: "new",
      // Crucial arguments for running Chrome in a Linux/root environment like aapanel
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();

    const imageCache = await prefetchPromise;

    // Serve prefetched images straight from memory instead of letting Chrome
    // re-fetch each one over the network (avoids per-origin connection limits
    // and repeated DNS/TLS overhead).
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
          console.warn(`Request interception error for ${request.url()}:`, err.message);
        }
      });
    }

    // Default CSS for print styling and page breaks
    const defaultPrintCSS = `
      <style>
        @media print {
          body {
            /* Example: Set margins for the whole document */
            margin: 25mm;
            font-family: Arial, sans-serif;
            -webkit-print-color-adjust: exact;
          }
          .no-print { display: none !important; }
          /* Ensure headers stay with the text below them */
          h1, h2, h3 {
            page-break-after: avoid;
          }
          /* Force a page break before elements with this class */
          .page-break {
            page-break-before: always;
          }
        }
      </style>
    `;

    // Load the HTML content with print CSS injected
    await page.setContent(`${defaultPrintCSS}${html}`, {
      waitUntil: "networkidle0",
      timeout: 60000 // Set a timeout for loading content
    });

    // Explicitly wait for every <img> to finish loading (or fail) before printing.
    // networkidle0 can resolve before slow/late images finish decoding.
    await page.evaluate(async () => {
      const IMAGE_TIMEOUT_MS = 20000;
      const images = Array.from(document.querySelectorAll("img"));
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            setTimeout(done, IMAGE_TIMEOUT_MS);
          });
        })
      );
    });

    // Generate the PDF buffer
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true, // Includes background colors/images
      margin: {
          top: "0",
          right: "0",
          bottom: "0",
          left: "0"
      }
      // Add other PDF options here if needed, like header/footerTemplate
    });

    // --- BASE64 JSON RESPONSE BLOCK ---
    
    // 1. Convert the raw PDF Buffer to a Base64 string
    const base64Pdf = Buffer.from(pdfBuffer).toString("base64");

    // 2. Send the Base64 data within a JSON object
    res.status(200).json({
      status: 'success',
      message: 'PDF generated successfully and returned as Base64.',
      data: {
        // This is the Base64 encoded PDF string
        pdf_base64: base64Pdf,
        filename: 'document.pdf',
        mime_type: 'application/pdf'
      }
    });

  } catch (err) {
    console.error("PDF Generation Error:", err);
    // Return a structured JSON error response
    res.status(500).json({ 
      status: "error",
      message: "PDF generation failed. Check server logs for details.",
      details: err.message
    });
  } finally {
    // Ensure the browser instance is closed, even if an error occurred
    if (browser) {
      await browser.close();
    }
    releaseConversionSlot();
  }
});

app.listen(9006, () =>
  console.log("PDF API is running → http://localhost:9006/convert")
);