import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { RateBook } from "./rates.js";
import { createApp } from "./server.js";
import { PostgresStore, SqliteStore, type RunStore } from "./store.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => (existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : undefined);

const rates = RateBook.fromDir(process.env.RATES_DIR ?? join(root, "rates"));
const store: RunStore = process.env.DATABASE_URL
  ? new PostgresStore(process.env.DATABASE_URL)
  : new SqliteStore(process.env.PAYROLL_SQLITE ?? "payroll.db");
const apiKeys = (process.env.PAYROLL_API_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);

if (!apiKeys.length) console.warn("PAYROLL_API_KEYS is not set: payroll runs are open to anyone. Fine locally, not in production.");

const app = createApp({ rates, store, apiKeys, files: { openapi: read("openapi.yaml"), llms: read("llms.txt") } });
const port = Number(process.env.PORT ?? 8788);
serve({ fetch: app.fetch, port }, () => console.log(`Ghana Payroll API on http://localhost:${port}`));
