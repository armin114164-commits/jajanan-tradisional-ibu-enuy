/**
 * POST /api/verify-token
 * Verifikasi token admin.
 * Returns: { success: true, role: "super_admin" | "admin" }
 *
 * Role logic:
 *  - SUPER_ADMIN_TOKEN (jika diset): akses penuh — hapus produk, setup-db, dll.
 *  - ADMIN_TOKEN: akses standar — kelola pesanan & konfirmasi.
 *  - Jika SUPER_ADMIN_TOKEN tidak diset, ADMIN_TOKEN berlaku sebagai super admin.
 */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN       || "").trim();
  const superToken = (process.env.SUPER_ADMIN_TOKEN  || "").trim();

  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });

  // Super admin check
  if (superToken && token === superToken)
    return res.status(200).json({ success: true, role: "super_admin" });

  // Regular admin check
  if (token === adminToken) {
    // Jika SUPER_ADMIN_TOKEN tidak diset, ADMIN_TOKEN = super admin
    const role = superToken ? "admin" : "super_admin";
    return res.status(200).json({ success: true, role });
  }

  return res.status(401).json({ error: "Token tidak valid." });
}
