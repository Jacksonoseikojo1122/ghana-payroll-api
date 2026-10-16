# Getting started

You need Node.js 22.13 or newer.

```bash
git clone https://github.com/Jacksonoseikojo1122/ghana-payroll-api.git
cd ghana-payroll-api
npm install
npm start          # http://localhost:8788
```

Open http://localhost:8788 for the calculator, or call the API.

## One payslip

Amounts are in **pesewas**: `500000` is GHS 5,000.00.

```bash
curl -X POST http://localhost:8788/v1/payslip -H "content-type: application/json" -d '{
  "period": "2026-10",
  "basic_salary": 500000,
  "allowances": [{ "name": "Transport", "amount": 100000 }]
}'
```

The main parts of the answer (trimmed):

```json
{
  "period": "2026-10",
  "rate_tables": [{ "id": "gh-paye-2026-09", "effective_from": "2026-09-01", "sources": [...] }, { "id": "gh-ssnit-2026-01", ... }],
  "earnings": { "basic_salary": 500000, "taxable_allowances": 100000, "gross_cash_pay": 600000, ... },
  "ssnit": { "insurable_earnings": 500000, "employee": 27500, "employer": 65000, "tier1": 67500, "tier2": 25000, "total": 92500 },
  "tax": {
    "method": "graduated",
    "employment_income": 600000,
    "chargeable_income": 572500,
    "paye": 103575,
    "bands": [
      { "from": 0, "to": 58800, "rate_bp": 0, "taxed": 58800, "tax": 0 },
      { "from": 58800, "to": 66800, "rate_bp": 500, "taxed": 8000, "tax": 400 },
      { "from": 66800, "to": 76800, "rate_bp": 1000, "taxed": 10000, "tax": 1000 },
      { "from": 76800, "to": 366800, "rate_bp": 1750, "taxed": 290000, "tax": 50750 },
      { "from": 366800, "to": 1966800, "rate_bp": 2500, "taxed": 205700, "tax": 51425 }
    ],
    "total": 103575
  },
  "net_pay": 468925,
  "employer_cost": 665000,
  "working": [
    { "step": "ssnit_employee", "amount": 27500, "working": "5.5% of 5,000.00, deducted from pay" },
    { "step": "chargeable_income", "amount": 572500, "working": "employment income 6,000.00 − SSNIT 275.00 − Tier 3 relief 0.00 − other reliefs 0.00" },
    { "step": "paye", "amount": 103575, "working": "monthly bands (gh-paye-2026-09): 0% × 588.00 + 5% × 80.00 + 10% × 100.00 + 17.5% × 2,900.00 + 25% × 2,057.00" },
    ...
  ],
  "warnings": []
}
```

So: net pay GHS 4,689.25, PAYE GHS 1,035.75, and the employer pays GHS 6,650.00 in total.

## Gross-up: "I want to pay GHS 5,000 net"

```bash
curl -X POST http://localhost:8788/v1/gross-up -H "content-type: application/json" \
  -d '{ "period": "2026-10", "target_net_pay": 500000 }'
# { "basic_salary": 649665, "payslip": { "net_pay": 500000, ... } }
```

That's a basic salary of GHS 6,496.65, the smallest basic that gives at least GHS 5,000.00 net.

## A whole payroll

A run calculates everyone at once, stores the result and gives you a CSV. Send an `Idempotency-Key`: if the request is retried after a timeout, you get the same run back instead of a second one.

```bash
curl -X POST http://localhost:8788/v1/payroll-runs \
  -H "content-type: application/json" -H "Idempotency-Key: payroll-2026-10" \
  --data @examples/run.json
```

```json
{
  "id": "run_8c1f...",
  "period": "2026-10",
  "totals": { "employees": 3, "gross_cash_pay": 6260000, "paye": 682240, "total_tax": 834240,
              "ssnit_employee": 171600, "ssnit_employer": 405600, "ssnit_tier1": 421200, "ssnit_tier2": 156000,
              "net_pay": 5204160, "employer_cost": 6665600 },
  "payslips": [ ... ]
}
```

Then fetch `GET /v1/payroll-runs/{id}/payslips.csv`. Here is [the CSV from that exact run](example-payslips.csv).

Payroll runs are stored, so in production set `PAYROLL_API_KEYS` and send `Authorization: Bearer <key>`. Single payslips, gross-up and rates need no key.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8788` | HTTP port |
| `PAYROLL_API_KEYS` | none | Comma-separated keys for `/v1/payroll-runs`. Unset means open (local only) |
| `DATABASE_URL` | none | `postgres://...` for stored runs. Unset means SQLite |
| `PAYROLL_SQLITE` | `payroll.db` | SQLite file |
| `RATES_DIR` | `./rates` | Where rate tables are read from |

Next: [integration guide](integration.md) · [how it works](how-it-works.md) · [rate tables](rates.md)
