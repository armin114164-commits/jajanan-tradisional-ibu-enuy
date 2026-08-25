/**
 * POST /api/order-action
 * Gabungan confirm-order + cancel-order
 * Body: { action: "confirm"|"cancel", orderId }
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
  if (token !== adminToken) return res.status(401).json({ error: "Token tidak valid." });

  const { action, orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: "Order ID wajib diisi." });
  if (!["confirm", "cancel"].includes(action))
    return res.status(400).json({ error: "Action harus confirm atau cancel." });

  try {
    const sql = neon(process.env.DATABASE_URL);

    // ── CANCEL ──────────────────────────────────────────────────
    if (action === "cancel") {
      await sql`UPDATE orders SET status='cancelled', updated_at=NOW() WHERE id=${Number(orderId)}`;
      return res.status(200).json({ success: true });
    }

    // ── CONFIRM ─────────────────────────────────────────────────
    const orders = await sql`SELECT * FROM orders WHERE id=${Number(orderId)}`;
    if (orders.length === 0) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
    const order = orders[0];
    if (order.status !== "pending")
      return res.status(400).json({ error: "Pesanan sudah diproses sebelumnya." });

    const items = JSON.parse(order.items || "[]");
    const stockChanges = {};
    for (const item of items) {
      if (!item.productId) continue;
      const convert = item.stockConvert != null ? Number(item.stockConvert) : 1;
      stockChanges[item.productId] = (stockChanges[item.productId] || 0) + item.qty * convert;
    }
    for (const [productId, totalReduce] of Object.entries(stockChanges)) {
      const prods = await sql`SELECT stock FROM products WHERE id=${productId}`;
      if (!prods.length || prods[0].stock < 0) continue;
      const newStock = Math.max(0, prods[0].stock - totalReduce);
      await sql`UPDATE products SET
        stock=${newStock}, status=${newStock===0?"habis":"ready"},
        status_label=${newStock===0?"Habis":"Ready Stock"}, updated_at=NOW()
        WHERE id=${productId}`;
    }
    await sql`UPDATE orders SET status='confirmed', updated_at=NOW() WHERE id=${Number(orderId)}`;
    return res.status(200).json({ success: true });

  } catch (err) {
    return res.status(500).json({ error: "Gagal: " + err.message });
  }
}
