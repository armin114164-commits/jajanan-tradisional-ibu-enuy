/**
 * /api/orders — Multi-method handler
 *
 * POST /api/orders  (no body / verify intent)  → verify token admin
 * GET  /api/orders  ?status=all|pending|...    → list pesanan (admin)
 * POST /api/orders  {action:"create-order"}    → buat pesanan baru (publik)
 * POST /api/orders  {action:"confirm",orderId} → konfirmasi pesanan (admin)
 * POST /api/orders  {action:"cancel",orderId}  → batalkan pesanan (admin)
 *
 * Tambah action baru di masa depan cukup di file ini.
 */

import { neon } from "@neondatabase/serverless";

function checkAdmin(req) {
  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN       || "").trim();
  const superToken = (process.env.SUPER_ADMIN_TOKEN  || "").trim();
  if (!adminToken) return { error: "Server tidak terkonfigurasi.", status: 500 };
  if (token === (superToken || adminToken) || token === adminToken) return null;
  return { error: "Token tidak valid.", status: 401 };
}

async function sendWA(msg) {
  const fonnteToken = process.env.FONNTE_TOKEN;
  const adminWARaw  = process.env.ADMIN_WA || "";
  if (!fonnteToken || !adminWARaw) return;
  const targets = adminWARaw.split(",").map(n => n.trim()).filter(Boolean);
  await Promise.all(targets.map(t =>
    fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { "Authorization": fonnteToken, "Content-Type": "application/json" },
      body: JSON.stringify({ target: t, message: msg })
    }).catch(() => {})
  ));
}

export default async function handler(req, res) {
  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN       || "").trim();
  const superToken = (process.env.SUPER_ADMIN_TOKEN  || "").trim();

  // ── POST ──────────────────────────────────────────────────────
  if (req.method === "POST") {
    const body   = req.body || {};
    const action = body.action;

    // ── verify token (login admin) ─────────────────────────────
    if (!action) {
      if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
      if (superToken && token === superToken)
        return res.status(200).json({ success: true, role: "super_admin" });
      if (token === adminToken)
        return res.status(200).json({ success: true, role: superToken ? "admin" : "super_admin" });
      return res.status(401).json({ error: "Token tidak valid." });
    }

    // ── create-order (publik, dari halaman checkout) ────────────
    if (action === "create-order") {
      const { customerName, customerWA, customerAddr, items, total, paymentMethod } = body;
      if (!customerName || !customerWA || !customerAddr)
        return res.status(400).json({ error: "Data pelanggan tidak lengkap." });
      if (!items || !Array.isArray(items) || items.length === 0)
        return res.status(400).json({ error: "Pesanan kosong." });
      if (!total || isNaN(Number(total)))
        return res.status(400).json({ error: "Total tidak valid." });
      try {
        const sql    = neon(process.env.DATABASE_URL);
        const result = await sql`
          INSERT INTO orders (customer_name,customer_wa,customer_addr,items,total,payment_method,status)
          VALUES (${customerName},${customerWA},${customerAddr},${JSON.stringify(items)},${Number(total)},${paymentMethod||""},'pending')
          RETURNING id`;
        const orderId  = result[0].id;
        const itemLines = items.map(i => `• ${i.qty}× ${i.name} = Rp ${i.subtotal.toLocaleString("id-ID")}`).join("\n");
        await sendWA(
          `🛒 *PESANAN BARU #${orderId}*\n━━━━━━━━━━━━━━━━\n` +
          `👤 *Nama:* ${customerName}\n📱 *WA:* ${customerWA}\n📍 *Alamat:* ${customerAddr}\n` +
          `💳 *Bayar via:* ${paymentMethod}\n\n📦 *Item:*\n${itemLines}\n\n` +
          `💰 *Total: Rp ${Number(total).toLocaleString("id-ID")}*\n━━━━━━━━━━━━━━━━\n` +
          `Buka admin: https://enuyrasa.my.id/admin.html`
        );
        return res.status(200).json({ success: true, orderId });
      } catch (err) {
        return res.status(500).json({ error: "Gagal menyimpan pesanan: " + err.message });
      }
    }

    // ── confirm / cancel (admin only) ───────────────────────────
    if (action === "confirm" || action === "cancel") {
      const authErr = checkAdmin(req);
      if (authErr) return res.status(authErr.status).json({ error: authErr.error });
      const { orderId } = body;
      if (!orderId) return res.status(400).json({ error: "Order ID wajib diisi." });
      try {
        const sql = neon(process.env.DATABASE_URL);
        if (action === "cancel") {
          await sql`UPDATE orders SET status='cancelled',updated_at=NOW() WHERE id=${Number(orderId)}`;
          return res.status(200).json({ success: true });
        }
        // confirm
        const rows = await sql`SELECT * FROM orders WHERE id=${Number(orderId)}`;
        if (!rows.length) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
        if (rows[0].status !== "pending") return res.status(400).json({ error: "Pesanan sudah diproses." });
        const items = JSON.parse(rows[0].items || "[]");
        const sc    = {};
        for (const i of items) {
          if (!i.productId) continue;
          sc[i.productId] = (sc[i.productId] || 0) + i.qty * (i.stockConvert ?? 1);
        }
        for (const [pid, reduce] of Object.entries(sc)) {
          const p = await sql`SELECT stock FROM products WHERE id=${pid}`;
          if (!p.length || p[0].stock < 0) continue;
          const ns = Math.max(0, p[0].stock - reduce);
          await sql`UPDATE products SET stock=${ns},status=${ns===0?"habis":"ready"},status_label=${ns===0?"Habis":"Ready Stock"},updated_at=NOW() WHERE id=${pid}`;
        }
        await sql`UPDATE orders SET status='confirmed',updated_at=NOW() WHERE id=${Number(orderId)}`;
        return res.status(200).json({ success: true });
      } catch (err) {
        return res.status(500).json({ error: "Gagal: " + err.message });
      }
    }

    return res.status(400).json({ error: `Action "${action}" tidak dikenal.` });
  }

  // ── GET: list pesanan (admin) ──────────────────────────────────
  if (req.method === "GET") {
    const authErr = checkAdmin(req);
    if (authErr) return res.status(authErr.status).json({ error: authErr.error });
    const status = req.query.status || "all";
    try {
      const sql  = neon(process.env.DATABASE_URL);
      const rows = status === "all"
        ? await sql`SELECT * FROM orders ORDER BY created_at DESC`
        : await sql`SELECT * FROM orders WHERE status=${status} ORDER BY created_at DESC`;
      return res.status(200).json(rows.map(o => ({ ...o, items: o.items ? JSON.parse(o.items) : [] })));
    } catch (err) {
      return res.status(500).json({ error: "Gagal memuat pesanan: " + err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
