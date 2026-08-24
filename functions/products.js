/**
 * GET /api/products  →  /.netlify/functions/products
 */

const { getDatabase } = require("@netlify/database");

exports.handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const db = getDatabase({ connectionString: process.env.NETLIFY_DB_URL });
    const result = await db.sql`
      SELECT
        id,
        name,
        price,
        description  AS desc,
        img,
        status,
        status_label AS "statusLabel"
      FROM products
      ORDER BY sort_order ASC, created_at ASC
    `;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
      body: JSON.stringify(result.rows),
    };
  } catch (err) {
    console.error("[products] DB error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Gagal memuat produk: " + err.message }),
    };
  }
};
