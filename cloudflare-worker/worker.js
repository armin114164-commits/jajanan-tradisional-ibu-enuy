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

// ── Utility: MD5 pure-JS (Cloudflare Workers tidak support crypto.subtle MD5) ─
// Implementasi RFC 1321
function md5hex(str) {
  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff);
  }
  function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a,b,c,d,x,s,t){ return md5cmn((b&c)|((~b)&d),a,b,x,s,t); }
  function md5gg(a,b,c,d,x,s,t){ return md5cmn((b&d)|(c&(~d)),a,b,x,s,t); }
  function md5hh(a,b,c,d,x,s,t){ return md5cmn(b^c^d,a,b,x,s,t); }
  function md5ii(a,b,c,d,x,s,t){ return md5cmn(c^(b|(~d)),a,b,x,s,t); }

  // UTF-8 encode
  const msg8 = unescape(encodeURIComponent(str));
  const len8  = msg8.length;
  const nBlks = ((len8 + 8) >>> 6) + 1;
  const blks  = new Array(nBlks * 16).fill(0);
  for (let i = 0; i < len8; i++) blks[i >> 2] |= msg8.charCodeAt(i) << ((i % 4) * 8);
  blks[len8 >> 2] |= 0x80 << ((len8 % 4) * 8);
  blks[nBlks * 16 - 2] = len8 * 8;

  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < blks.length; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d];
    a=md5ff(a,b,c,d,blks[i+ 0], 7,-680876936);  d=md5ff(d,a,b,c,blks[i+ 1],12,-389564586);
    c=md5ff(c,d,a,b,blks[i+ 2],17, 606105819);  b=md5ff(b,c,d,a,blks[i+ 3],22,-1044525330);
    a=md5ff(a,b,c,d,blks[i+ 4], 7,-176418897);  d=md5ff(d,a,b,c,blks[i+ 5],12, 1200080426);
    c=md5ff(c,d,a,b,blks[i+ 6],17,-1473231341); b=md5ff(b,c,d,a,blks[i+ 7],22,-45705983);
    a=md5ff(a,b,c,d,blks[i+ 8], 7, 1770035416); d=md5ff(d,a,b,c,blks[i+ 9],12,-1958414417);
    c=md5ff(c,d,a,b,blks[i+10],17,-42063);       b=md5ff(b,c,d,a,blks[i+11],22,-1990404162);
    a=md5ff(a,b,c,d,blks[i+12], 7, 1804603682); d=md5ff(d,a,b,c,blks[i+13],12,-40341101);
    c=md5ff(c,d,a,b,blks[i+14],17,-1502002290); b=md5ff(b,c,d,a,blks[i+15],22, 1236535329);
    a=md5gg(a,b,c,d,blks[i+ 1], 5,-165796510);  d=md5gg(d,a,b,c,blks[i+ 6], 9,-1069501632);
    c=md5gg(c,d,a,b,blks[i+11],14, 643717713);  b=md5gg(b,c,d,a,blks[i+ 0],20,-373897302);
    a=md5gg(a,b,c,d,blks[i+ 5], 5,-701558691);  d=md5gg(d,a,b,c,blks[i+10], 9, 38016083);
    c=md5gg(c,d,a,b,blks[i+15],14,-660478335);  b=md5gg(b,c,d,a,blks[i+ 4],20,-405537848);
    a=md5gg(a,b,c,d,blks[i+ 9], 5, 568446438);  d=md5gg(d,a,b,c,blks[i+14], 9,-1019803690);
    c=md5gg(c,d,a,b,blks[i+ 3],14,-187363961);  b=md5gg(b,c,d,a,blks[i+ 8],20, 1163531501);
    a=md5gg(a,b,c,d,blks[i+13], 5,-1444681467); d=md5gg(d,a,b,c,blks[i+ 2], 9,-51403784);
    c=md5gg(c,d,a,b,blks[i+ 7],14, 1735328473); b=md5gg(b,c,d,a,blks[i+12],20,-1926607734);
    a=md5hh(a,b,c,d,blks[i+ 5], 4,-378558);     d=md5hh(d,a,b,c,blks[i+ 8],11,-2022574463);
    c=md5hh(c,d,a,b,blks[i+11],16, 1839030562); b=md5hh(b,c,d,a,blks[i+14],23,-35309556);
    a=md5hh(a,b,c,d,blks[i+ 1], 4,-1530992060); d=md5hh(d,a,b,c,blks[i+ 4],11, 1272893353);
    c=md5hh(c,d,a,b,blks[i+ 7],16,-155497632);  b=md5hh(b,c,d,a,blks[i+10],23,-1094730640);
    a=md5hh(a,b,c,d,blks[i+13], 4, 681279174);  d=md5hh(d,a,b,c,blks[i+ 0],11,-358537222);
    c=md5hh(c,d,a,b,blks[i+ 3],16,-722521979);  b=md5hh(b,c,d,a,blks[i+ 6],23, 76029189);
    a=md5hh(a,b,c,d,blks[i+ 9], 4,-640364487);  d=md5hh(d,a,b,c,blks[i+12],11,-421815835);
    c=md5hh(c,d,a,b,blks[i+15],16, 530742520);  b=md5hh(b,c,d,a,blks[i+ 2],23,-995338651);
    a=md5ii(a,b,c,d,blks[i+ 0], 6,-198630844);  d=md5ii(d,a,b,c,blks[i+ 7],10, 1126891415);
    c=md5ii(c,d,a,b,blks[i+14],15,-1416354905); b=md5ii(b,c,d,a,blks[i+ 5],21,-57434055);
    a=md5ii(a,b,c,d,blks[i+12], 6, 1700485571); d=md5ii(d,a,b,c,blks[i+ 3],10,-1894986606);
    c=md5ii(c,d,a,b,blks[i+10],15,-1051523);    b=md5ii(b,c,d,a,blks[i+ 1],21,-2054922799);
    a=md5ii(a,b,c,d,blks[i+ 8], 6, 1873313359); d=md5ii(d,a,b,c,blks[i+15],10,-30611744);
    c=md5ii(c,d,a,b,blks[i+ 6],15,-1560198380); b=md5ii(b,c,d,a,blks[i+13],21, 1309151649);
    a=md5ii(a,b,c,d,blks[i+ 4], 6,-145523070);  d=md5ii(d,a,b,c,blks[i+11],10,-1120210379);
    c=md5ii(c,d,a,b,blks[i+ 2],15, 718787259);  b=md5ii(b,c,d,a,blks[i+ 9],21,-343485551);
    a=safeAdd(a,oa); b=safeAdd(b,ob); c=safeAdd(c,oc); d=safeAdd(d,od);
  }

  // Convert to hex string (little-endian per word)
  const hex = (n) => {
    let s = "";
    for (let j = 0; j < 4; j++) s += ("0" + ((n >> (j*8)) & 0xff).toString(16)).slice(-2);
    return s;
  };
  return hex(a) + hex(b) + hex(c) + hex(d);
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
  const sign  = md5hex(username + prodApiKey + refId);

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
