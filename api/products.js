/**
 * /api/products — Multi-method handler
 *
 * GET  /api/products                    → list semua produk (publik)
 * POST /api/products  {action:"update"} → update produk (admin)
 * POST /api/products  {action:"delete"} → hapus produk (admin)
 *
 * Dengan cara ini, kalau di masa depan perlu tambah action baru
 * (misal: "duplicate", "reorder", dll) cukup tambah di sini
 * tanpa menambah file baru.
 */

import { neon } from "@neondatabase/serverless";

// Helper: cek token admin
function checkAdmin(req) {
  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return { error: "Server tidak terkonfigurasi.", status: 500 };
  if (token !== adminToken) return { error: "Token tidak valid.", status: 401 };
  return null;
}

export default async function handler(req, res) {

  // ── GET: List produk (publik, tidak butuh token) ───────────────
  if (req.method === "GET") {
    try {
      const sql = neon(process.env.DATABASE_URL);
      const cols = await sql`
        SELECT column_name FROM information_schema.columns WHERE table_name='products'
      `;
      const names    = cols.map(c => c.column_name);
      const hasStock = names.includes("stock");
      const hasUnit  = names.includes("unit");

      const rows = await sql`
        SELECT id, name, price, description AS desc, img, status,
               status_label AS "statusLabel",
               ${hasUnit  ? sql`unit`  : sql`'mika' AS unit`},
               ${hasStock ? sql`stock` : sql`-1 AS stock`},
               variants
        FROM products ORDER BY sort_order ASC, created_at ASC
      `;
      const products = rows.map(p => ({ ...p, variants: p.variants ? JSON.parse(p.variants) : [] }));
      res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
      return res.status(200).json(products);
    } catch (err) {
      return res.status(500).json({ error: "Gagal memuat produk: " + err.message });
    }
  }

  // ── POST: Aksi admin (update / delete / actions baru di masa depan) ─
  if (req.method === "POST") {
    const authErr = checkAdmin(req);
    if (authErr) return res.status(authErr.status).json({ error: authErr.error });

    const body   = req.body || {};
    const action = body.action;
    const id     = body.id;
    if (!id) return res.status(400).json({ error: "ID produk wajib diisi." });

    try {
      const sql = neon(process.env.DATABASE_URL);

      // ── delete ──────────────────────────────────────────────────
      if (action === "delete") {
        await sql`DELETE FROM products WHERE id=${id}`;
        return res.status(200).json({ success: true });
      }

      // ── update ──────────────────────────────────────────────────
      if (action === "update") {
        const { name, price, desc, img, status, statusLabel, variants, stock } = body;
        if (!name) return res.status(400).json({ error: "Nama produk wajib diisi." });
        if (!price || isNaN(Number(price))) return res.status(400).json({ error: "Harga tidak valid." });
        const variantsJson = (variants && Array.isArray(variants)) ? JSON.stringify(variants) : "[]";
        const stockVal     = (stock != null && !isNaN(Number(stock))) ? Number(stock) : -1;
        await sql`UPDATE products SET
          name=${name}, price=${Number(price)}, description=${desc||""},
          img=${img||""}, status=${status||"ready"}, status_label=${statusLabel||"Ready Stock"},
          variants=${variantsJson}, stock=${stockVal}, updated_at=NOW()
          WHERE id=${id}`;
        return res.status(200).json({ success: true });
      }

      // ── action tidak dikenal ─────────────────────────────────────
      return res.status(400).json({ error: `Action "${action}" tidak dikenal.` });
    } catch (err) {
      return res.status(500).json({ error: "Gagal: " + err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
