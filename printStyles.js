export const DEFAULT_PRINT_CSS = `
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
