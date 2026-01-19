import mysql from "mysql2/promise";
import { config } from "../config/env.js";

let pool;

function getReadPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPassword,
      database: config.dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }
  return pool;
}

export async function queryDb(sql) {
  const normalized = (sql || "").trim();
  if (!normalized) {
    throw new Error("SQL is required for read-only query.");
  }

  // Block non-SELECT statements to enforce read-only access.
  const hasExtraStatements = normalized.split(";").filter(Boolean).length > 1;
  const startsWithSelect = /^\s*select\b/i.test(normalized);
  if (hasExtraStatements || !startsWithSelect) {
    throw new Error("Only single SELECT statements are allowed.");
  }

  const p = getReadPool();
  const [rows] = await p.execute(normalized);
  return rows;
}
