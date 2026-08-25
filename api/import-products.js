/**
 * POST /api/import-products
 * Upload CSV/Excel → UPSERT ke Neon Postgres
 */

import { neon } from "@neondatabase/serverless";
import formidable from "formidable";
import XLSX from "xlsx";
import fs from "fs";

export const config = { api: { bodyParser: false } };

function slugify(text) {
  return String(text).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60);
}

function parseFile(filepath) {
  const buffer   = fs.readFileSync(filepath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  const raw      = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (raw.length < 2) return [];
  const headers = raw[0].map((h) => String(h).trim().toLowerCase());
  const data = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (r.every((v) => v === "" || v == null)) continue;
    const obj = { __row: i + 1 };
    headers.forEach((h, idx) => { obj[h] = r[idx] != null ? String(r[idx]).trim() : ""; });
    data.push(obj);
  }
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token      = (req.headers["x-admin-token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return res.status(500).json({ error: "Server tidak terkonfigurasi." });
  if (token !== adminToken) return res.status(401).json({ error: "Token admin tidak valid." });

  const form = formidable({ maxFileSize: 5 * 1024 * 1024 });
  const [, files] = await form.parse(req);
  const file = Array.isArray(files.file) ? files.file[0] : files.file;

  if (!file) return res.status(400).json({ error: "File tidak ditemukan." });

  const ext = (file.originalFilename || "").split(".").pop().toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(ext)) {
    return res.status(400).json({ error: "Format tidak didukung. Gunakan CSV atau Excel." });
  }

  let rows;
  try { rows = parseFile(file.filepath); }
  catch (err) { return res.status(400).json({ error: "Gagal parse file: " + err.message }); }

  if (rows.length === 0) return res.status(400).json({ error: "File kosong atau hanya header." });

  const validRows = [], skipped = [];
  for (const row of rows) {
    const rowNum = row.__row;
    const name   = row["name"] || row["nama"] || "";
    if (!name) { skipped.push({ row: rowNum, reason: "Kolom 'name' kosong" }); continue; }
    const rawPrice = row["price"] || row["harga"] || "";
    const price    = parseInt(String(rawPrice).replace(/[^0-9]/g, ""), 10);
    if (!rawPrice || isNaN(price) || price < 0) {
      skipped.push({ row: rowNum, reason: `Kolom 'price' tidak valid: "${rawPrice}"` }); continue;
    }
    const rawId = row["id"] || "";
    const id    = rawId ? slugify(rawId) : slugify(name);
    if (!id) { skipped.push({ row: rowNum, reason: "Tidak bisa membuat id" }); continue; }
    const desc        = row["desc"] || row["description"] || row["deskripsi"] || "";
    const img         = row["img"] || row["image"] || row["gambar"] || "";
    const rawStatus   = (row["status"] || "ready").toLowerCase();
    const status      = ["ready", "preorder"].includes(rawStatus) ? rawStatus : "ready";
    const statusLabel = row["statuslabel"] || row["status_label"] || row["label"] ||
                        (status === "preorder" ? "Pre Order" : "Ready Stock");
    validRows.push({ id, name, price, desc, img, status, statusLabel });
  }

  if (validRows.length === 0) return res.status(400).json({ error: "Tidak ada baris valid.", skipped });

  try {
    const sql = neon(process.env.DATABASE_URL);
    const countRows = await sql`SELECT COUNT(*) AS count FROM products`;
    let sortBase = Number(countRows[0].count);

    for (const p of validRows) {
      await sql`
        INSERT INTO products (id, name, price, description, img, status, status_label, sort_order, updated_at)
        VALUES (${p.id}, ${p.name}, ${p.price}, ${p.desc}, ${p.img}, ${p.status}, ${p.statusLabel}, ${++sortBase}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name, price=EXCLUDED.price, description=EXCLUDED.description,
          img=EXCLUDED.img, status=EXCLUDED.status, status_label=EXCLUDED.status_label, updated_at=NOW()
      `;
    }
    return res.status(200).json({ updated: validRows.length, skipped });
  } catch (err) {
    return res.status(500).json({ error: "Gagal menyimpan: " + err.message });
  }
}
