import { ParsedSale } from "./parsers";

// Fire-and-forget Discord notification. Discord is notification-only here —
// it never feeds data back into the app.
export async function notifyDiscord(sale: ParsedSale): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  // Seat identity lives in three fields now; join them for display only.
  const seat = [
    sale.section && `Section ${sale.section}`,
    sale.seatRow && `Row ${sale.seatRow}`,
    sale.seats && `Seats ${sale.seats}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const embed = {
    title: `💰 Sold — ${sale.eventName}`,
    color: 0x0ca30c,
    fields: [
      { name: "Payout", value: `${sale.sellPrice.toFixed(2)} ${sale.currency}`, inline: true },
      { name: "Qty", value: String(sale.qty), inline: true },
      { name: "Source", value: sale.source, inline: true },
      ...(seat ? [{ name: "Seat", value: seat, inline: false }] : []),
      ...(sale.location ? [{ name: "Location", value: sale.location, inline: false }] : []),
      ...(sale.orderRef ? [{ name: "Order", value: sale.orderRef, inline: true }] : []),
    ],
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    // Don't let a Discord hiccup break the poll.
    console.error("Discord notify failed:", err);
  }
}
