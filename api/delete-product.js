/**
 * DELETE /api/delete-product?id=xxx
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
  if (token !== adminToken) return res.status(401).json({ error: "Token tidak valid." });

  const id = (req.query.id || "").trim();
  if (!id) return res.status(400).json({ error: "ID produk wajib diisi." });

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM products WHERE id = ${id}`;
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Gagal menghapus: " + err.message });
  }
}
