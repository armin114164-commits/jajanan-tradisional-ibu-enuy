/**
 * GET /api/digiflazz-balance
 * Cek saldo deposit Digiflazz.
 * Ref: https://developer.digiflazz.com/api/#cek-saldo
 *
 * Signature: MD5(username + production_api_key + "depo")
 *
 * Butuh header: x-admin-token
 */

import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Harus admin
  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
  if (token !== adminToken) return res.status(401).json({ error: "Token tidak valid." });

  const username   = process.env.DIGIFLAZZ_USERNAME;
  const prodApiKey = process.env.DIGIFLAZZ_API_KEY;

  if (!username || !prodApiKey)
    return res.status(503).json({ error: "Layanan digital belum dikonfigurasi." });

  // Signature: MD5(username + production_api_key + "depo")
  const sign = crypto.createHash("md5")
    .update(username + prodApiKey + "depo")
    .digest("hex");

  try {
    const response = await fetch("https://api.digiflazz.com/v1/cek-saldo", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ cmd: "deposit", username, sign })
    });

    if (!response.ok) {
      return res.status(502).json({ error: "Digiflazz error: HTTP " + response.status });
    }

    const json = await response.json();
    const data = json.data || {};

    return res.status(200).json({
      balance:  data.deposit ?? null,
      username: data.username ?? username,
      raw:      json
    });
  } catch (err) {
    return res.status(500).json({ error: "Gagal mengambil saldo: " + err.message });
  }
}
