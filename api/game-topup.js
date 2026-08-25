/**
 * POST /api/game-topup
 *
 * Proses order top-up game via apigames.id
 * Base URL: https://v1.apigames.id
 * Docs: https://documenter.getpostman.com/view/20401599/UVyvvZjR
 *
 * Body JSON:
 *   { gameId, sku, targetNumber, zoneNumber, customerName, customerWA, price, notes }
 *
 * Env vars:
 *   APIGAMES_MERCHANT_ID  — dari member.apigames.id
 *   APIGAMES_SECRET_KEY   — secret key (bukan api_key login)
 *   FONNTE_TOKEN + ADMIN_WA — notif WA
 */

import crypto   from "crypto";
import { neon } from "@neondatabase/serverless";

const BASE = "https://v1.apigames.id";

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

async function notifWA(target, msg) {
  if (!process.env.FONNTE_TOKEN) return;
  await fetch("https://api.fonnte.com/send", {
    method:  "POST",
    headers: { "Authorization": process.env.FONNTE_TOKEN },
    body:    new URLSearchParams({ target, message: msg, countryCode: "62" })
  }).catch(() => {});
}

async function saveOrder(data) {
  if (!process.env.DATABASE_URL) return;
  try {
    const sql = neon(process.env.DATABASE_URL);
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
  } catch (e) { console.error("DB:", e.message); }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const merchantId = process.env.APIGAMES_MERCHANT_ID;
  const secretKey  = process.env.APIGAMES_SECRET_KEY;

  if (!merchantId || !secretKey)
    return res.status(503).json({ error: "Layanan top-up game belum dikonfigurasi.", code: "NO_APIGAMES_CONFIG" });

  const { gameId, sku, targetNumber, zoneNumber, customerName, customerWA, price, notes } = req.body || {};

  if (!sku || !targetNumber || !customerName || !customerWA)
    return res.status(400).json({ error: "Data tidak lengkap." });

  const refId  = "AG" + Date.now() + Math.floor(Math.random() * 1000);
  const sign   = md5(merchantId + secretKey);

  // Format tujuan: untuk game yang butuh zone, pisah dengan | atau spasi sesuai engine
  const tujuan = zoneNumber ? `${targetNumber}|${zoneNumber}` : targetNumber;

  try {
    // ─── Kirim transaksi via POST /v2/transaksi ───────────────────
    const body = {
      ref_id:      refId,
      merchant_id: merchantId,
      produk:      sku,
      tujuan:      tujuan,
      server_id:   zoneNumber || "",
      signature:   sign
    };

    const agRes = await fetch(`${BASE}/v2/transaksi`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body)
    });

    const agData = await agRes.json().catch(() => ({}));

    // ─── Simpan ke DB ─────────────────────────────────────────────
    await saveOrder({
      refId, sku, game: gameId || "unknown",
      itemName: notes || sku,
      targetNumber: tujuan, customerName, customerWA,
      price: price || 0,
      status: agData.rc === 200 ? "success" : agData.rc === 201 ? "pending" : "failed",
      notes
    });

    // ─── Handle response apigames ─────────────────────────────────
    // rc: 200 = sukses, 201 = pending/proses, selainnya = error
    if (agData.rc === 200) {
      // Notif admin
      if (process.env.ADMIN_WA) {
        await notifWA(process.env.ADMIN_WA,
          `✅ *Game Topup BERHASIL*\nRef: ${refId}\nGame: ${gameId} · ${sku}\nTarget: ${tujuan}\nCustomer: ${customerName} (${customerWA})\nHarga: Rp ${Number(price||0).toLocaleString("id-ID")}`
        );
      }
      // Notif pelanggan
      await notifWA(customerWA,
        `✅ *Top-up Berhasil!*\nHalo ${customerName}, top-up kamu sudah berhasil!\nItem: ${notes || sku}\nID: ${targetNumber}${zoneNumber ? ` (Zone: ${zoneNumber})` : ""}\nRef: ${refId}\n\nTerima kasih! 🎮`
      );
      return res.status(200).json({ status: "success", refId, message: "Top-up berhasil!", sn: agData.data?.sn || null });
    }

    if (agData.rc === 201) {
      if (process.env.ADMIN_WA) {
        await notifWA(process.env.ADMIN_WA,
          `⏳ *Game Topup PENDING*\nRef: ${refId}\nGame: ${gameId} · ${sku}\nTarget: ${tujuan}\nCustomer: ${customerName} (${customerWA})`
        );
      }
      return res.status(200).json({ status: "pending", refId, message: "Pesanan sedang diproses. Admin akan menghubungi kamu." });
    }

    // Error dari apigames
    const errMsg = agData.error_msg || agData.message || "Transaksi gagal.";
    if (process.env.ADMIN_WA) {
      await notifWA(process.env.ADMIN_WA,
        `❌ *Game Topup GAGAL*\nRef: ${refId}\nGame: ${gameId} · ${sku}\nTarget: ${tujuan}\nCustomer: ${customerName}\nError: ${errMsg} (rc=${agData.rc})`
      );
    }
    return res.status(400).json({ status: "failed", message: errMsg, refId, rc: agData.rc });

  } catch (err) {
    console.error("game-topup error:", err);
    return res.status(500).json({ error: "Gagal menghubungi provider: " + err.message });
  }
}
