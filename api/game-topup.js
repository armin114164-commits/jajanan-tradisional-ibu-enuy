/**
 * POST /api/game-topup
 *
 * Proses order top-up game via apigames.id (Kiosgamer / Smile.one / Unipin / dll)
 *
 * Body JSON:
 *   { gameId, sku, targetNumber, zoneNumber, customerName, customerWA, price, notes }
 *
 * Env vars yang dibutuhkan:
 *   APIGAMES_MERCHANT_ID  — Merchant ID dari member.apigames.id
 *   APIGAMES_API_KEY      — API Key dari member.apigames.id → Profil → API
 *   ADMIN_TOKEN           — untuk validasi request
 *   FONNTE_TOKEN          — notif WA admin
 *   ADMIN_WA              — nomor WA admin
 *
 * Docs: https://docs.apigames.id
 */

import crypto    from "crypto";
import { neon }  from "@neondatabase/serverless";

// ─── Helper: notif WA via Fonnte ─────────────────────────────────────────────
async function notifWA(target, msg) {
  if (!process.env.FONNTE_TOKEN) return;
  await fetch("https://api.fonnte.com/send", {
    method:  "POST",
    headers: { "Authorization": process.env.FONNTE_TOKEN },
    body:    new URLSearchParams({ target, message: msg, countryCode: "62" })
  }).catch(() => {});
}

// ─── Helper: simpan ke DB ─────────────────────────────────────────────────────
async function saveOrder(sql, data) {
  try {
    await sql`
      INSERT INTO digital_orders
        (ref_id, sku, game, item_name, target_number, customer_name, customer_wa,
         price, status, provider, notes, created_at)
      VALUES
        (${data.refId}, ${data.sku}, ${data.game}, ${data.itemName},
         ${data.targetNumber}, ${data.customerName}, ${data.customerWA},
         ${data.price}, ${data.status}, 'apigames',
         ${data.notes || ""}, NOW())
    `;
  } catch (e) {
    console.error("DB save error:", e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ─── Auth ────────────────────────────────────────────────────────────────
  // Tidak pakai ADMIN_TOKEN — endpoint ini dipanggil dari frontend user biasa.
  // Validasi cukup dari body + env.

  const merchantId = process.env.APIGAMES_MERCHANT_ID;
  const apiKey     = process.env.APIGAMES_API_KEY;

  if (!merchantId || !apiKey)
    return res.status(503).json({
      error: "Layanan top-up game belum dikonfigurasi.",
      code:  "NO_APIGAMES_CONFIG"
    });

  const {
    gameId, sku, targetNumber, zoneNumber,
    customerName, customerWA, price, notes
  } = req.body || {};

  if (!sku || !targetNumber || !customerName || !customerWA)
    return res.status(400).json({ error: "Data tidak lengkap." });

  // ─── Buat ref ID unik ────────────────────────────────────────────────────
  const refId = "AG" + Date.now() + Math.floor(Math.random() * 1000);

  // ─── Gabung target + zone jika ada ───────────────────────────────────────
  const target = zoneNumber ? `${targetNumber}|${zoneNumber}` : targetNumber;

  // ─── Signature apigames.id ───────────────────────────────────────────────
  // Format signature: MD5(merchantId + apiKey + refId)
  const sign = crypto.createHash("md5")
    .update(merchantId + apiKey + refId)
    .digest("hex");

  try {
    // ─── Kirim ke apigames.id ───────────────────────────────────────────────
    const agRes = await fetch("https://member.apigames.id/api/transaction", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "X-Api-Key":     apiKey,
        "X-Merchant-Id": merchantId,
      },
      body: JSON.stringify({
        merchant_id:  merchantId,
        api_key:      apiKey,
        ref_id:       refId,
        product_code: sku,
        target:       target,
        sign:         sign,
      })
    });

    const agData = await agRes.json().catch(() => ({}));

    // ─── Simpan ke DB ───────────────────────────────────────────────────────
    if (process.env.DATABASE_URL) {
      const sql = neon(process.env.DATABASE_URL);
      await saveOrder(sql, {
        refId, sku, game: gameId || "unknown",
        itemName: notes || sku,
        targetNumber: target, customerName, customerWA,
        price: price || 0,
        status: agData.status || "pending",
        notes
      });
    }

    // ─── Cek response apigames ──────────────────────────────────────────────
    if (!agRes.ok || agData.status === "failed" || agData.status === "error") {
      const msg = agData.message || agData.msg || "Transaksi gagal di provider.";

      // Notif admin
      if (process.env.ADMIN_WA) {
        await notifWA(process.env.ADMIN_WA,
          `❌ *Game Topup GAGAL*\nRef: ${refId}\nGame: ${gameId} · ${sku}\nTarget: ${target}\nPelanggan: ${customerName} (${customerWA})\nError: ${msg}`
        );
      }

      return res.status(400).json({ status: "failed", message: msg, refId });
    }

    // ─── Sukses / Pending ───────────────────────────────────────────────────
    const status = agData.status === "success" ? "success" : "pending";

    // Notif admin
    if (process.env.ADMIN_WA) {
      await notifWA(process.env.ADMIN_WA,
        `${status === "success" ? "✅" : "⏳"} *Game Topup ${status === "success" ? "BERHASIL" : "PENDING"}*\nRef: ${refId}\nGame: ${gameId} · ${sku}\nTarget: ${target}\nPelanggan: ${customerName} (${customerWA})\nHarga: Rp ${Number(price || 0).toLocaleString("id-ID")}`
      );
    }

    // Notif ke pelanggan jika sukses
    if (status === "success" && customerWA) {
      await notifWA(customerWA,
        `✅ *Top-up Berhasil!*\nHalo ${customerName}, top-up kamu sudah berhasil diproses!\nItem: ${notes || sku}\nID: ${targetNumber}${zoneNumber ? ` (Zone: ${zoneNumber})` : ""}\nRef: ${refId}\n\nTerima kasih sudah belanja di Enuy Rasa! 🎮`
      );
    }

    return res.status(200).json({
      status,
      refId,
      message: status === "success" ? "Top-up berhasil!" : "Pesanan sedang diproses.",
      sn: agData.sn || agData.serial_number || null
    });

  } catch (err) {
    console.error("game-topup error:", err);
    return res.status(500).json({ error: "Gagal menghubungi provider: " + err.message });
  }
}
