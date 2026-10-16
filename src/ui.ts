// A one-page calculator served at "/". It only calls the public /v1/payslip endpoint.

export function calculatorPage(): string {
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ghana Payroll API: PAYE and SSNIT calculator</title>
<meta name="description" content="Work out PAYE, SSNIT Tier 1 and Tier 2, and net pay for Ghana from the official GRA and SSNIT rate tables, with every step shown.">
<style>
  :root { --bg:#f7f6f2; --card:#fff; --ink:#1d1d1b; --muted:#6b6a64; --line:#e3e1d9; --accent:#0b6e4f; --warn:#8a5a00; --warnbg:#fff6e0; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 28px 16px 60px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 22px; }
  .grid { display: grid; grid-template-columns: 320px 1fr; gap: 20px; align-items: start; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px; }
  label { display:block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
  input, select { width:100%; padding: 8px 10px; border:1px solid var(--line); border-radius:6px; font: inherit; background:#fff; }
  button { margin-top: 16px; width:100%; padding: 10px; border:0; border-radius:6px; background: var(--accent); color:#fff; font: inherit; font-weight:600; cursor:pointer; }
  .big { display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
  .big div { border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
  .big span { display:block; font-size:12px; color:var(--muted); }
  .big strong { font-size: 20px; font-variant-numeric: tabular-nums; }
  table { width:100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td { padding: 7px 4px; border-top: 1px solid var(--line); vertical-align: top; }
  td.n { text-align: right; white-space: nowrap; font-weight: 600; }
  td.w { color: var(--muted); font-size: 13px; }
  h2 { font-size: 15px; margin: 18px 0 6px; }
  .warn { background: var(--warnbg); color: var(--warn); padding: 8px 10px; border-radius: 6px; margin: 8px 0 0; font-size: 13px; }
  .src { font-size: 12px; color: var(--muted); margin-top: 14px; }
  .src a { color: var(--accent); }
  .err { color: #a11; }
</style>
</head>
<body>
<main>
  <h1>Ghana PAYE &amp; SSNIT calculator</h1>
  <p class="sub">Every figure comes from the official GRA and SSNIT tables, and every step is shown. Powered by the open-source <a href="https://github.com/Jacksonoseikojo1122/ghana-payroll-api">Ghana Payroll API</a>.</p>
  <div class="grid">
    <form class="card" id="f">
      <label for="period">Pay period</label><input id="period" type="month" value="${period}" required>
      <label for="basic">Basic salary (GHS)</label><input id="basic" inputmode="decimal" value="5000.00" required>
      <label for="allow">Taxable allowances (GHS)</label><input id="allow" inputmode="decimal" value="1000.00">
      <label for="bonus">Bonus this month (GHS)</label><input id="bonus" inputmode="decimal" value="0">
      <label for="tier3">Tier 3 contribution (GHS)</label><input id="tier3" inputmode="decimal" value="0">
      <label for="res">Residency</label>
      <select id="res"><option value="resident">Resident</option><option value="non_resident">Non-resident</option></select>
      <button>Calculate</button>
    </form>
    <section class="card" id="out" aria-live="polite"><p class="sub">Enter a salary and press Calculate.</p></section>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
function pesewas(v) {
  const s = String(v).trim().replace(/,/g, "") || "0";
  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) throw new Error("Amounts look like 1234.50");
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}
const ghs = (p) => (p < 0 ? "-" : "") + (Math.abs(p) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function el(tag, props = {}, ...kids) { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; }

$("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const out = $("out");
  try {
    const allow = pesewas($("allow").value);
    const body = {
      period: $("period").value,
      basic_salary: pesewas($("basic").value),
      allowances: allow ? [{ name: "Allowances", amount: allow }] : [],
      bonus: pesewas($("bonus").value),
      tier3_contribution: pesewas($("tier3").value),
      residency: $("res").value,
    };
    const res = await fetch("/v1/payslip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const p = await res.json();
    if (!res.ok) throw new Error(p.error + (p.issues ? ": " + p.issues.map((i) => i.path + " " + i.message).join("; ") : ""));
    out.replaceChildren(
      el("div", { className: "big" },
        el("div", {}, el("span", { textContent: "Net pay" }), el("strong", { textContent: "GHS " + ghs(p.net_pay) })),
        el("div", {}, el("span", { textContent: "Total tax" }), el("strong", { textContent: ghs(p.tax.total) })),
        el("div", {}, el("span", { textContent: "SSNIT (employee)" }), el("strong", { textContent: ghs(p.ssnit.employee) }))),
      el("h2", { textContent: "How it was worked out" }),
      el("table", {}, ...p.working.map((s) => el("tr", {},
        el("td", { textContent: s.step.replace(/_/g, " ") }),
        el("td", { className: "w", textContent: s.working }),
        el("td", { className: "n", textContent: ghs(s.amount) })))),
      ...p.warnings.map((w) => el("p", { className: "warn", textContent: w })),
      el("p", { className: "src" }, "Rate tables: ", ...p.rate_tables.flatMap((t, i) => [i ? " · " : "", el("a", { href: t.sources[0].url, textContent: t.id + " (from " + t.effective_from + ")" })])),
    );
  } catch (e) {
    out.replaceChildren(el("p", { className: "err", textContent: e.message }));
  }
});
</script>
</body>
</html>`;
}
