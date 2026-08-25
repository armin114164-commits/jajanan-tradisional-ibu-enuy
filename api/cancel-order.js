/**
 * POST /api/cancel-order
 * Batalkan pesanan (stok tidak berubah).
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
  if (token !== adminToken) return res.status(401).json({ error: "Token tidak valid." });

  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: "Order ID wajib diisi." });

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      UPDATE orders SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${Number(orderId)}
    `;
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Gagal membatalkan: " + err.message });
  }
}
