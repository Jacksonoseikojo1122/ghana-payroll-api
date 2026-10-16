import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { calculate, EmployeeInput, Period, type Payslip } from "./calc.js";
import { grossUp, GrossUpError } from "./grossup.js";
import { ghs, sum } from "./money.js";
import { NoRateTableError, type RateBook } from "./rates.js";
import type { RunStore } from "./store.js";
import { calculatorPage } from "./ui.js";

export type AppOptions = {
  rates: RateBook;
  store: RunStore;
  apiKeys: string[]; // empty = payroll runs are open (local dev only)
  files?: { openapi?: string; llms?: string };
};

const RunInput = z.object({
  period: Period,
  employees: z
    .array(EmployeeInput.extend({ employee_id: z.string().trim().min(1).max(64) }))
    .min(1)
    .max(1000),
});

type Env = { Variables: { owner: string } };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createApp(opts: AppOptions) {
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Invalid request", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
    }
    if (err instanceof NoRateTableError) return c.json({ error: err.message, code: "no_rate_table" }, 422);
    if (err instanceof GrossUpError) return c.json({ error: err.message }, 422);
    if (err instanceof SyntaxError) return c.json({ error: "Body must be valid JSON" }, 400);
    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  app.use("*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Body is larger than 1 MB" }, 413) }));

  app.get("/", (c) => c.html(calculatorPage()));
  app.get("/health", async (c) => {
    await opts.store.ping();
    return c.json({ ok: true, rate_tables: [...opts.rates.paye, ...opts.rates.ssnit].map((t) => t.id) });
  });
  if (opts.files?.openapi) app.get("/openapi.yaml", (c) => c.body(opts.files!.openapi!, 200, { "content-type": "application/yaml" }));
  if (opts.files?.llms) app.get("/llms.txt", (c) => c.text(opts.files!.llms!));

  // --- Calculations: pure maths, no account needed --------------------------
  app.get("/v1/rates", (c) => {
    const date = c.req.query("date");
    if (date) {
      z.iso.date().parse(date);
      return c.json({ date, paye: opts.rates.payeFor(date), ssnit: opts.rates.ssnitFor(date) });
    }
    return c.json({ paye: opts.rates.paye, ssnit: opts.rates.ssnit });
  });

  app.post("/v1/payslip", async (c) => c.json(calculate(await c.req.json(), opts.rates)));
  app.post("/v1/gross-up", async (c) => c.json(grossUp(await c.req.json(), opts.rates)));

  // --- Payroll runs: stored, so they need a key ------------------------------
  app.use("/v1/payroll-runs/*", auth(opts.apiKeys));
  app.use("/v1/payroll-runs", auth(opts.apiKeys));

  app.post("/v1/payroll-runs", async (c) => {
    const key = c.req.header("idempotency-key")?.trim();
    if (!key || key.length > 128) {
      return c.json({ error: "Send an Idempotency-Key header (up to 128 characters) so a retry never creates a second run" }, 400);
    }
    const raw = await c.req.text();
    const input = RunInput.parse(JSON.parse(raw));
    const ids = input.employees.map((e) => e.employee_id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) return c.json({ error: `Duplicate employee_id: ${[...new Set(dupes)].join(", ")}` }, 400);

    const payslips = input.employees.map(({ employee_id, ...e }) => ({
      employee_id,
      ...calculate({ ...e, period: input.period }, opts.rates),
    }));
    const { record, created } = await opts.store.create({
      owner: c.get("owner"),
      idempotency_key: key,
      request_hash: sha256(raw),
      period: input.period,
      result: { period: input.period, totals: totals(payslips), payslips },
    });
    if (!created && record.request_hash !== sha256(raw)) {
      return c.json({ error: "This Idempotency-Key was already used with a different request" }, 409);
    }
    c.header("Idempotent-Replayed", String(!created));
    return c.json(view(record), created ? 201 : 200);
  });

  app.get("/v1/payroll-runs/:id", async (c) => {
    const r = await opts.store.get(c.get("owner"), c.req.param("id"));
    return r ? c.json(view(r)) : c.json({ error: "Run not found" }, 404);
  });

  app.get("/v1/payroll-runs/:id/payslips.csv", async (c) => {
    const r = await opts.store.get(c.get("owner"), c.req.param("id"));
    if (!r) return c.json({ error: "Run not found" }, 404);
    const { payslips } = r.result as { payslips: (Payslip & { employee_id: string })[] };
    c.header("content-disposition", `attachment; filename="payroll-${r.period}-${r.id}.csv"`);
    return c.body(toCsv(payslips), 200, { "content-type": "text/csv; charset=utf-8" });
  });

  return app;
}

function auth(keys: string[]) {
  return async (c: Context<Env>, next: () => Promise<void>) => {
    if (!keys.length) {
      c.set("owner", "dev");
      return next();
    }
    const key = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!keys.includes(key)) return c.json({ error: "Missing or invalid API key" }, 401);
    c.set("owner", sha256(key).slice(0, 16));
    return next();
  };
}

function view(r: { id: string; created_at: string; result: unknown }) {
  return { id: r.id, created_at: r.created_at, ...(r.result as object) };
}

function totals(ps: Payslip[]) {
  const t = (f: (p: Payslip) => number) => sum(ps.map(f));
  return {
    employees: ps.length,
    gross_cash_pay: t((p) => p.earnings.gross_cash_pay),
    paye: t((p) => p.tax.paye),
    total_tax: t((p) => p.tax.total),
    ssnit_employee: t((p) => p.ssnit.employee),
    ssnit_employer: t((p) => p.ssnit.employer),
    ssnit_tier1: t((p) => p.ssnit.tier1),
    ssnit_tier2: t((p) => p.ssnit.tier2),
    net_pay: t((p) => p.net_pay),
    employer_cost: t((p) => p.employer_cost),
  };
}

const COLUMNS: [string, (p: Payslip) => number][] = [
  ["basic_salary", (p) => p.earnings.basic_salary],
  ["taxable_allowances", (p) => p.earnings.taxable_allowances],
  ["non_taxable_allowances", (p) => p.earnings.non_taxable_allowances],
  ["bonus", (p) => p.earnings.bonus],
  ["overtime", (p) => p.earnings.overtime],
  ["gross_cash_pay", (p) => p.earnings.gross_cash_pay],
  ["benefits_in_kind", (p) => p.earnings.benefits_in_kind],
  ["ssnit_employee", (p) => p.ssnit.employee],
  ["ssnit_employer", (p) => p.ssnit.employer],
  ["ssnit_tier1", (p) => p.ssnit.tier1],
  ["ssnit_tier2", (p) => p.ssnit.tier2],
  ["chargeable_income", (p) => p.tax.chargeable_income],
  ["paye", (p) => p.tax.paye],
  ["bonus_tax", (p) => p.tax.bonus_tax],
  ["overtime_tax", (p) => p.tax.overtime_tax],
  ["total_tax", (p) => p.tax.total],
  ["tier3", (p) => p.deductions.tier3],
  ["other_deductions", (p) => p.deductions.other],
  ["net_pay", (p) => p.net_pay],
  ["employer_cost", (p) => p.employer_cost],
];

function toCsv(ps: (Payslip & { employee_id: string })[]) {
  // Quote every ID and neutralise leading = + - @ so spreadsheets don't run it as a formula.
  const cell = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
  const amount = (n: number) => ghs(n).replace(/,/g, "");
  const head = ["employee_id", ...COLUMNS.map(([h]) => h)].join(",");
  const rows = ps.map((p) => [cell(p.employee_id), ...COLUMNS.map(([, f]) => amount(f(p)))].join(","));
  return [head, ...rows].join("\r\n") + "\r\n";
}
