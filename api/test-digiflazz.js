/**
 * GET /api/test-digiflazz
 * Test koneksi ke Digiflazz API — endpoint diagnostik untuk admin.
 * Credentials diambil dari environment variables (tidak hardcode).
 * Ref: https://developer.digiflazz.com/api/#transaksi (mode testing)
 *
 * Mode testing Digiflazz:
 *   - Kirim field "testing": true pada body transaksi
 *   - Nomor dummy: 087800001232 (XL)
 *   - SKU dummy: xld10 (XL Data 10rb)
 *   - Tidak memotong saldo, response seperti transaksi sungguhan
 *
 * Butuh header: x-admin-token
 */

import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  // Harus admin
  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
  if (token !== adminToken) return res.status(401).json({ error: "Token tidak valid." });

  const username   = process.env.DIGIFLAZZ_USERNAME;
  const prodApiKey = process.env.DIGIFLAZZ_API_KEY;

  if (!username || !prodApiKey)
    return res.status(503).json({
      error:    "Env vars belum diset.",
      missing:  [
        !username   ? "DIGIFLAZZ_USERNAME"  : null,
        !prodApiKey ? "DIGIFLAZZ_API_KEY"   : null
      ].filter(Boolean)
    });

  const refId = "TEST-" + Date.now();

  // Signature pakai Production API Key (bukan dev key)
  const sign = crypto.createHash("md5")
    .update(username + prodApiKey + refId)
    .digest("hex");

  const txBody = {
    username,
    buyer_sku_code: "xld10",        // SKU test XL Data 10rb
    customer_no:    "087800001232", // nomor dummy resmi Digiflazz
    ref_id:         refId,
    sign,
    testing:        true            // WAJIB true — jangan hapus untuk endpoint test ini
  };

  // Juga test price-list
  const signPricelist = crypto.createHash("md5")
    .update(username + prodApiKey + "pricelist")
    .digest("hex");

  try {
    const [txRes, plRes] = await Promise.all([
      // Test transaksi (mode testing)
      fetch("https://api.digiflazz.com/v1/transaction", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(txBody)
      }),
      // Test price-list (ambil 3 item saja untuk cek koneksi)
      fetch("https://api.digiflazz.com/v1/price-list", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ cmd: "prepaid", username, sign: signPricelist })
      })
    ]);

    const txData  = await txRes.json();
    const plData  = await plRes.json();
    const plItems = plData.data ? plData.data.slice(0, 3) : [];

    return res.status(200).json({
      env: {
        username:        username,
        apiKeySet:       !!prodApiKey,
        testingMode:     process.env.DIGIFLAZZ_TESTING === "true",
      },
      transactionTest: {
        request:  { ...txBody, sign: "[hidden]" },
        response: txData
      },
      priceListTest: {
        totalItems: plData.data?.length ?? 0,
        sample:     plItems.map(p => ({ sku: p.buyer_sku_code, name: p.product_name, price: p.price }))
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
