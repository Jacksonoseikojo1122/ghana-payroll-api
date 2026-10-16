"""Run a payroll for three people and save the CSV. Run: npm start, then python examples/python.py"""
import json, os, pathlib, requests

URL = os.getenv("PAYROLL_URL", "http://localhost:8788")
headers = {"Idempotency-Key": "python-example-2026-10"}
if os.getenv("PAYROLL_API_KEY"):
    headers["Authorization"] = f"Bearer {os.environ['PAYROLL_API_KEY']}"

run = json.loads((pathlib.Path(__file__).parent / "run.json").read_text())
res = requests.post(f"{URL}/v1/payroll-runs", json=run, headers=headers)
res.raise_for_status()
body = res.json()

t = body["totals"]
print(f"Run {body['id']} for {body['period']}: {t['employees']} employees")
print(f"  Net pay to send:     GHS {t['net_pay'] / 100:>12,.2f}")
print(f"  PAYE etc. to GRA:    GHS {t['total_tax'] / 100:>12,.2f}")
print(f"  Tier 1 to SSNIT:     GHS {t['ssnit_tier1'] / 100:>12,.2f}")
print(f"  Tier 2 to trustee:   GHS {t['ssnit_tier2'] / 100:>12,.2f}")

csv = requests.get(f"{URL}/v1/payroll-runs/{body['id']}/payslips.csv", headers=headers)
pathlib.Path("payslips.csv").write_text(csv.text)
print("Saved payslips.csv")
