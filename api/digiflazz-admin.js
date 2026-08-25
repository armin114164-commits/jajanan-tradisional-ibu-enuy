/**
 * GET /api/digiflazz-admin?cmd=balance|test
 * Gabungan digiflazz-balance + test-digiflazz
 * Butuh header: x-admin-token
 */

import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
  if (token !== adminToken) return res.status(401).json({ error: "Token tidak valid." });

  const username   = process.env.DIGIFLAZZ_USERNAME;
  const prodApiKey = process.env.DIGIFLAZZ_API_KEY;
  if (!username || !prodApiKey)
    return res.status(503).json({ error: "Digiflazz belum dikonfigurasi.", missing: [!username && "DIGIFLAZZ_USERNAME", !prodApiKey && "DIGIFLAZZ_API_KEY"].filter(Boolean) });

  const cmd = req.query.cmd || "balance";

  try {
    // ── CEK SALDO ────────────────────────────────────────────────
    if (cmd === "balance") {
      const sign = crypto.createHash("md5").update(username + prodApiKey + "depo").digest("hex");
      const r    = await fetch("https://digiflazz-proxy.ncuupp1.workers.dev/cek-saldo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "deposit", username, sign })
      });
      const json = await r.json();
      return res.status(200).json({ balance: json.data?.deposit ?? null, username: json.data?.username ?? username, raw: json });
    }

    // ── TEST KONEKSI ─────────────────────────────────────────────
    if (cmd === "test") {
      const refId    = "TEST-" + Date.now();
      const sign     = crypto.createHash("md5").update(username + prodApiKey + refId).digest("hex");
      const signPl   = crypto.createHash("md5").update(username + prodApiKey + "pricelist").digest("hex");
      const [txRes, plRes] = await Promise.all([
        fetch("https://digiflazz-proxy.ncuupp1.workers.dev/transaction", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, buyer_sku_code: "xld10", customer_no: "087800001232", ref_id: refId, sign, testing: true })
        }),
        fetch("https://digiflazz-proxy.ncuupp1.workers.dev/price-list", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: "prepaid", username, sign: signPl })
        })
      ]);
      const txData = await txRes.json();
      const plData = await plRes.json();
      return res.status(200).json({
        env: { username, apiKeySet: !!prodApiKey, testingMode: process.env.DIGIFLAZZ_TESTING === "true" },
        transactionTest: { response: txData },
        priceListTest: { totalItems: plData.data?.length ?? 0, sample: (plData.data||[]).slice(0,3).map(p=>({ sku: p.buyer_sku_code, name: p.product_name, price: p.price })) }
      });
    }

    return res.status(400).json({ error: "cmd harus balance atau test" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
