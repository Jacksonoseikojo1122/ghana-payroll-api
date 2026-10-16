# Integrating the Ghana Payroll API

The API is a small HTTP service. Run it next to your HR or accounting app (Docker, Render, or `npm start`) and call it from your code.

## Things to get right

1. **Send pesewas, not cedis.** `basic_salary: 500000` is GHS 5,000.00. Convert from a decimal string without floats: split on the dot, or use your database's integer minor units.
2. **Store `rate_tables` with each payslip.** It records which GRA and SSNIT tables were used, so you can show your working later.
3. **Show `warnings` to whoever runs payroll.** They flag cases worth a second look, such as a Tier 3 contribution over the relief limit, overtime that doesn't qualify for overtime rates, or pay below SSNIT's minimum.
4. **Use one `Idempotency-Key` per payroll run** (for example `acme-2026-10`). A network retry then returns the same run instead of creating a second one.
5. **Handle `422 no_rate_table`.** It means there's no official table loaded for that period. Don't fall back to a guess.

## Node.js / TypeScript

```ts
const PAYROLL_URL = process.env.PAYROLL_URL ?? "http://localhost:8788";

// "1234.5" -> 123450, without floating point
export function toPesewas(cedis: string): number {
  const [whole, frac = ""] = cedis.trim().replace(/,/g, "").split(".");
  if (!/^\d+$/.test(whole!) || !/^\d{0,2}$/.test(frac)) throw new Error(`Not an amount: ${cedis}`);
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export async function payslip(period: string, basic: string, allowances: { name: string; amount: string }[] = []) {
  const res = await fetch(`${PAYROLL_URL}/v1/payslip`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      period,
      basic_salary: toPesewas(basic),
      allowances: allowances.map((a) => ({ name: a.name, amount: toPesewas(a.amount) })),
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body; // body.net_pay, body.tax.paye, body.ssnit.tier1, body.working, body.warnings
}

export async function runPayroll(period: string, employees: object[], key: string) {
  const res = await fetch(`${PAYROLL_URL}/v1/payroll-runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.PAYROLL_API_KEY}`,
      "idempotency-key": key, // e.g. `${companyId}-${period}`
    },
    body: JSON.stringify({ period, employees }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json(); // { id, totals, payslips }
}
```

## Python

```python
import os, requests
from decimal import Decimal

PAYROLL_URL = os.getenv("PAYROLL_URL", "http://localhost:8788")

def to_pesewas(cedis: str) -> int:
    return int((Decimal(cedis.replace(",", "")) * 100).to_integral_exact())

def payslip(period: str, basic: str, **extra) -> dict:
    res = requests.post(f"{PAYROLL_URL}/v1/payslip", json={"period": period, "basic_salary": to_pesewas(basic), **extra})
    if res.status_code == 422:
        raise RuntimeError(res.json()["error"])  # no official rate table for that period
    res.raise_for_status()
    return res.json()

p = payslip("2026-10", "5000.00", allowances=[{"name": "Transport", "amount": to_pesewas("1000")}])
print(f"Net pay: GHS {p['net_pay'] / 100:,.2f}")
for step in p["working"]:
    print(f"{step['step']:>20}  {step['amount'] / 100:>12,.2f}  {step['working']}")
```

## PHP

```php
$res = Http::post(env('PAYROLL_URL') . '/v1/payslip', [
    'period' => '2026-10',
    'basic_salary' => 500000,
    'allowances' => [['name' => 'Transport', 'amount' => 100000]],
])->throw()->json();

$netPay = number_format($res['net_pay'] / 100, 2); // "4,689.25"
```

## Payslip fields

| Field | What it is |
| --- | --- |
| `earnings.gross_cash_pay` | Everything paid in cash before deductions |
| `ssnit.employee` | 5.5%, deducted from the employee |
| `ssnit.employer` | 13%, paid by the employer on top |
| `ssnit.tier1` / `ssnit.tier2` | What to remit to SSNIT and to the Tier 2 trustee |
| `tax.chargeable_income` | Income after SSNIT and reliefs; PAYE is worked out on this |
| `tax.paye`, `tax.bonus_tax`, `tax.overtime_tax`, `tax.total` | Tax to withhold and remit to GRA |
| `net_pay` | What the employee receives |
| `employer_cost` | Gross cash pay + employer SSNIT |
| `working` | Each step with the arithmetic in words |
| `warnings` | Things a person should look at |

All the inputs are in [openapi.yaml](../openapi.yaml), and [how it works](how-it-works.md) explains each rule.
