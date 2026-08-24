/**
 * GET /.netlify/functions/setup-db?secret=setup2024
 * Seed data produk awal. Jalankan sekali saja.
 */

const { getDatabase } = require("@netlify/database");

exports.handler = async function (event) {
  const secret = (event.queryStringParameters || {}).secret;
  if (secret !== "setup2024") {
    return { statusCode: 403, body: "Forbidden" };
  }

  try {
    const db = getDatabase({ connectionString: process.env.NETLIFY_DB_URL });

    await db.sql`
      INSERT INTO products (id, name, price, description, img, status, status_label, sort_order)
      VALUES
        ('wajik',   'Dodol Wajik', 32000, 'Wajik Manis legit, resep asli turun-temurun isi 40 pcs', '/images/wajik.jpg',   'ready',    'Ready Stock', 1),
        ('burayot', 'Burayot',     40000, 'Burayot Manis, Gurih dan wangi isi 32 pcs',               '/images/burayot.jpg', 'preorder', 'Pre Order',   2)
      ON CONFLICT (id) DO NOTHING
    `;

    const result = await db.sql`SELECT id, name, price FROM products ORDER BY sort_order`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, products: result.rows }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
