/**
 * GET  /api/digiflazz-products?type=pulsa|data|all
 * POST /api/digiflazz-products         (sama, untuk compat)
 *
 * Ambil price list produk digital (prepaid) dari Digiflazz.
 * Ref: https://developer.digiflazz.com/api/#price-list
 *
 * Signature: MD5(username + production_api_key + "pricelist")
 * Cache 10 menit — price list jarang berubah.
 */

import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const username   = process.env.DIGIFLAZZ_USERNAME;
  const prodApiKey = process.env.DIGIFLAZZ_API_KEY;   // Production API Key

  if (!username || !prodApiKey)
    return res.status(503).json({ error: "Layanan digital belum dikonfigurasi." });

  // Signature: MD5(username + production_api_key + "pricelist")
  const sign = crypto.createHash("md5")
    .update(username + prodApiKey + "pricelist")
    .digest("hex");

  try {
    const response = await fetch("https://api.digiflazz.com/v1/price-list", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        cmd:      "prepaid",
        username,
        sign
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: "Digiflazz HTTP " + response.status, detail: errText });
    }

    const json = await response.json();

    if (!json.data) {
      return res.status(502).json({
        error:  "Digiflazz tidak mengembalikan data.",
        detail: json.rc || json.message || JSON.stringify(json)
      });
    }

    // Filter: hanya produk aktif (buyer_product_status = true)
    // Kategori yang relevan untuk toko ini
    const ALLOWED_CATEGORIES = ["Pulsa", "Data", "Paket Data", "Paket Telepon"];
    const typeFilter = (req.query.type || "all").toLowerCase();

    let items = json.data.filter(p =>
      p.buyer_product_status === true && ALLOWED_CATEGORIES.includes(p.category)
    );

    if (typeFilter === "pulsa")
      items = items.filter(p => p.category === "Pulsa");
    else if (typeFilter === "data")
      items = items.filter(p => p.category !== "Pulsa");

    // Normalisasi field untuk frontend
    const products = items.map(p => ({
      sku:      p.buyer_sku_code,
      name:     p.product_name,
      category: p.category,
      brand:    p.brand,
      type:     p.type,
      price:    p.price,          // harga beli (buyer price)
      desc:     p.desc || "",
      stock:    p.unlimited_stock ? "unlimited" : (p.stock ?? "unknown"),
      multi:    p.multi            // true = bisa beli >1 sekaligus
    }));

    // Sort: brand A-Z, price asc
    products.sort((a, b) => a.brand.localeCompare(b.brand) || a.price - b.price);

    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=120");
    return res.status(200).json(products);
  } catch (err) {
    return res.status(500).json({ error: "Gagal menghubungi Digiflazz: " + err.message });
  }
}
