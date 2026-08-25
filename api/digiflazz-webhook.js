/**
 * POST /api/digiflazz-webhook
 * Menerima callback/notifikasi dari Digiflazz saat status transaksi berubah.
 * Ref: https://developer.digiflazz.com/api/#callback
 *
 * Digiflazz mengirim POST ke URL ini (diset di dashboard Digiflazz →
 * Pengaturan → Koneksi API → Callback URL).
 * Set Callback URL ke: https://enuyrasa.my.id/api/digiflazz-webhook
 *
 * Signature verifikasi: MD5(username + production_api_key + "callback")
 *
 * Payload Digiflazz:
 * {
 *   "data": {
 *     "ref_id":      "DIG-...",
 *     "buyer_sku_code": "...",
 *     "customer_no": "...",
 *     "status":      "Sukses" | "Gagal" | "Pending",
 *     "message":     "...",
 *     "sn":          "...",
 *     "price":       12000,
 *     "rc":          "00"
 *   }
 * }
 */

import crypto from "crypto";
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const username   = process.env.DIGIFLAZZ_USERNAME;
  const prodApiKey = process.env.DIGIFLAZZ_API_KEY;

  if (!username || !prodApiKey) {
    console.error("[webhook] Env vars tidak dikonfigurasi.");
    return res.status(503).end();
  }

  // ── Verifikasi signature dari Digiflazz ─────────────────────────
  // Digiflazz mengirim header X-Hub-Signature: sha1=HMAC_SHA1(secret, body)
  // Secret = nilai yang kamu isi di field "Secret" di dashboard Digiflazz
  const webhookSecret = process.env.DIGIFLAZZ_WEBHOOK_SECRET || prodApiKey;
  const hubSignature  = req.headers["x-hub-signature"] || "";

  if (hubSignature) {
    const provided = hubSignature.replace(/^sha1=/, "");
    const hmac     = crypto.createHmac("sha1", webhookSecret)
      .update(JSON.stringify(req.body))
      .digest("hex");
    if (hmac !== provided) {
      console.warn("[webhook] Signature tidak cocok:", { provided, hmac });
      return res.status(401).json({ error: "Signature tidak valid." });
    }
  }

  const payload = req.body;
  const tx      = payload?.data || {};
  const refId   = tx.ref_id;

  if (!refId) {
    console.warn("[webhook] Payload tidak mengandung ref_id.", payload);
    return res.status(400).json({ error: "ref_id tidak ditemukan." });
  }

  // ── Mapping status ───────────────────────────────────────────────
  const digiflazzStatus = tx.status || "Gagal";
  const internalStatus  =
    digiflazzStatus === "Sukses"  ? "success" :
    digiflazzStatus === "Pending" ? "pending"  : "failed";

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Update record yang ada
    const updated = await sql`
      UPDATE digital_orders
      SET
        status             = ${internalStatus},
        digiflazz_status   = ${digiflazzStatus},
        digiflazz_message  = ${tx.message || ""},
        digiflazz_sn       = ${tx.sn || ""},
        raw_response       = ${JSON.stringify(payload)},
        updated_at         = NOW()
      WHERE ref_id = ${refId}
      RETURNING id, customer_name, customer_wa, target_number, sku, price
    `;

    if (updated.length === 0) {
      console.warn("[webhook] ref_id tidak ditemukan di DB:", refId);
      // Tetap 200 agar Digiflazz tidak retry terus
      return res.status(200).json({ received: true, warning: "ref_id tidak ditemukan." });
    }

    const order = updated[0];

    // ── Kirim notif WA ke admin saat status final ─────────────────
    const fonnteToken = process.env.FONNTE_TOKEN;
    const adminWARaw  = process.env.ADMIN_WA || "";
    if (fonnteToken && adminWARaw && internalStatus !== "pending") {
      const statusEmoji = internalStatus === "success" ? "✅" : "❌";
      const msg =
        `${statusEmoji} *UPDATE TOP-UP #${order.id}*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `👤 ${order.customer_name}\n` +
        `📲 ${order.target_number}\n` +
        `📦 ${order.sku}\n` +
        `💰 Rp ${Number(order.price).toLocaleString("id-ID")}\n` +
        `📊 Status: *${digiflazzStatus}*\n` +
        (tx.sn     ? `✅ SN: ${tx.sn}\n`       : "") +
        (tx.message? `💬 ${tx.message}\n`        : "") +
        `🔖 Ref: ${refId}`;

      const targets = adminWARaw.split(",").map(n => n.trim()).filter(Boolean);
      await Promise.all(targets.map(target =>
        fetch("https://api.fonnte.com/send", {
          method:  "POST",
          headers: { "Authorization": fonnteToken, "Content-Type": "application/json" },
          body:    JSON.stringify({ target, message: msg })
        }).catch(() => {})
      ));
    }

    console.log(`[webhook] Updated order ${order.id} → ${internalStatus}`);
    return res.status(200).json({ received: true, orderId: order.id, status: internalStatus });
  } catch (err) {
    console.error("[webhook] DB error:", err);
    // Return 200 agar Digiflazz tidak retry — log error cukup di server
    return res.status(200).json({ received: true, error: err.message });
  }
}
