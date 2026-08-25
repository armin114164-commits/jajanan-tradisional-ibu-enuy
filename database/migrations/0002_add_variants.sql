-- Migration: tambah kolom variants ke tabel products
-- variants disimpan sebagai JSON array, contoh:
-- [{"id":"mika","label":"1 Mika","price":34000},{"id":"kg","label":"per Kg","price":32000,"unit":"gram","unitStep":100,"unitMin":100,"unitMax":1000}]

ALTER TABLE products ADD COLUMN IF NOT EXISTS variants TEXT NOT NULL DEFAULT '[]';

-- Update data awal: wajik dan burayot ganti label box -> mika, wajik tambah variants
UPDATE products SET
  status_label = 'Ready Stock',
  variants = '[{"id":"mika","label":"1 Mika","price":34000},{"id":"kg","label":"per Kg","price":32000,"unit":"gram","unitStep":100,"unitMin":100,"unitMax":1000}]'
WHERE id = 'wajik';

UPDATE products SET
  status_label = 'Ready Stock'
WHERE id = 'burayot';
