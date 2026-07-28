// Client-side export of the ticket list to CSV and PDF.
//
// Both run entirely in the browser — no server round-trip, no data leaving the
// page beyond the file the user saves. CSV is hand-rolled (zero deps). PDF pulls
// jspdf + jspdf-autotable, but only via dynamic import inside exportPdf(), so
// those ~350 KB never touch the initial bundle — they load the first time you
// actually click "Export PDF".

import {
  type Ticket,
  realizedProfit,
  realizedRoi,
  pricePerTicket,
} from "@/lib/supabase";

const STATUS: Record<Ticket["status"], string> = {
  sold: "Sold",
  listed: "Listed",
  not_listed: "Not listed",
};

const money = (n: number) => n.toFixed(2);

// A sold row only has a meaningful profit/ROI once its buy price is typed in;
// leave the cell blank otherwise rather than print a fake 0 or −buy.
const priced = (t: Ticket) => t.qty_sold > 0 && t.buy_price > 0;
const profitStr = (t: Ticket) => (priced(t) ? money(realizedProfit(t)) : "");
const roiStr = (t: Ticket) => (priced(t) ? `${realizedRoi(t).toFixed(1)}%` : "");
const paidStr = (t: Ticket) => (t.qty_sold > 0 ? (t.paid_out ? "Yes" : "No") : "");

function seatLine(t: Ticket): string {
  return [t.section && `Sec ${t.section}`, t.seat_row && `Row ${t.seat_row}`, t.seats && `S ${t.seats}`]
    .filter(Boolean)
    .join(" · ");
}

type Col = { header: string; value: (t: Ticket) => string; num?: boolean };

// CSV gets every field, one column each — it's the spreadsheet/backup format.
const CSV_COLUMNS: Col[] = [
  { header: "Event", value: (t) => t.event_name ?? "" },
  { header: "Event date", value: (t) => t.event_date ?? "" },
  { header: "Location", value: (t) => t.location ?? "" },
  { header: "Section", value: (t) => t.section ?? "" },
  { header: "Row", value: (t) => t.seat_row ?? "" },
  { header: "Seats", value: (t) => t.seats ?? "" },
  { header: "Qty total", value: (t) => String(t.qty_total), num: true },
  { header: "Qty sold", value: (t) => String(t.qty_sold), num: true },
  { header: "Status", value: (t) => STATUS[t.status] },
  { header: "Buy total", value: (t) => money(t.buy_price), num: true },
  { header: "Buy per ticket", value: (t) => money(pricePerTicket(t)), num: true },
  { header: "Sell total", value: (t) => money(t.sell_price), num: true },
  { header: "Profit", value: profitStr, num: true },
  { header: "ROI", value: roiStr, num: true },
  { header: "Paid", value: paidStr },
  { header: "Order #", value: (t) => t.order_ref ?? "" },
  { header: "Source", value: (t) => t.source ?? "" },
  { header: "Sold at", value: (t) => t.sold_at?.slice(0, 10) ?? "" },
  { header: "Problem", value: (t) => (t.flagged ? "Yes" : "") },
  { header: "Problem note", value: (t) => t.flag_note ?? "" },
  { header: "Comment", value: (t) => t.comment ?? "" },
];

// PDF gets a compact subset that fits a landscape A4 and stays readable —
// section/row/seats collapse into one "Seat" column.
const PDF_COLUMNS: Col[] = [
  { header: "Event", value: (t) => t.event_name ?? "" },
  { header: "Date", value: (t) => t.event_date ?? "" },
  { header: "Location", value: (t) => t.location ?? "" },
  { header: "Seat", value: seatLine },
  { header: "Sold", value: (t) => `${t.qty_sold}/${t.qty_total}`, num: true },
  { header: "Status", value: (t) => STATUS[t.status] },
  { header: "Buy", value: (t) => (t.buy_price ? money(t.buy_price) : ""), num: true },
  { header: "Sell", value: (t) => (t.sell_price ? money(t.sell_price) : ""), num: true },
  { header: "Profit", value: profitStr, num: true },
  { header: "ROI", value: roiStr, num: true },
  { header: "Paid", value: paidStr },
];

// ── CSV ───────────────────────────────────────────────────────────────
// RFC-4180-ish: quote a field only when it contains a comma, quote, or newline,
// and double any embedded quotes. CRLF line endings so Excel is happy.
function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Ticket[]): string {
  const head = CSV_COLUMNS.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((t) => CSV_COLUMNS.map((c) => csvCell(c.value(t))).join(","));
  return [head, ...body].join("\r\n");
}

// Trigger a browser download of an in-memory file.
export function download(filename: string, content: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportCsv(rows: Ticket[], filename: string): void {
  // Prepend a UTF-8 BOM so Excel renders diacritics (č, á, í) instead of mojibake.
  download(filename, "﻿" + toCsv(rows), "text/csv;charset=utf-8");
}

// ── PDF ───────────────────────────────────────────────────────────────
// Realized profit across the rows that actually have a buy price, for the
// header summary line. Unpriced sold rows are left out (their profit is unknown).
function summarize(rows: Ticket[]) {
  const sold = rows.filter((t) => t.qty_sold > 0);
  const p = sold.filter((t) => t.buy_price > 0);
  const profit = p.reduce((s, t) => s + realizedProfit(t), 0);
  const awaiting = sold.filter((t) => !t.paid_out).reduce((s, t) => s + t.sell_price, 0);
  return { count: rows.length, soldCount: sold.length, profit, awaiting };
}

export async function exportPdf(
  rows: Ticket[],
  meta: { filename: string; scope: string; stamp: string }
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const s = summarize(rows);

  // Right-align the numeric columns. Built as a variable (not inline) so the
  // "right"/"left" literals keep their type instead of widening to string.
  const columnStyles: Record<number, { halign: "left" | "right" }> = {};
  PDF_COLUMNS.forEach((c, i) => {
    columnStyles[i] = { halign: c.num ? "right" : "left" };
  });

  // Header block.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(20);
  doc.text("DeskTracker — inventory export", 24, 34);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`${meta.scope}  ·  generated ${meta.stamp}`, 24, 50);

  // Summary line, right-aligned.
  const summary = `${s.count} rows · ${s.soldCount} sold · profit ${money(s.profit)} EUR · awaiting ${money(s.awaiting)} EUR`;
  doc.text(summary, pageW - 24, 50, { align: "right" });

  autoTable(doc, {
    startY: 64,
    head: [PDF_COLUMNS.map((c) => c.header)],
    body: rows.map((t) => PDF_COLUMNS.map((c) => c.value(t))),
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [42, 120, 214], textColor: 255, fontStyle: "bold", halign: "left" },
    alternateRowStyles: { fillColor: [244, 246, 249] },
    columnStyles,
    margin: { left: 24, right: 24 },
    // Page number in the footer of every page.
    didDrawPage: (data: { pageNumber: number }) => {
      const h = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Page ${data.pageNumber}`, pageW - 24, h - 14, { align: "right" });
    },
  });

  doc.save(meta.filename);
}
