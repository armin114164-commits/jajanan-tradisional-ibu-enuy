/**
 * Cloudflare Worker — proxy.enuyrasa.my.id
 *
 * Secrets yang harus diset di Cloudflare dashboard → Workers → Settings → Variables:
 *   DIGIFLAZZ_USERNAME  — username akun Digiflazz (japuhuope0GD)
 *   DIGIFLAZZ_API_KEY   — production API key Digiflazz
 *   DATABASE_URL        — Neon Postgres connection string
 *   WORKER_SECRET       — shared secret untuk autentikasi dari frontend (Ucup050205)
 *
 * Endpoints:
 *   POST /topup-pulsa   ← dipanggil langsung dari digital.html (bypass Vercel)
 *   POST /transaction   ← dipanggil dari Vercel api/digiflazz-*.js
 *   POST /price-list    ← dipanggil dari api/digiflazz-products.js
 *   POST /cek-saldo     ← dipanggil dari api/digiflazz-admin.js
 *
 * IP Cloudflare Worker yang perlu di-whitelist di Digiflazz:
 *   104.21.52.168
 *   172.67.201.142
 */

const DIGIFLAZZ_API = "https://api.digiflazz.com/v1";
const CORS_HEADERS  = {
  "Access-Control-Allow-Origin":  "https://enuyrasa.my.id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Utility: MD5 via Web Crypto (tersedia di Workers) ──────────────────────
async function md5hex(str) {
  const encoder = new TextEncoder();
  const data    = encoder.encode(str);
  const buf     = await crypto.subtle.digest("MD5", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Utility: kirim JSON response ───────────────────────────────────────────
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

// ── Utility: simpan transaksi ke Neon DB ───────────────────────────────────
async function saveToDb(env, row) {
  if (!env.DATABASE_URL) return null;
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(env.DATABASE_URL);
    const result = await sql`
      INSERT INTO digital_orders
        (ref_id, customer_name, customer_wa, target_number, sku, price,
         notes, status, digiflazz_status, digiflazz_message, digiflazz_sn,
         raw_response, provider, created_at)
      VALUES (
        ${row.refId},
        ${row.customerName},
        ${row.customerWA},
        ${row.targetNumber},
        ${row.sku},
        ${row.price || 0},
        ${row.notes || ""},
        ${row.status},
        ${row.digiflazzStatus || ""},
        ${row.message || ""},
        ${row.sn || ""},
        ${row.rawResponse || "{}"},
        'digiflazz',
        NOW()
      )
      RETURNING id
    `;
    return result[0]?.id;
  } catch (e) {
    console.error("DB error:", e.message);
    return null;
  }
}

// ── Utility: kirim notif WA via Fonnte ────────────────────────────────────
async function notifWA(fonnteToken, target, message) {
  if (!fonnteToken || !target) return;
  try {
    await fetch("https://api.fonnte.com/send", {
      method:  "POST",
      headers: { "Authorization": fonnteToken, "Content-Type": "application/json" },
      body:    JSON.stringify({ target, message })
    });
  } catch (e) { /* silent */ }
}

// ── Handler: POST /topup-pulsa ─────────────────────────────────────────────
async function handleTopupPulsa(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: "Body JSON tidak valid." }, 400); }

  // Auth via workerSecret
  if (!body.workerSecret || body.workerSecret !== env.WORKER_SECRET)
    return jsonRes({ error: "Unauthorized." }, 401);

  const { customerName, customerWA, targetNumber, sku, price, notes } = body;
  if (!customerName || !customerWA) return jsonRes({ error: "Data pelanggan tidak lengkap." }, 400);
  if (!targetNumber || !sku)       return jsonRes({ error: "Nomor tujuan dan SKU wajib diisi." }, 400);

  const username   = env.DIGIFLAZZ_USERNAME;
  const prodApiKey = env.DIGIFLAZZ_API_KEY;
  if (!username || !prodApiKey) return jsonRes({ error: "Digiflazz belum dikonfigurasi." }, 503);

  const refId = "DIG-" + Date.now();
  const sign  = await md5hex(username + prodApiKey + refId);

  const txBody = {
    username,
    buyer_sku_code: sku,
    customer_no:    targetNumber,
    ref_id:         refId,
    sign
    // TIDAK ada field testing — ini production
  };

  let digiData = {};
  try {
    const r = await fetch(`${DIGIFLAZZ_API}/transaction`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(txBody)
    });
    digiData = await r.json();
  } catch (e) {
    return jsonRes({ error: "Gagal menghubungi Digiflazz: " + e.message }, 502);
  }

  const tx             = digiData.data || {};
  const digiflazzStatus = tx.status || "Gagal";
  const internalStatus  =
    digiflazzStatus === "Sukses"  ? "success" :
    digiflazzStatus === "Pending" ? "pending"  : "failed";

  // Simpan ke DB
  const orderId = await saveToDb(env, {
    refId, customerName, customerWA, targetNumber, sku,
    price: Number(price) || 0, notes: notes || "",
    status: internalStatus, digiflazzStatus,
    message: tx.message || "", sn: tx.sn || "",
    rawResponse: JSON.stringify(digiData)
  });

  // Notif WA admin
  if (env.FONNTE_TOKEN && env.ADMIN_WA) {
    const emoji = internalStatus === "success" ? "✅" : internalStatus === "pending" ? "⏳" : "❌";
    const msg =
      `${emoji} *TOP-UP PULSA #${orderId || refId}*\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `👤 *Pelanggan:* ${customerName}\n` +
      `📱 *WA:* ${customerWA}\n` +
      `📲 *Nomor Tujuan:* ${targetNumber}\n` +
      `📦 *SKU:* ${sku}\n` +
      `💰 *Harga:* Rp ${Number(price||0).toLocaleString("id-ID")}\n` +
      `📊 *Status:* ${digiflazzStatus}\n` +
      `🔖 *Ref ID:* ${refId}\n` +
      (tx.sn    ? `✅ *SN:* ${tx.sn}\n`        : "") +
      (tx.message ? `💬 *Pesan:* ${tx.message}\n` : "") +
      `━━━━━━━━━━━━━━━━\n` +
      `https://enuyrasa.my.id/admin.html`;

    await notifWA(env.FONNTE_TOKEN, env.ADMIN_WA, msg);
  }

  return jsonRes({
    success: internalStatus !== "failed",
    orderId,
    refId,
    status:  internalStatus,
    message: tx.message || "",
    sn:      tx.sn || "",
    rc:      tx.rc || ""
  });
}

// ── Handler: POST /transaction (dipanggil dari Vercel) ─────────────────────
async function handleTransaction(req) {
  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: "Body JSON tidak valid." }, 400); }
  const r = await fetch(`${DIGIFLAZZ_API}/transaction`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body)
  });
  const data = await r.json();
  return jsonRes(data, r.status);
}

// ── Handler: POST /price-list (dipanggil dari Vercel) ──────────────────────
async function handlePriceList(req) {
  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: "Body JSON tidak valid." }, 400); }
  const r = await fetch(`${DIGIFLAZZ_API}/price-list`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body)
  });
  const data = await r.json();
  return jsonRes(data, r.status);
}

// ── Handler: POST /cek-saldo (dipanggil dari Vercel) ──────────────────────
async function handleCekSaldo(req) {
  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: "Body JSON tidak valid." }, 400); }
  const r = await fetch(`${DIGIFLAZZ_API}/cek-saldo`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body)
  });
  const data = await r.json();
  return jsonRes(data, r.status);
}

// ── Main fetch handler ─────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (method !== "POST") {
      return jsonRes({ error: "Method not allowed" }, 405);
    }

    if (path === "/topup-pulsa")  return handleTopupPulsa(request, env);
    if (path === "/transaction")  return handleTransaction(request);
    if (path === "/price-list")   return handlePriceList(request);
    if (path === "/cek-saldo")    return handleCekSaldo(request);

    return jsonRes({ error: "Endpoint tidak ditemukan", path }, 404);
  }
};
