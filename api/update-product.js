/**
 * POST /api/update-product
 * Edit satu produk langsung dari admin tanpa upload CSV.
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
  if (token !== adminToken) return res.status(401).json({ error: "Token tidak valid." });

  const { id, name, price, desc, img, status, statusLabel, variants, stock } = req.body || {};

  if (!id)   return res.status(400).json({ error: "ID produk wajib diisi." });
  if (!name) return res.status(400).json({ error: "Nama produk wajib diisi." });
  if (!price || isNaN(Number(price))) return res.status(400).json({ error: "Harga tidak valid." });

  // Validasi variants — harus array yang valid
  let variantsJson = "[]";
  if (variants && Array.isArray(variants)) {
    variantsJson = JSON.stringify(variants);
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const stockVal = (stock != null && !isNaN(Number(stock))) ? Number(stock) : -1;
    await sql`
      UPDATE products SET
        name         = ${name},
        price        = ${Number(price)},
        description  = ${desc || ""},
        img          = ${img || ""},
        status       = ${status || "ready"},
        status_label = ${statusLabel || "Ready Stock"},
        variants     = ${variantsJson},
        stock        = ${stockVal},
        updated_at   = NOW()
      WHERE id = ${id}
    `;
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Gagal menyimpan: " + err.message });
  }
}
