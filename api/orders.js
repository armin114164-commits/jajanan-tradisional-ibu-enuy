/**
 * GET  /api/orders        — Ambil daftar pesanan (admin)
 * POST /api/orders?verify — Verifikasi token admin (gabungan dari verify-token.js)
 * Query: ?status=pending|confirmed|cancelled|all (default: all)
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN       || "").trim();
  const superToken = (process.env.SUPER_ADMIN_TOKEN  || "").trim();

  // ── POST /api/orders?verify=1 → verify token (ganti verify-token.js) ──
  if (req.method === "POST") {
    if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
    if (superToken && token === superToken)
      return res.status(200).json({ success: true, role: "super_admin" });
    if (token === adminToken) {
      return res.status(200).json({ success: true, role: superToken ? "admin" : "super_admin" });
    }
    return res.status(401).json({ error: "Token tidak valid." });
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
  if (token !== adminToken && token !== superToken)
    return res.status(401).json({ error: "Token tidak valid." });

  const status = req.query.status || "all";

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = status === "all"
      ? await sql`SELECT * FROM orders ORDER BY created_at DESC`
      : await sql`SELECT * FROM orders WHERE status = ${status} ORDER BY created_at DESC`;

    const orders = rows.map(o => ({
      ...o,
      items: o.items ? JSON.parse(o.items) : []
    }));
    return res.status(200).json(orders);
  } catch (err) {
    return res.status(500).json({ error: "Gagal memuat pesanan: " + err.message });
  }
}
