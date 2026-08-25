/**
 * POST /api/create-order
 * Simpan pesanan baru ke DB + kirim notif WA ke admin via Fonnte.
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { customerName, customerWA, customerAddr, items, total, paymentMethod } = req.body || {};

  if (!customerName || !customerWA || !customerAddr)
    return res.status(400).json({ error: "Data pelanggan tidak lengkap." });
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "Pesanan kosong." });
  if (!total || isNaN(Number(total)))
    return res.status(400).json({ error: "Total tidak valid." });

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Simpan order ke DB
    const result = await sql`
      INSERT INTO orders (customer_name, customer_wa, customer_addr, items, total, payment_method, status)
      VALUES (
        ${customerName},
        ${customerWA},
        ${customerAddr},
        ${JSON.stringify(items)},
        ${Number(total)},
        ${paymentMethod || ""},
        'pending'
      )
      RETURNING id
    `;
    const orderId = result[0].id;

    // Kirim notif WA ke admin via Fonnte (kalau FONNTE_TOKEN ada)
    const fonnteToken = process.env.FONNTE_TOKEN;
    // ADMIN_WA bisa satu nomor atau beberapa dipisah koma, contoh: "6281234,6285678"
    const adminWARaw  = process.env.ADMIN_WA || "";
    if (fonnteToken && adminWARaw) {
      const itemLines = items.map(i => `• ${i.qty}× ${i.name} = Rp ${i.subtotal.toLocaleString("id-ID")}`).join("\n");
      const msg =
        `🛒 *PESANAN BARU #${orderId}*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `👤 *Nama:* ${customerName}\n` +
        `📱 *WA:* ${customerWA}\n` +
        `📍 *Alamat:* ${customerAddr}\n` +
        `💳 *Bayar via:* ${paymentMethod}\n\n` +
        `📦 *Item Pesanan:*\n${itemLines}\n\n` +
        `💰 *Total: Rp ${Number(total).toLocaleString("id-ID")}*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Buka admin: https://enuyrasa.my.id/admin.html`;

      // Kirim ke semua nomor (bisa lebih dari 1, dipisah koma)
      const targets = adminWARaw.split(",").map(n => n.trim()).filter(Boolean);
      await Promise.all(targets.map(target =>
        fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: {
            "Authorization": fonnteToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ target, message: msg })
        }).catch(() => {})
      ));
    }

    return res.status(200).json({ success: true, orderId });
  } catch (err) {
    return res.status(500).json({ error: "Gagal menyimpan pesanan: " + err.message });
  }
}
