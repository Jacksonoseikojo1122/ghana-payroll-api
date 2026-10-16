// Print a payslip with its working. Run: npm start, then npx tsx examples/node.ts
const URL = process.env.PAYROLL_URL ?? "http://localhost:8788";
const ghs = (p: number) => (p / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

type Step = { step: string; amount: number; working: string };

const res = await fetch(`${URL}/v1/payslip`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    period: "2026-10",
    basic_salary: 500000, // GHS 5,000.00
    allowances: [{ name: "Transport", amount: 100000 }],
    tier3_contribution: 25000,
  }),
});
const p = await res.json();
if (!res.ok) throw new Error(p.error);

for (const s of p.working as Step[]) console.log(s.step.padEnd(20), ghs(s.amount).padStart(12), " ", s.working);
for (const w of p.warnings as string[]) console.log("! " + w);
console.log(`\nNet pay GHS ${ghs(p.net_pay)} (tables: ${p.rate_tables.map((t: { id: string }) => t.id).join(", ")})`);
