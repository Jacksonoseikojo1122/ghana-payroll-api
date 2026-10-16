import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RateBook } from "../src/rates.js";
import { createApp } from "../src/server.js";
import { PostgresStore, SqliteStore, type RunStore } from "../src/store.js";

const rates = RateBook.fromDir(join(import.meta.dirname, "..", "rates"));
const KEY = "test-key";
const auth = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const run = {
  period: "2026-10",
  employees: [
    { employee_id: "E001", basic_salary: 500000, allowances: [{ name: "Transport", amount: 100000 }] },
    { employee_id: "=HYPERLINK(1)", basic_salary: 300000 },
  ],
};

const stores: [string, () => RunStore][] = [["sqlite", () => new SqliteStore()]];
if (process.env.TEST_DATABASE_URL) stores.push(["postgres", () => new PostgresStore(process.env.TEST_DATABASE_URL!)]);

describe("calculation endpoints", () => {
  const app = createApp({ rates, store: new SqliteStore(), apiKeys: [KEY] });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("POST /v1/payslip works without a key", async () => {
    const res = await post("/v1/payslip", { period: "2026-10", basic_salary: 500000 });
    expect(res.status).toBe(200);
    expect((await res.json()).net_pay).toBeTypeOf("number");
  });
  it("explains bad input", async () => {
    const res = await post("/v1/payslip", { period: "October", basic_salary: 12.5 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues.map((i: { path: string }) => i.path).sort()).toEqual(["basic_salary", "period"]);
  });
  it("returns 422 for a period with no official rate table", async () => {
    const res = await post("/v1/payslip", { period: "2025-12", basic_salary: 500000 });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("no_rate_table");
  });
  it("POST /v1/gross-up", async () => {
    const res = await post("/v1/gross-up", { period: "2026-10", target_net_pay: 400000 });
    expect(res.status).toBe(200);
    expect((await res.json()).payslip.net_pay).toBeGreaterThanOrEqual(400000);
  });
  it("GET /v1/rates?date= returns the tables in force", async () => {
    const body = await (await app.request("/v1/rates?date=2026-10-31")).json();
    expect(body.paye.id).toBe("gh-paye-2026-09");
    expect(body.ssnit.max_insurable).toBe(6900000);
  });
  it("serves the calculator page", async () => {
    const res = await app.request("/");
    expect(await res.text()).toContain("PAYE &amp; SSNIT calculator");
  });
});

describe.each(stores)("payroll runs (%s)", (_name, make) => {
  const store = make();
  const app = createApp({ rates, store, apiKeys: [KEY] });
  afterAll(() => store.close());
  const key = `run-${Date.now()}-${Math.random()}`;
  const create = (body: unknown, k = key, headers: Record<string, string> = auth) =>
    app.request("/v1/payroll-runs", { method: "POST", headers: { ...headers, "idempotency-key": k }, body: JSON.stringify(body) });

  it("needs a key", async () => {
    expect((await create(run, key, { "content-type": "application/json" })).status).toBe(401);
  });
  it("needs an Idempotency-Key", async () => {
    const res = await app.request("/v1/payroll-runs", { method: "POST", headers: auth, body: JSON.stringify(run) });
    expect(res.status).toBe(400);
  });

  let id = "";
  it("creates a run with totals", async () => {
    const res = await create(run);
    expect(res.status).toBe(201);
    const body = await res.json();
    id = body.id;
    expect(body.totals.employees).toBe(2);
    expect(body.totals.net_pay).toBe(body.payslips[0].net_pay + body.payslips[1].net_pay);
  });
  it("replays the same run for a retried request", async () => {
    const res = await create(run);
    expect(res.status).toBe(200);
    expect(res.headers.get("idempotent-replayed")).toBe("true");
    expect((await res.json()).id).toBe(id);
  });
  it("refuses the same key with a different body", async () => {
    expect((await create({ ...run, period: "2026-11" })).status).toBe(409);
  });
  it("rejects duplicate employee IDs", async () => {
    const res = await create({ period: "2026-10", employees: [run.employees[0], run.employees[0]] }, key + "-dupe");
    expect(res.status).toBe(400);
  });
  it("fetches a run and exports a safe CSV", async () => {
    expect((await app.request(`/v1/payroll-runs/${id}`, { headers: auth })).status).toBe(200);
    const csv = await (await app.request(`/v1/payroll-runs/${id}/payslips.csv`, { headers: auth })).text();
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^employee_id,basic_salary,/);
    expect(lines[1]).toMatch(/^"E001",5000\.00,1000\.00,/);
    expect(lines[2]).toMatch(/^"'=HYPERLINK\(1\)",/);
  });
  it("hides runs from other keys", async () => {
    const other = createApp({ rates, store, apiKeys: ["other"] });
    const res = await other.request(`/v1/payroll-runs/${id}`, { headers: { authorization: "Bearer other" } });
    expect(res.status).toBe(404);
  });
});
