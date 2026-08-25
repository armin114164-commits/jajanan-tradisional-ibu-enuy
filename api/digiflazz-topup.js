/**
 * POST /api/digiflazz-topup
 * Proses top-up pulsa / paket data via Digiflazz.
 * Ref: https://developer.digiflazz.com/api/#transaksi
 *
 * Signature: MD5(username + production_api_key + ref_id)
 *
 * Body: { customerName, customerWA, targetNumber, sku, price, notes? }
 *
 * Status dari Digiflazz:
 *   "Sukses"  → transaksi berhasil
 *   "Pending" → sedang diproses, tunggu webhook callback
 *   "Gagal"   → transaksi gagal
 */

import crypto from "crypto";
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { customerName, customerWA, targetNumber, sku, price, notes } = req.body || {};

  if (!customerName || !customerWA)
    return res.status(400).json({ error: "Data pelanggan tidak lengkap." });
  if (!targetNumber || !sku)
    return res.status(400).json({ error: "Nomor tujuan dan produk wajib diisi." });

  const username   = process.env.DIGIFLAZZ_USERNAME;
  const prodApiKey = process.env.DIGIFLAZZ_API_KEY;   // Production API Key

  if (!username || !prodApiKey)
    return res.status(503).json({ error: "Layanan digital belum dikonfigurasi." });

  // ref_id unik per transaksi — max 50 char, huruf/angka/dash
  const refId = "DIG-" + Date.now();

  // Signature: MD5(username + production_api_key + ref_id)
  const sign = crypto.createHash("md5")
    .update(username + prodApiKey + refId)
    .digest("hex");

  // Apakah mode testing? Hanya true jika env DIGIFLAZZ_TESTING="true"
  const isTesting = process.env.DIGIFLAZZ_TESTING === "true";

  const txBody = {
    username,
    buyer_sku_code: sku,
    customer_no:    targetNumber,
    ref_id:         refId,
    sign,
    ...(isTesting ? { testing: true } : {})   // field testing HANYA jika true
  };

  try {
    const sql = neon(process.env.DATABASE_URL);

    // ── Kirim transaksi ke Digiflazz ──────────────────────────────
    const digiRes  = await fetch("https://proxy.enuyrasa.my.id/transaction", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(txBody)
    });
    const digiData = await digiRes.json();
    const tx       = digiData.data || {};

    // Mapping status Digiflazz → status internal
    const digiflazzStatus = tx.status || "Gagal";
    const internalStatus  =
      digiflazzStatus === "Sukses"  ? "success" :
      digiflazzStatus === "Pending" ? "pending"  : "failed";

    // ── Simpan ke DB ──────────────────────────────────────────────
    const inserted = await sql`
      INSERT INTO digital_orders
        (ref_id, customer_name, customer_wa, target_number, sku, price,
         notes, status, digiflazz_status, digiflazz_message, digiflazz_sn,
         raw_response)
      VALUES (
        ${refId},
        ${customerName},
        ${customerWA},
        ${targetNumber},
        ${sku},
        ${Number(price) || 0},
        ${notes || ""},
        ${internalStatus},
        ${digiflazzStatus},
        ${tx.message || ""},
        ${tx.sn || ""},
        ${JSON.stringify(digiData)}
      )
      RETURNING id
    `;
    const orderId = inserted[0]?.id;

    // ── Kirim notif WA ke admin ───────────────────────────────────
    const fonnteToken = process.env.FONNTE_TOKEN;
    const adminWARaw  = process.env.ADMIN_WA || "";
    if (fonnteToken && adminWARaw) {
      const statusEmoji =
        internalStatus === "success" ? "✅" :
        internalStatus === "pending" ? "⏳" : "❌";

      const msg =
        `${statusEmoji} *TOP-UP DIGITAL #${orderId}*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `👤 *Pelanggan:* ${customerName}\n` +
        `📱 *WA:* ${customerWA}\n` +
        `📲 *Nomor Tujuan:* ${targetNumber}\n` +
        `📦 *SKU:* ${sku}\n` +
        `💰 *Harga:* Rp ${Number(price).toLocaleString("id-ID")}\n` +
        `📊 *Status:* ${digiflazzStatus}\n` +
        `🔖 *Ref ID:* ${refId}\n` +
        (tx.sn ? `✅ *SN:* ${tx.sn}\n` : "") +
        (tx.message ? `💬 *Pesan:* ${tx.message}\n` : "") +
        `━━━━━━━━━━━━━━━━\n` +
        `Lihat admin: https://enuyrasa.my.id/admin.html`;

      const targets = adminWARaw.split(",").map(n => n.trim()).filter(Boolean);
      await Promise.all(targets.map(target =>
        fetch("https://api.fonnte.com/send", {
          method:  "POST",
          headers: { "Authorization": fonnteToken, "Content-Type": "application/json" },
          body:    JSON.stringify({ target, message: msg })
        }).catch(() => {})
      ));
    }

    return res.status(200).json({
      success:  internalStatus !== "failed",
      orderId,
      refId,
      status:   internalStatus,
      message:  tx.message || "",
      sn:       tx.sn || "",
      rc:       tx.rc || ""
    });
  } catch (err) {
    return res.status(500).json({ error: "Gagal memproses top-up: " + err.message });
  }
}
