-- Migration: Buat tabel produk untuk toko Dapur Tradisional Ibu Enuy
-- Netlify Database menggunakan PostgreSQL (via Neon).
-- File ini dijalankan otomatis oleh Netlify saat deploy.

CREATE TABLE IF NOT EXISTS products (
  id           TEXT    PRIMARY KEY,          -- slug unik, contoh: "wajik", "burayot"
  name         TEXT    NOT NULL,
  price        INTEGER NOT NULL,             -- harga dalam Rupiah, tanpa desimal
  description  TEXT    NOT NULL DEFAULT '',
  img          TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL DEFAULT 'ready',       -- 'ready' | 'preorder'
  status_label TEXT    NOT NULL DEFAULT 'Ready Stock', -- teks yang ditampilkan di badge
  sort_order   INTEGER NOT NULL DEFAULT 0,             -- urutan tampil di katalog
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: produk awal berdasarkan template-produk.csv
INSERT INTO products (id, name, price, description, img, status, status_label, sort_order)
VALUES
  ('wajik',   'Dodol Wajik', 32000, 'Wajik Manis legit, resep asli turun-temurun isi 40 pcs', '/images/wajik.jpg',   'ready',    'Ready Stock', 1),
  ('burayot', 'Burayot',     40000, 'Burayot Manis, Gurih dan wangi isi 32 pcs',               '/images/burayot.jpg', 'preorder', 'Pre Order',   2)
ON CONFLICT (id) DO NOTHING;
