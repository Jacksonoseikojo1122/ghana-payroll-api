#!/usr/bin/env bash
# Try every endpoint against a local server: npm start, then bash examples/curl.sh
set -euo pipefail
URL=${PAYROLL_URL:-http://localhost:8788}

echo "--- One payslip: GHS 5,000 basic + GHS 1,000 transport, October 2026"
curl -s -X POST "$URL/v1/payslip" -H "content-type: application/json" \
  -d '{"period":"2026-10","basic_salary":500000,"allowances":[{"name":"Transport","amount":100000}]}'
echo

echo "--- Gross-up: what basic salary gives GHS 5,000 net?"
curl -s -X POST "$URL/v1/gross-up" -H "content-type: application/json" \
  -d '{"period":"2026-10","target_net_pay":500000}' | head -c 300
echo

echo "--- Rate tables in force on 31 October 2026"
curl -s "$URL/v1/rates?date=2026-10-31" | head -c 300
echo

echo "--- A payroll run (sending it twice returns the same run)"
curl -s -X POST "$URL/v1/payroll-runs" -H "content-type: application/json" \
  -H "Idempotency-Key: example-2026-10" ${PAYROLL_API_KEY:+-H "Authorization: Bearer $PAYROLL_API_KEY"} \
  --data @"$(dirname "$0")/run.json" | head -c 400
echo
