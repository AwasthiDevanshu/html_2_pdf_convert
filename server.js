import express from "express";
import puppeteer from 'puppeteer-core';

const app = express();
const API_KEY = "iebfu43bfu43bfu43bf43bfu43bf43bfu4"; 
// IMPORTANT: Use the exact path found in your environment
const EXECUTABLE_PATH = '/root/.cache/puppeteer/chrome/linux-142.0.7444.175/chrome-linux64/chrome'; 

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
  
  try {
    const html = req.body;

    if (!html) {
      // Return JSON even for errors for consistency
      return res.status(400).json({ status: "error", message: "HTML body required" }); 
    }

    // Launch Puppeteer with necessary arguments for server environment
    browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      headless: "new",
      // Crucial arguments for running Chrome in a Linux/root environment like aapanel
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] 
    });

    const page = await browser.newPage();

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
      timeout: 30000 // Set a timeout for loading content
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
  }
});

app.listen(9006, () =>
  console.log("PDF API is running → http://localhost:9006/convert")
);