# PHP Proxy — digiflazz.enuyrasa.my.id

Proxy ringan yang berjalan di hosting Domainesia (PHP/cPanel) untuk meneruskan
request dari Vercel ke Digiflazz API. Ini menggantikan Cloudflare Worker agar
IP hosting yang ter-whitelist di Digiflazz bisa digunakan.

## File
| File | Keterangan |
|------|-----------|
| `proxy.php` | File utama proxy — upload ke `/public_html/` |
| `.htaccess`  | Routing bersih (tanpa `/proxy.php` di URL) — upload bersama |

## Cara Upload ke cPanel

1. Login cPanel Domainesia → **File Manager**
2. Masuk ke folder subdomain `digiflazz.enuyrasa.my.id`  
   (biasanya `/public_html/digiflazz/` atau folder yang kamu set di **Subdomains**)
3. Upload `proxy.php` dan `.htaccess`
4. Buka browser → `https://digiflazz.enuyrasa.my.id/ping`  
   Harus muncul: `{"ok":true,"proxy":"digiflazz.enuyrasa.my.id",...}`

## Konfigurasi PROXY_SECRET (opsional tapi disarankan)

Tambahkan baris ini di `.htaccess` ATAU di `php.ini` hosting:

```
SetEnv PROXY_SECRET rahasia-super-kuat-isi-bebas
```

Lalu set env var yang sama di Vercel:
```
PROXY_SECRET=rahasia-super-kuat-isi-bebas
```

Jika `PROXY_SECRET` kosong, proxy menerima semua request tanpa verifikasi.

## Endpoints

| Method | Path | Diteruskan ke |
|--------|------|--------------|
| GET  | `/ping`        | — (health check lokal) |
| POST | `/transaction` | `https://api.digiflazz.com/v1/transaction` |
| POST | `/price-list`  | `https://api.digiflazz.com/v1/price-list` |
| POST | `/cek-saldo`   | `https://api.digiflazz.com/v1/cek-saldo` |

## DNS Record di Cloudflare

Tambahkan record ini di dashboard Cloudflare domain `enuyrasa.my.id`:

| Type  | Name        | Content / Target            | Proxy |
|-------|-------------|----------------------------|-------|
| CNAME | `digiflazz` | `enuyrasa.my.id` (atau IP hosting Domainesia) | ☁️ Proxied (orange) |

> **Catatan**: Jika Domainesia butuh IP langsung, buat record **A** dengan IP server hosting.
> IP hosting bisa dilihat di cPanel Domainesia → **Server Information**.

## IP Whitelist di Digiflazz

Login Digiflazz → **Pengaturan** → **Koneksi API** → **Whitelist IP**  
Tambahkan IP server Domainesia (bukan IP Cloudflare).

IP server bisa dicek di:
- cPanel → **Server Information**, atau
- Jalankan di terminal: `ping digiflazz.enuyrasa.my.id` (setelah DNS aktif, **bypass Cloudflare proxy** dengan DNS-only dulu)

## Vercel Environment Variable

Setelah proxy aktif, tambahkan di Vercel → Settings → Environment Variables:

```
PROXY_SECRET=<nilai yang sama dengan SetEnv di .htaccess>
```

Kode Vercel sudah diupdate untuk mengirim header `X-Proxy-Secret` otomatis.
