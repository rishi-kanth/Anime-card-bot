const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : false
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      character_name TEXT NOT NULL,
      anime_name TEXT NOT NULL,
      category TEXT NOT NULL,
      image_url TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_cards (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      card_id INTEGER REFERENCES cards(id),
      obtained_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      user_id TEXT PRIMARY KEY,
      last_crate BIGINT
    );
  `);
}

module.exports = { pool, initDatabase };