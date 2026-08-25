/**
 * POST /api/digital-order
 * Simpan order pulsa/data ke DB sebagai "pending_payment"
 * Kirim notif WA ke admin untuk konfirmasi pembayaran
 *
 * Body: { customerName, customerWA, targetNumber, sku, price, notes, operator, type }
 */

import { neon } from "@neondatabase/serverless";

async function notifWA(token, target, msg) {
  if (!token || !target) return;
  await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { "Authorization": token, "Content-Type": "application/json" },
    body: JSON.stringify({ target, message: msg })
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { customerName, customerWA, targetNumber, sku, price, notes, operator, type } = req.body || {};

  if (!customerName || !customerWA) return res.status(400).json({ error: "Nama dan WA wajib diisi." });
  if (!targetNumber || !sku)        return res.status(400).json({ error: "Nomor tujuan dan produk wajib diisi." });
  if (!price)                       return res.status(400).json({ error: "Harga tidak valid." });

  const refId = "PLS-" + Date.now();

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Simpan ke DB sebagai pending_payment
    const inserted = await sql`
      INSERT INTO digital_orders
        (ref_id, customer_name, customer_wa, target_number, sku, price,
         notes, status, provider, created_at)
      VALUES (
        ${refId},
        ${customerName},
        ${customerWA},
        ${targetNumber},
        ${sku},
        ${Number(price)},
        ${notes || ""},
        'pending_payment',
        'digiflazz',
        NOW()
      )
      RETURNING id
    `;
    const orderId = inserted[0]?.id;

    // Harga dalam format Rupiah
    const hargaFmt = "Rp " + Number(price).toLocaleString("id-ID");

    // Notif WA ke admin
    const adminWA = process.env.ADMIN_WA || "";
    const fonnteToken = process.env.FONNTE_TOKEN || "";
    if (adminWA && fonnteToken) {
      const msgAdmin =
        `🔔 *ORDER PULSA BARU #${orderId}*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `👤 *Nama:* ${customerName}\n` +
        `📱 *WA:* ${customerWA}\n` +
        `📲 *Nomor Tujuan:* ${targetNumber}\n` +
        `📦 *Produk:* ${operator || ""} ${type || ""} ${sku}\n` +
        `💰 *Harga:* ${hargaFmt}\n` +
        `🔖 *Ref:* ${refId}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `⏳ Menunggu pembayaran dari pelanggan.\n` +
        `Konfirmasi di: https://enuyrasa.my.id/admin.html`;

      await notifWA(fonnteToken, adminWA, msgAdmin);
    }

    // Notif WA ke pelanggan — info cara bayar
    if (fonnteToken && customerWA) {
      const msgPelanggan =
        `✅ *Order Pulsa Diterima!*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Halo *${customerName}*, pesanan kamu sudah masuk!\n\n` +
        `📦 *Produk:* ${operator || ""} ${sku}\n` +
        `📲 *Nomor Tujuan:* ${targetNumber}\n` +
        `💰 *Total Bayar:* ${hargaFmt}\n` +
        `🔖 *Ref:* ${refId}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `*Cara Pembayaran:*\n` +
        `Transfer ke salah satu:\n` +
        `🏦 BRI: *000501218837506* a.n. Muhammad Supian\n` +
        `💚 Dana: *081313172199* a.n. Muhammad Supian\n\n` +
        `Setelah transfer, kirim bukti bayar ke WA ini.\n` +
        `Pulsa akan dikirim setelah pembayaran dikonfirmasi. ⚡`;

      await notifWA(fonnteToken, customerWA, msgPelanggan);
    }

    return res.status(200).json({
      success: true,
      orderId,
      refId,
      price: Number(price),
      message: "Order berhasil dibuat. Silakan lakukan pembayaran."
    });

  } catch (err) {
    console.error("digital-order error:", err);
    return res.status(500).json({ error: "Gagal menyimpan order: " + err.message });
  }
}
