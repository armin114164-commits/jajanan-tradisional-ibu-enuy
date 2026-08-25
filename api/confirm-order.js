/**
 * POST /api/confirm-order
 * Konfirmasi pembayaran → kurangi stok produk → update status order.
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

    // Ambil order
    const orders = await sql`SELECT * FROM orders WHERE id = ${Number(orderId)}`;
    if (orders.length === 0) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
    const order = orders[0];
    if (order.status !== "pending") return res.status(400).json({ error: "Pesanan sudah diproses sebelumnya." });

    const items = JSON.parse(order.items || "[]");

    // Kurangi stok — kelompokkan per productId dulu (bisa ada 2 varian wajik)
    const stockChanges = {}; // productId → total kg yg harus dikurangi

    for (const item of items) {
      const productId = item.productId;
      if (!productId) continue;

      // stockConvert: berapa unit stok (kg) per 1 qty item
      // default 1 (1 mika = 1 kg, 1 pack = 1 unit)
      const convert = item.stockConvert != null ? Number(item.stockConvert) : 1;
      const reduce  = item.qty * convert;

      stockChanges[productId] = (stockChanges[productId] || 0) + reduce;
    }

    for (const [productId, totalReduce] of Object.entries(stockChanges)) {
      const products = await sql`SELECT stock, status_label FROM products WHERE id = ${productId}`;
      if (products.length === 0) continue;
      const currentStock = products[0].stock;

      if (currentStock < 0) continue; // stock -1 = unlimited, skip

      const newStock       = Math.max(0, currentStock - totalReduce);
      const newStatus      = newStock === 0 ? "habis" : "ready";
      const newStatusLabel = newStock === 0 ? "Habis" : "Ready Stock";

      await sql`
        UPDATE products SET
          stock        = ${newStock},
          status       = ${newStatus},
          status_label = ${newStatusLabel},
          updated_at   = NOW()
        WHERE id = ${productId}
      `;
    }

    // Update status order → confirmed
    await sql`
      UPDATE orders SET status = 'confirmed', updated_at = NOW()
      WHERE id = ${Number(orderId)}
    `;

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Gagal konfirmasi: " + err.message });
  }
}
