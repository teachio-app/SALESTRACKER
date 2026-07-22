import { ParsedSale } from "./parsers";
import type { ViagogoPayment } from "./parsers/viagogoPayment";

// A ping only fires if the message CONTENT holds `<@id>` (embeds never ping),
// and Discord needs the numeric user ID — a username can't be mentioned. Set
// DISCORD_MENTION_USER_ID to your ID and every alert tags you.
function mention(): { content?: string; allowed_mentions?: object } {
  const id = process.env.DISCORD_MENTION_USER_ID;
  return id ? { content: `<@${id}>`, allowed_mentions: { parse: [], users: [id] } } : {};
}

async function post(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // A Discord hiccup must never break the poll.
    console.error("Discord notify failed:", err);
  }
}

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

  await post(url, { ...mention(), embeds: [embed] });
}

// Payout notification — a separate webhook (DISCORD_PAYMENT_WEBHOOK_URL) so
// "money landed" pings can go to their own channel, apart from sale alerts.
export async function notifyPayment(payment: ViagogoPayment, markedPaid = 0): Promise<void> {
  const url = process.env.DISCORD_PAYMENT_WEBHOOK_URL;
  if (!url) return;

  const lines = payment.items.map(
    (it) => `• ${it.eventName ?? "—"} — €${it.amount.toFixed(2)}${it.qty ? ` (${it.qty})` : ""}`
  );

  const embed = {
    title: `💸 Paid out — €${payment.total.toFixed(2)}`,
    color: 0x3987e5,
    description: lines.join("\n") || undefined,
    fields: [
      { name: "Reference", value: payment.reference, inline: true },
      ...(payment.paidOn ? [{ name: "Processed", value: payment.paidOn, inline: true }] : []),
      { name: "Orders", value: String(payment.items.length), inline: true },
      ...(markedPaid > 0
        ? [{ name: "Auto-marked paid", value: `${markedPaid} sale${markedPaid === 1 ? "" : "s"} ✓`, inline: true }]
        : []),
    ],
    footer: { text: "viagogo · may take up to 8 business days to hit the bank" },
    timestamp: new Date().toISOString(),
  };

  await post(url, { ...mention(), embeds: [embed] });
}
