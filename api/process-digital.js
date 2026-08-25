/**
 * POST /api/process-digital
 * Admin konfirmasi pembayaran → kirim pulsa ke Digiflazz via Worker
 * Header: x-admin-token
 *
 * Body: { orderId }
 */

import crypto from "crypto";
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

  // Auth
  const token = (req.headers["x-admin-token"] || "").trim();
  if (!token || token !== (process.env.ADMIN_TOKEN || "").trim())
    return res.status(401).json({ error: "Token tidak valid." });

  const { orderId, cancel } = req.body || {};
  if (!orderId) return res.status(400).json({ error: "orderId wajib diisi." });

  // Handle cancel
  if (cancel) {
    const sql2 = neon(process.env.DATABASE_URL);
    await sql2`UPDATE digital_orders SET status='cancelled', updated_at=NOW() WHERE id=${orderId} AND status='pending_payment'`;
    return res.status(200).json({ success: true, message: "Order dibatalkan." });
  }

  const sql = neon(process.env.DATABASE_URL);

  // Ambil order dari DB
  const rows = await sql`SELECT * FROM digital_orders WHERE id = ${orderId} LIMIT 1`;
  const order = rows[0];
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan." });
  if (order.status !== "pending_payment")
    return res.status(400).json({ error: `Order sudah berstatus: ${order.status}` });

  const username   = process.env.DIGIFLAZZ_USERNAME;
  const prodApiKey = process.env.DIGIFLAZZ_API_KEY;
  if (!username || !prodApiKey)
    return res.status(503).json({ error: "Digiflazz belum dikonfigurasi." });

  const refId = order.ref_id;
  const sign  = crypto.createHash("md5").update(username + prodApiKey + refId).digest("hex");

  try {
    // Kirim ke Digiflazz via Worker (Worker yang punya IP ter-whitelist)
    const r = await fetch("https://proxy.enuyrasa.my.id/transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        buyer_sku_code: order.sku,
        customer_no:    order.target_number,
        ref_id:         refId,
        sign
      })
    });
    const digiData = await r.json();
    const tx = digiData.data || {};
    const digiStatus = tx.status || "Gagal";
    const internalStatus =
      digiStatus === "Sukses"  ? "success" :
      digiStatus === "Pending" ? "pending"  : "failed";

    // Update DB
    await sql`
      UPDATE digital_orders SET
        status             = ${internalStatus},
        digiflazz_status   = ${digiStatus},
        digiflazz_message  = ${tx.message || ""},
        digiflazz_sn       = ${tx.sn || ""},
        raw_response       = ${JSON.stringify(digiData)},
        updated_at         = NOW()
      WHERE id = ${orderId}
    `;

    const hargaFmt = "Rp " + Number(order.price).toLocaleString("id-ID");
    const fonnteToken = process.env.FONNTE_TOKEN || "";

    // Notif WA ke pelanggan
    if (fonnteToken && order.customer_wa) {
      if (internalStatus === "success") {
        await notifWA(fonnteToken, order.customer_wa,
          `✅ *Pulsa Berhasil Dikirim!*\n` +
          `Halo *${order.customer_name}*!\n` +
          `Pulsa ${hargaFmt} sudah masuk ke *${order.target_number}*.\n` +
          `SN: ${tx.sn || "-"}\nRef: ${refId}\n\nTerima kasih! 🙏`
        );
      } else if (internalStatus === "pending") {
        await notifWA(fonnteToken, order.customer_wa,
          `⏳ *Pulsa Sedang Diproses*\nHalo *${order.customer_name}*, pulsa sedang diproses oleh provider. Ditunggu ya!\nRef: ${refId}`
        );
      } else {
        await notifWA(fonnteToken, order.customer_wa,
          `❌ *Proses Pulsa Gagal*\nHalo *${order.customer_name}*, maaf terjadi kendala saat memproses pulsa kamu.\nAdmin akan menghubungi kamu segera.\nRef: ${refId}`
        );
      }
    }

    return res.status(200).json({
      success: internalStatus !== "failed",
      status:  internalStatus,
      message: tx.message || "",
      sn:      tx.sn || "",
      refId
    });

  } catch (err) {
    return res.status(500).json({ error: "Gagal proses: " + err.message });
  }
}
