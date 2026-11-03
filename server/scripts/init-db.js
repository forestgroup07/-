'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    multipleStatements: true,
  });

  await conn.query(sql);

  // ensure demo token matches .env
  const token = process.env.DEMO_TOKEN || 'demo-godot-token';
  await conn.query(
    `INSERT INTO sicbo_demo.users (username, token, balance)
     VALUES ('godot_demo', ?, 10000.00)
     ON DUPLICATE KEY UPDATE token = VALUES(token)`,
    [token]
  );

  await conn.end();
  console.log('[init-db] schema applied, demo user ready, token =', token);
}

main().catch((err) => {
  console.error('[init-db] failed:', err.message || err);
  process.exit(1);
});
