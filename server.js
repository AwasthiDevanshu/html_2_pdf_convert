import express from "express";
import puppeteer from "puppeteer";

const app = express();
const API_KEY = "iebfu43bfu43bfu43bf43bfu43bf43bfu4"; // Replace with your actual API key
app.use(express.text({ type: "text/html" }));
app.use((req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});


app.post("/convert", async (req, res) => {
  try {
    const html = req.body;

    if (!html) {
      return res.status(400).send("HTML body required");
    }

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    const defaultPrintCSS = `
      <style>
        @media print {
          body {
            margin: 25mm;
            font-family: Arial, sans-serif;
            -webkit-print-color-adjust: exact;
          }
          .no-print { display: none !important; }
          h1, h2, h3 {
            page-break-after: avoid;
          }
          .page-break {
            page-break-before: always;
          }
        }
      </style>
    `;

    await page.setContent(`${defaultPrintCSS}${html}`, {
      waitUntil: "networkidle0",
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true
    });

    await browser.close();

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=document.pdf",
      "Content-Length": pdfBuffer.length
    });

    res.send(pdfBuffer);

  } catch (err) {
    console.error(err);
    res.status(500).send("PDF generation failed");
  }
});

app.listen(3000, () =>
  console.log("PDF API is running → http://localhost:3000/convert")
);
