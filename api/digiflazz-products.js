/**
 * GET /api/digiflazz-products?type=pulsa|data|all
 *
 * Ambil price list produk digital dari Digiflazz, lalu terapkan markup
 * sehingga harga yang tampil ke pelanggan sudah termasuk keuntungan.
 *
 * Sistem markup (diset via Vercel Environment Variables):
 *   MARKUP_PERCENT  = persentase markup dari harga modal, default 5
 *                     contoh: 5 → harga modal Rp 10.000 → jual Rp 10.500
 *   MARKUP_FLAT     = tambahan nominal flat per transaksi, default 0
 *                     contoh: 500 → setiap produk +Rp 500
 *   MARKUP_ROUND    = pembulatan harga jual ke atas, default 100
 *                     contoh: 100 → Rp 10.450 → Rp 10.500
 *
 * Contoh kombinasi: MARKUP_PERCENT=3, MARKUP_FLAT=500, MARKUP_ROUND=500
 *   Modal Rp 10.000 → +3% = Rp 10.300 → +500 = Rp 10.800 → bulat ke 500 = Rp 11.000
 *
 * Harga modal TIDAK pernah dikirim ke frontend — pelanggan hanya lihat harga jual.
 */

import crypto from "crypto";

/** Hitung harga jual dari harga modal */
function applyMarkup(modalPrice, pct, flat, round) {
  const afterPct  = modalPrice * (1 + pct / 100);
  const afterFlat = afterPct + flat;
  if (round <= 1) return Math.ceil(afterFlat);
  return Math.ceil(afterFlat / round) * round;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const username   = process.env.DIGIFLAZZ_USERNAME;
  const prodApiKey = process.env.DIGIFLAZZ_API_KEY;

  if (!username || !prodApiKey)
    return res.status(503).json({ error: "Layanan digital belum dikonfigurasi." });

  // Baca konfigurasi markup dari env — semua opsional, ada default
  const markupPct   = parseFloat(process.env.MARKUP_PERCENT || "5");   // % keuntungan
  const markupFlat  = parseInt(process.env.MARKUP_FLAT     || "0");    // nominal flat
  const markupRound = parseInt(process.env.MARKUP_ROUND    || "100");  // pembulatan

  const sign = crypto.createHash("md5")
    .update(username + prodApiKey + "pricelist")
    .digest("hex");

  try {
    const response = await fetch("https://proxy.enuyrasa.my.id/price-list", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ cmd: "prepaid", username, sign })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: "Digiflazz HTTP " + response.status, detail: errText });
    }

    const json = await response.json();
    if (!json.data)
      return res.status(502).json({ error: "Digiflazz tidak mengembalikan data.", detail: json.rc || json.message });

    const ALLOWED = ["Pulsa", "Data", "Paket Data", "Paket Telepon"];
    const typeFilter = (req.query.type || "all").toLowerCase();

    let items = json.data.filter(p => p.buyer_product_status === true && ALLOWED.includes(p.category));

    if (typeFilter === "pulsa")      items = items.filter(p => p.category === "Pulsa");
    else if (typeFilter === "data")  items = items.filter(p => p.category !== "Pulsa");

    const products = items.map(p => {
      const sellPrice = applyMarkup(p.price, markupPct, markupFlat, markupRound);
      return {
        sku:      p.buyer_sku_code,
        name:     p.product_name,
        category: p.category,
        brand:    p.brand,
        type:     p.type,
        price:    sellPrice,   // ← harga JUAL (sudah markup), bukan modal
        desc:     p.desc || "",
        stock:    p.unlimited_stock ? "unlimited" : (p.stock ?? "unknown"),
        multi:    p.multi
      };
    });

    products.sort((a, b) => a.brand.localeCompare(b.brand) || a.price - b.price);

    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=120");
    return res.status(200).json(products);
  } catch (err) {
    return res.status(500).json({ error: "Gagal menghubungi Digiflazz: " + err.message });
  }
}
