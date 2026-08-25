/**
 * GET /api/digital-orders
 * Ambil daftar transaksi top-up digital untuk admin.
 * Query: ?status=success|pending|failed|all (default: all) &limit=50
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
  if (token !== adminToken) return res.status(401).json({ error: "Token tidak valid." });

  const status = req.query.status || "all";
  const limit  = Math.min(parseInt(req.query.limit || "100", 10), 200);

  try {
    const sql  = neon(process.env.DATABASE_URL);
    const rows = status === "all"
      ? await sql`SELECT * FROM digital_orders ORDER BY created_at DESC LIMIT ${limit}`
      : await sql`SELECT * FROM digital_orders WHERE status = ${status} ORDER BY created_at DESC LIMIT ${limit}`;

    return res.status(200).json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Gagal memuat riwayat transaksi: " + err.message });
  }
}
