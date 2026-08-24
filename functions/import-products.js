/**
 * POST /api/admin/import-products  →  /.netlify/functions/import-products
 *
 * Menerima upload file CSV atau Excel (.xlsx/.xls) dari halaman admin.html,
 * mem-parse baris per baris, lalu melakukan UPSERT ke tabel products.
 *
 * Headers wajib:
 *   x-admin-token: <token> — dibandingkan dengan env var ADMIN_TOKEN
 *
 * Body: multipart/form-data dengan field "file"
 *
 * Response JSON:
 *   { updated: number, skipped: [{row, reason}] }
 */

const { getDatabase } = require("@netlify/database");
const XLSX            = require("xlsx");
const Busboy          = require("busboy");

// ─── helpers ─────────────────────────────────────────────────────────────────

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function parseBuffer(buffer, filename) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  const raw      = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (raw.length < 2) return [];

  const headers = raw[0].map((h) => String(h).trim().toLowerCase());
  const data    = [];

  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (r.every((v) => v === "" || v == null)) continue;
    const obj = { __row: i + 1 };
    headers.forEach((h, idx) => { obj[h] = r[idx] != null ? String(r[idx]).trim() : ""; });
    data.push(obj);
  }
  return data;
}

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: { "content-type": event.headers["content-type"] || event.headers["Content-Type"] },
    });

    let fileBuffer = null;
    let filename   = "";

    busboy.on("file", (_field, stream, info) => {
      filename = info.filename || "";
      const chunks = [];
      stream.on("data", (d) => chunks.push(d));
      stream.on("end",  ()  => { fileBuffer = Buffer.concat(chunks); });
    });

    busboy.on("finish", () => resolve({ fileBuffer, filename }));
    busboy.on("error",  (err) => reject(err));

    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body || "", "utf-8");

    busboy.write(body);
    busboy.end();
  });
}

function jsonResp(data, statusCode = 200) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

// ─── handler ─────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  // Auth
  const token      = (event.headers["x-admin-token"] || event.headers["X-Admin-Token"] || "").trim();
  const adminToken = (process.env.ADMIN_TOKEN || "").trim();
  if (!adminToken) return jsonResp({ error: "Server tidak terkonfigurasi." }, 500);
  if (token !== adminToken) return jsonResp({ error: "Token admin tidak valid." }, 401);

  // Parse multipart
  let fileBuffer, filename;
  try {
    ({ fileBuffer, filename } = await parseMultipart(event));
  } catch (err) {
    return jsonResp({ error: "Gagal membaca file: " + err.message }, 400);
  }

  if (!fileBuffer) return jsonResp({ error: "File tidak ditemukan dalam request." }, 400);

  const ext = (filename || "").split(".").pop().toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(ext)) {
    return jsonResp({ error: "Format tidak didukung. Gunakan CSV atau Excel." }, 400);
  }

  // Parse isi file
  let rows;
  try { rows = parseBuffer(fileBuffer, filename); }
  catch (err) { return jsonResp({ error: "Gagal parse file: " + err.message }, 400); }

  if (rows.length === 0) return jsonResp({ error: "File kosong atau hanya header." }, 400);

  // Validasi baris
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

  if (validRows.length === 0) return jsonResp({ error: "Tidak ada baris valid.", skipped }, 400);

  // UPSERT ke DB
  try {
    const db = getDatabase({ connectionString: process.env.NETLIFY_DB_URL });
    const countResult = await db.sql`SELECT COUNT(*) AS count FROM products`;
    let sortBase = Number(countResult.rows[0].count);

    for (const p of validRows) {
      await db.sql`
        INSERT INTO products (id, name, price, description, img, status, status_label, sort_order, updated_at)
        VALUES (${p.id}, ${p.name}, ${p.price}, ${p.desc}, ${p.img}, ${p.status}, ${p.statusLabel}, ${++sortBase}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name         = EXCLUDED.name,
          price        = EXCLUDED.price,
          description  = EXCLUDED.description,
          img          = EXCLUDED.img,
          status       = EXCLUDED.status,
          status_label = EXCLUDED.status_label,
          updated_at   = NOW()
      `;
    }

    return jsonResp({ updated: validRows.length, skipped });
  } catch (err) {
    console.error("[import-products] DB error:", err);
    return jsonResp({ error: "Gagal menyimpan ke database: " + err.message }, 500);
  }
};
