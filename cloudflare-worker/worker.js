/**
 * Cloudflare Worker — proxy.enuyrasa.my.id
 *
 * Secrets yang harus diset di Cloudflare dashboard → Workers → Settings → Variables:
 *   DIGIFLAZZ_USERNAME  — username akun Digiflazz (japuhuope0GD)
 *   DIGIFLAZZ_API_KEY   — production API key Digiflazz
 *   WORKER_SECRET       — shared secret dari frontend (Ucup050205)
 *
 * Endpoints:
 *   POST /topup-pulsa   ← dipanggil langsung dari digital.html (bypass Vercel, buat signature di sini)
 *   POST /transaction   ← proxy pass dari Vercel (signature sudah dibuat di Vercel)
 *   POST /price-list    ← proxy pass dari Vercel
 *   POST /cek-saldo     ← proxy pass dari Vercel
 */

const DIGIFLAZZ_API = "https://api.digiflazz.com/v1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── MD5 pure-JS — Web Crypto tidak support MD5 di Workers runtime ──────────
function md5hex(str) {
  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff);
  }
  function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
  function cmn(q, a, b, x, s, t) { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function ff(a,b,c,d,x,s,t){ return cmn((b&c)|((~b)&d),a,b,x,s,t); }
  function gg(a,b,c,d,x,s,t){ return cmn((b&d)|(c&(~d)),a,b,x,s,t); }
  function hh(a,b,c,d,x,s,t){ return cmn(b^c^d,a,b,x,s,t); }
  function ii(a,b,c,d,x,s,t){ return cmn(c^(b|(~d)),a,b,x,s,t); }

  const msg8 = unescape(encodeURIComponent(str));
  const l    = msg8.length;
  const nb   = ((l + 8) >>> 6) + 1;
  const m    = new Array(nb * 16).fill(0);
  for (let i = 0; i < l; i++) m[i >> 2] |= msg8.charCodeAt(i) << ((i % 4) * 8);
  m[l >> 2] |= 0x80 << ((l % 4) * 8);
  m[nb * 16 - 2] = l * 8;

  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < m.length; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d];
    a=ff(a,b,c,d,m[i],   7,-680876936);  d=ff(d,a,b,c,m[i+1], 12,-389564586);
    c=ff(c,d,a,b,m[i+2], 17, 606105819); b=ff(b,c,d,a,m[i+3], 22,-1044525330);
    a=ff(a,b,c,d,m[i+4],  7,-176418897); d=ff(d,a,b,c,m[i+5], 12, 1200080426);
    c=ff(c,d,a,b,m[i+6], 17,-1473231341);b=ff(b,c,d,a,m[i+7], 22,-45705983);
    a=ff(a,b,c,d,m[i+8],  7, 1770035416);d=ff(d,a,b,c,m[i+9], 12,-1958414417);
    c=ff(c,d,a,b,m[i+10],17,-42063);     b=ff(b,c,d,a,m[i+11],22,-1990404162);
    a=ff(a,b,c,d,m[i+12], 7, 1804603682);d=ff(d,a,b,c,m[i+13],12,-40341101);
    c=ff(c,d,a,b,m[i+14],17,-1502002290);b=ff(b,c,d,a,m[i+15],22, 1236535329);
    a=gg(a,b,c,d,m[i+1],  5,-165796510); d=gg(d,a,b,c,m[i+6],  9,-1069501632);
    c=gg(c,d,a,b,m[i+11],14, 643717713); b=gg(b,c,d,a,m[i],   20,-373897302);
    a=gg(a,b,c,d,m[i+5],  5,-701558691); d=gg(d,a,b,c,m[i+10], 9, 38016083);
    c=gg(c,d,a,b,m[i+15],14,-660478335); b=gg(b,c,d,a,m[i+4], 20,-405537848);
    a=gg(a,b,c,d,m[i+9],  5, 568446438); d=gg(d,a,b,c,m[i+14], 9,-1019803690);
    c=gg(c,d,a,b,m[i+3], 14,-187363961); b=gg(b,c,d,a,m[i+8], 20, 1163531501);
    a=gg(a,b,c,d,m[i+13], 5,-1444681467);d=gg(d,a,b,c,m[i+2],  9,-51403784);
    c=gg(c,d,a,b,m[i+7], 14, 1735328473);b=gg(b,c,d,a,m[i+12],20,-1926607734);
    a=hh(a,b,c,d,m[i+5],  4,-378558);    d=hh(d,a,b,c,m[i+8], 11,-2022574463);
    c=hh(c,d,a,b,m[i+11],16, 1839030562);b=hh(b,c,d,a,m[i+14],23,-35309556);
    a=hh(a,b,c,d,m[i+1],  4,-1530992060);d=hh(d,a,b,c,m[i+4], 11, 1272893353);
    c=hh(c,d,a,b,m[i+7], 16,-155497632); b=hh(b,c,d,a,m[i+10],23,-1094730640);
    a=hh(a,b,c,d,m[i+13], 4, 681279174); d=hh(d,a,b,c,m[i],   11,-358537222);
    c=hh(c,d,a,b,m[i+3], 16,-722521979); b=hh(b,c,d,a,m[i+6], 23, 76029189);
    a=hh(a,b,c,d,m[i+9],  4,-640364487); d=hh(d,a,b,c,m[i+12],11,-421815835);
    c=hh(c,d,a,b,m[i+15],16, 530742520); b=hh(b,c,d,a,m[i+2], 23,-995338651);
    a=ii(a,b,c,d,m[i],    6,-198630844); d=ii(d,a,b,c,m[i+7], 10, 1126891415);
    c=ii(c,d,a,b,m[i+14],15,-1416354905);b=ii(b,c,d,a,m[i+5], 21,-57434055);
    a=ii(a,b,c,d,m[i+12], 6, 1700485571);d=ii(d,a,b,c,m[i+3], 10,-1894986606);
    c=ii(c,d,a,b,m[i+10],15,-1051523);   b=ii(b,c,d,a,m[i+1], 21,-2054922799);
    a=ii(a,b,c,d,m[i+8],  6, 1873313359);d=ii(d,a,b,c,m[i+15],10,-30611744);
    c=ii(c,d,a,b,m[i+6], 15,-1560198380);b=ii(b,c,d,a,m[i+13],21, 1309151649);
    a=ii(a,b,c,d,m[i+4],  6,-145523070); d=ii(d,a,b,c,m[i+11],10,-1120210379);
    c=ii(c,d,a,b,m[i+2], 15, 718787259); b=ii(b,c,d,a,m[i+9], 21,-343485551);
    a=safeAdd(a,oa); b=safeAdd(b,ob); c=safeAdd(c,oc); d=safeAdd(d,od);
  }
  const w2h = n => { let s=""; for(let j=0;j<4;j++) s+=("0"+((n>>(j*8))&0xff).toString(16)).slice(-2); return s; };
  return w2h(a)+w2h(b)+w2h(c)+w2h(d);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

function proxyRes(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

// ── POST /topup-pulsa — buat signature di Worker, kirim ke Digiflazz ───────
async function handleTopupPulsa(req, env) {
  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: "Body JSON tidak valid." }, 400); }

  // Cek secret dari frontend
  if (!body.workerSecret || body.workerSecret !== env.WORKER_SECRET)
    return jsonRes({ error: "Unauthorized." }, 401);

  const { customerName, customerWA, targetNumber, sku, price, notes } = body;
  if (!customerName || !customerWA) return jsonRes({ error: "Data pelanggan tidak lengkap." }, 400);
  if (!targetNumber || !sku)        return jsonRes({ error: "Nomor tujuan dan SKU wajib diisi." }, 400);

  const username   = env.DIGIFLAZZ_USERNAME;
  const prodApiKey = env.DIGIFLAZZ_API_KEY;
  if (!username || !prodApiKey) return jsonRes({ error: "Digiflazz belum dikonfigurasi." }, 503);

  const refId = "DIG-" + Date.now();
  const sign  = md5hex(username + prodApiKey + refId);

  let digiData = {};
  let httpStatus = 200;
  try {
    const r = await fetch(`${DIGIFLAZZ_API}/transaction`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        buyer_sku_code: sku,
        customer_no:    targetNumber,
        ref_id:         refId,
        sign
      })
    });
    httpStatus = r.status;
    digiData   = await r.json();
  } catch (e) {
    return jsonRes({ error: "Gagal menghubungi Digiflazz: " + e.message }, 502);
  }

  const tx              = digiData.data || {};
  const digiflazzStatus = tx.status || "Gagal";
  const internalStatus  =
    digiflazzStatus === "Sukses"  ? "success" :
    digiflazzStatus === "Pending" ? "pending"  : "failed";

  // Kembalikan semua info ke frontend (DB & notif WA ditangani Vercel via webhook)
  return jsonRes({
    success:  internalStatus !== "failed",
    refId,
    status:   internalStatus,
    message:  tx.message || digiData.message || "",
    sn:       tx.sn || "",
    rc:       tx.rc || "",
    // Info lengkap untuk dicatat frontend / Vercel jika perlu
    customerName,
    customerWA,
    targetNumber,
    sku,
    price,
    notes: notes || "",
    raw: digiData
  });
}

// ── POST /transaction — proxy pass (signature sudah dibuat Vercel) ──────────
async function handleTransaction(req) {
  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: "Body tidak valid." }, 400); }
  const r    = await fetch(`${DIGIFLAZZ_API}/transaction`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return proxyRes(await r.json(), r.status);
}

// ── POST /price-list ────────────────────────────────────────────────────────
async function handlePriceList(req) {
  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: "Body tidak valid." }, 400); }
  const r = await fetch(`${DIGIFLAZZ_API}/price-list`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return proxyRes(await r.json(), r.status);
}

// ── POST /cek-saldo ─────────────────────────────────────────────────────────
async function handleCekSaldo(req) {
  let body;
  try { body = await req.json(); } catch { return jsonRes({ error: "Body tidak valid." }, 400); }
  const r = await fetch(`${DIGIFLAZZ_API}/cek-saldo`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return proxyRes(await r.json(), r.status);
}

// ── Main ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS_HEADERS });

    if (request.method !== "POST")
      return jsonRes({ error: "Method not allowed" }, 405);

    if (path === "/topup-pulsa") return handleTopupPulsa(request, env);
    if (path === "/transaction") return handleTransaction(request);
    if (path === "/price-list")  return handlePriceList(request);
    if (path === "/cek-saldo")   return handleCekSaldo(request);

    return jsonRes({ error: "Endpoint tidak ditemukan", path }, 404);
  }
};
