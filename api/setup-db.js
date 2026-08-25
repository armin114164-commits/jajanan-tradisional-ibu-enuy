/**
 * GET /api/setup-db?secret=setup2024
 * Setup database: buat tabel, tambah kolom, seed data.
 */

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.query.secret !== "setup2024") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Buat tabel kalau belum ada
    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id           TEXT    PRIMARY KEY,
        name         TEXT    NOT NULL,
        price        INTEGER NOT NULL,
        description  TEXT    NOT NULL DEFAULT '',
        img          TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT 'ready',
        status_label TEXT    NOT NULL DEFAULT 'Ready Stock',
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Tambah kolom-kolom baru kalau belum ada
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS variants TEXT NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS unit     TEXT NOT NULL DEFAULT 'mika'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock    INTEGER NOT NULL DEFAULT -1`;
    // stock = -1 artinya tidak terbatas (unlimited), >= 0 artinya ada stok terhitung

    // Buat tabel orders kalau belum ada
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id             SERIAL PRIMARY KEY,
        customer_name  TEXT        NOT NULL,
        customer_wa    TEXT        NOT NULL,
        customer_addr  TEXT        NOT NULL,
        items          TEXT        NOT NULL DEFAULT '[]',
        total          INTEGER     NOT NULL DEFAULT 0,
        payment_method TEXT        NOT NULL DEFAULT '',
        status         TEXT        NOT NULL DEFAULT 'pending',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Buat tabel digital_orders kalau belum ada
    await sql`
      CREATE TABLE IF NOT EXISTS digital_orders (
        id                SERIAL PRIMARY KEY,
        ref_id            TEXT        NOT NULL UNIQUE,
        customer_name     TEXT        NOT NULL,
        customer_wa       TEXT        NOT NULL,
        target_number     TEXT        NOT NULL,
        sku               TEXT        NOT NULL,
        game              TEXT        NOT NULL DEFAULT '',
        item_name         TEXT        NOT NULL DEFAULT '',
        provider          TEXT        NOT NULL DEFAULT 'digiflazz',
        price             INTEGER     NOT NULL DEFAULT 0,
        notes             TEXT        NOT NULL DEFAULT '',
        status            TEXT        NOT NULL DEFAULT 'pending',
        digiflazz_status  TEXT        NOT NULL DEFAULT '',
        digiflazz_message TEXT        NOT NULL DEFAULT '',
        digiflazz_sn      TEXT        NOT NULL DEFAULT '',
        raw_response      TEXT        NOT NULL DEFAULT '{}',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Tambah kolom baru ke digital_orders jika belum ada (untuk DB lama)
    await sql`ALTER TABLE digital_orders ADD COLUMN IF NOT EXISTS game      TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE digital_orders ADD COLUMN IF NOT EXISTS item_name TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE digital_orders ADD COLUMN IF NOT EXISTS provider  TEXT NOT NULL DEFAULT 'digiflazz'`;

    // Seed / update data produk
    await sql`
      INSERT INTO products (id, name, price, description, img, status, status_label, sort_order, unit, variants, stock)
      VALUES
        ('wajik',      'Dodol Wajik', 34000, 'Wajik Manis legit, resep asli turun-temurun — 40 pcs/mika', '/images/wajik.jpeg',     'ready',    'Ready Stock', 1, 'mika',
         '[{"id":"mika","label":"1 Mika","price":34000,"stockConvert":1},{"id":"500gr","label":"per 500gr","price":16000,"unit":"gram","unitStep":500,"unitMin":500,"stockConvert":0.5}]', -1),
        ('burayot',    'Burayot',     40000, 'Burayot Manis, Gurih dan wangi — 32 pcs/mika',               '/images/Burayot.jpeg',   'preorder', 'Pre Order',   2, 'mika', '[]', -1),
        ('rengginang', 'Rengginang',  25000, 'Gurih, Nikmat, Nyoss — 10 pcs/pack',                         '/images/RENGGINANG.jpg', 'ready',    'Ready Stock', 3, 'pack', '[]', -1)
      ON CONFLICT (id) DO UPDATE SET
        name         = EXCLUDED.name,
        price        = EXCLUDED.price,
        description  = EXCLUDED.description,
        unit         = EXCLUDED.unit,
        variants     = EXCLUDED.variants,
        status_label = EXCLUDED.status_label,
        updated_at   = NOW()
    `;

    const rows = await sql`SELECT id, name, price, stock, variants FROM products ORDER BY sort_order`;
    return res.status(200).json({ success: true, products: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
