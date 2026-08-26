<?php
/**
 * proxy.php — Digiflazz PHP Proxy
 * Upload ke: /public_html/ di cPanel Domainesia
 * Subdomain : digiflazz.enuyrasa.my.id → /public_html/
 *
 * Endpoint:
 *   POST /transaction   → https://api.digiflazz.com/v1/transaction
 *   POST /price-list    → https://api.digiflazz.com/v1/price-list
 *   POST /cek-saldo     → https://api.digiflazz.com/v1/cek-saldo
 *   GET  /ping          → health check
 *
 * Konfigurasi: edit bagian CONFIG di bawah, ATAU gunakan environment variable
 * lewat cPanel → Software → PHP Config → php.ini / .htaccess setenv
 *
 * Keamanan:
 *   - PROXY_SECRET wajib dikirim oleh Vercel di header X-Proxy-Secret
 *   - Jika dikosongkan, proxy menerima semua request (tidak direkomendasikan)
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Isi manual di sini ATAU pakai env var (lebih aman, tidak tercommit ke Git)
define('PROXY_SECRET',   getenv('PROXY_SECRET')   ?: '');   // shared secret antara Vercel ↔ PHP proxy
define('DIGIFLAZZ_API', 'https://api.digiflazz.com/v1');
// ─────────────────────────────────────────────────────────────────────────────

// CORS — izinkan semua origin karena dipanggil dari Vercel (server-side)
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Proxy-Secret');
header('Content-Type: application/json; charset=utf-8');

// Preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Routing ───────────────────────────────────────────────────────────────────
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
// Hapus leading slash dan direktori jika proxy.php bukan di root
// misal: /proxy.php → '' | /transaction → 'transaction'
$path = trim(preg_replace('#^/proxy\.php#', '', $path), '/');

// GET /ping — health check
if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($path === 'ping' || $path === '')) {
    echo json_encode([
        'ok'     => true,
        'proxy'  => 'digiflazz.enuyrasa.my.id',
        'php'    => PHP_VERSION,
        'time'   => date('c'),
    ]);
    exit;
}

// Hanya terima POST dari sini
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// ── Verifikasi shared secret ───────────────────────────────────────────────────
$secret = defined('PROXY_SECRET') ? PROXY_SECRET : '';
if ($secret !== '') {
    $provided = $_SERVER['HTTP_X_PROXY_SECRET'] ?? '';
    if ($provided !== $secret) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
}

// ── Baca body JSON ─────────────────────────────────────────────────────────────
$rawBody = file_get_contents('php://input');
$body    = json_decode($rawBody, true);
if ($body === null && $rawBody !== '') {
    http_response_code(400);
    echo json_encode(['error' => 'Body JSON tidak valid']);
    exit;
}

// ── Map path → Digiflazz endpoint ─────────────────────────────────────────────
$endpointMap = [
    'transaction' => DIGIFLAZZ_API . '/transaction',
    'price-list'  => DIGIFLAZZ_API . '/price-list',
    'cek-saldo'   => DIGIFLAZZ_API . '/cek-saldo',
];

if (!isset($endpointMap[$path])) {
    http_response_code(404);
    echo json_encode(['error' => 'Endpoint tidak ditemukan', 'path' => $path]);
    exit;
}

$targetUrl = $endpointMap[$path];

// ── Forward ke Digiflazz via cURL ──────────────────────────────────────────────
$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $rawBody,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'Accept: application/json',
        'Content-Length: ' . strlen($rawBody),
    ],
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);

$response   = curl_exec($ch);
$httpCode   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError  = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'cURL gagal: ' . $curlError]);
    exit;
}

// Forward status code dan body Digiflazz langsung ke caller
http_response_code($httpCode ?: 502);
echo $response;
exit;
