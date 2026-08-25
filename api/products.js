/**
 * GET /api/products
 * Vercel Serverless Function — Neon Postgres
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Cek kolom mana saja yang sudah ada
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'products'
    `;
    const colNames = cols.map(c => c.column_name);
    const hasStock = colNames.includes("stock");
    const hasUnit  = colNames.includes("unit");

    const rows = await sql`
      SELECT
        id,
        name,
        price,
        description  AS desc,
        img,
        status,
        status_label AS "statusLabel",
        ${hasUnit  ? sql`unit`  : sql`'mika' AS unit`},
        ${hasStock ? sql`stock` : sql`-1    AS stock`},
        variants
      FROM products
      ORDER BY sort_order ASC, created_at ASC
    `;

    // Parse variants JSON string ke array
    const products = rows.map(p => ({
      ...p,
      variants: p.variants ? JSON.parse(p.variants) : []
    }));

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json(products);
  } catch (err) {
    console.error("[products] DB error:", err);
    return res.status(500).json({ error: "Gagal memuat produk: " + err.message });
  }
}
