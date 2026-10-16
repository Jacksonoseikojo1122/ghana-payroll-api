import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

export type RunRecord = {
  id: string;
  owner: string; // hash of the API key that created it
  idempotency_key: string;
  request_hash: string;
  period: string;
  created_at: string;
  result: unknown;
};

export interface RunStore {
  /** Saves the run unless this owner already used the idempotency key; either way returns what's stored. */
  create(r: Omit<RunRecord, "id" | "created_at">): Promise<{ record: RunRecord; created: boolean }>;
  get(owner: string, id: string): Promise<RunRecord | undefined>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS payroll_runs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  period TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result TEXT NOT NULL,
  UNIQUE (owner, idempotency_key)
)`;

const newId = () => "run_" + randomBytes(12).toString("hex");

type Row = Omit<RunRecord, "result"> & { result: string };
const toRecord = (r: Row): RunRecord => ({ ...r, result: JSON.parse(r.result) });

export class SqliteStore implements RunStore {
  private db: DatabaseSync;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
  }
  async create(r: Omit<RunRecord, "id" | "created_at">) {
    const id = newId();
    const res = this.db
      .prepare(
        `INSERT INTO payroll_runs (id, owner, idempotency_key, request_hash, period, created_at, result)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (owner, idempotency_key) DO NOTHING`,
      )
      .run(id, r.owner, r.idempotency_key, r.request_hash, r.period, new Date().toISOString(), JSON.stringify(r.result));
    const row = this.db
      .prepare("SELECT * FROM payroll_runs WHERE owner = ? AND idempotency_key = ?")
      .get(r.owner, r.idempotency_key) as Row;
    return { record: toRecord(row), created: Number(res.changes) === 1 };
  }
  async get(owner: string, id: string) {
    const row = this.db.prepare("SELECT * FROM payroll_runs WHERE owner = ? AND id = ?").get(owner, id) as Row | undefined;
    return row ? toRecord(row) : undefined;
  }
  async ping() {
    this.db.prepare("SELECT 1").get();
  }
  async close() {
    this.db.close();
  }
}

export class PostgresStore implements RunStore {
  private pool: pg.Pool;
  private ready: Promise<unknown>;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 5 });
    this.ready = this.pool.query(SCHEMA);
  }
  async create(r: Omit<RunRecord, "id" | "created_at">) {
    await this.ready;
    const ins = await this.pool.query(
      `INSERT INTO payroll_runs (id, owner, idempotency_key, request_hash, period, created_at, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (owner, idempotency_key) DO NOTHING`,
      [newId(), r.owner, r.idempotency_key, r.request_hash, r.period, new Date().toISOString(), JSON.stringify(r.result)],
    );
    const { rows } = await this.pool.query<Row>("SELECT * FROM payroll_runs WHERE owner = $1 AND idempotency_key = $2", [
      r.owner,
      r.idempotency_key,
    ]);
    return { record: toRecord(rows[0]!), created: ins.rowCount === 1 };
  }
  async get(owner: string, id: string) {
    await this.ready;
    const { rows } = await this.pool.query<Row>("SELECT * FROM payroll_runs WHERE owner = $1 AND id = $2", [owner, id]);
    return rows[0] ? toRecord(rows[0]) : undefined;
  }
  async ping() {
    await this.ready;
    await this.pool.query("SELECT 1");
  }
  async close() {
    await this.pool.end();
  }
}
