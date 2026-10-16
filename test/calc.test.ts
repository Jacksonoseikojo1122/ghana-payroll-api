import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBands, calculate } from "../src/calc.js";
import { grossUp } from "../src/grossup.js";
import { NoRateTableError, RateBook } from "../src/rates.js";

const book = RateBook.fromDir(join(import.meta.dirname, "..", "rates"));
const base = { period: "2026-10" };

// Expected figures below were worked out by hand from the GRA Act 1178 table and the SSNIT 2026 notice.
describe("resident employee", () => {
  const p = calculate({ ...base, basic_salary: 500000, allowances: [{ name: "Transport", amount: 100000 }] }, book);

  it("takes SSNIT from basic salary only", () => {
    expect(p.ssnit).toEqual({ insurable_earnings: 500000, employee: 27500, employer: 65000, total: 92500, tier1: 67500, tier2: 25000 });
  });
  it("taxes allowances and deducts SSNIT before PAYE", () => {
    expect(p.tax.employment_income).toBe(600000);
    expect(p.tax.chargeable_income).toBe(572500);
  });
  it("applies the monthly bands", () => {
    // 0 + 5% of 80 + 10% of 100 + 17.5% of 2,900 + 25% of 2,057 = 4.00 + 10.00 + 507.50 + 514.25
    expect(p.tax.bands.map((b) => b.tax)).toEqual([0, 400, 1000, 50750, 51425]);
    expect(p.tax.paye).toBe(103575);
  });
  it("works out net pay and employer cost", () => {
    expect(p.net_pay).toBe(600000 - 27500 - 103575); // 4,689.25
    expect(p.employer_cost).toBe(665000);
  });
  it("records the rate tables and sources used", () => {
    expect(p.rate_tables.map((t) => t.id)).toEqual(["gh-paye-2026-09", "gh-ssnit-2026-01"]);
    expect(p.rate_tables[0]!.sources[0]!.url).toMatch(/^https:\/\/gra\.gov\.gh\//);
  });
});

describe("SSNIT limits", () => {
  it("caps contributions at the 2026 maximum insurable earnings (GHS 69,000)", () => {
    const p = calculate({ ...base, basic_salary: 10000000 }, book);
    expect(p.ssnit.insurable_earnings).toBe(6900000);
    expect(p.ssnit.tier1).toBe(931500); // GHS 9,315.00, the maximum in SSNIT's notice
    expect(p.ssnit.employee).toBe(379500);
  });
  it("uses the minimum insurable earnings for a very low basic, with a warning", () => {
    const p = calculate({ ...base, basic_salary: 50000 }, book);
    expect(p.ssnit.insurable_earnings).toBe(58780);
    expect(p.ssnit.employee).toBe(3233);
    expect(p.warnings.join(" ")).toMatch(/minimum insurable/);
  });
  it("skips SSNIT for non-members", () => {
    expect(calculate({ ...base, basic_salary: 500000, ssnit_member: false }, book).ssnit.total).toBe(0);
  });
});

describe("top band", () => {
  it("taxes chargeable income over GHS 50,000 at 35%", () => {
    const p = calculate({ ...base, basic_salary: 10000000 }, book);
    expect(p.tax.chargeable_income).toBe(9620500);
    // 13,621.10 on the first 50,000 + 35% of 46,205 = 16,171.75
    expect(p.tax.paye).toBe(1362110 + 1617175);
  });
});

describe("bonus", () => {
  it("taxes bonus at 5% up to 15% of annual basic and adds the rest to income", () => {
    const p = calculate({ ...base, basic_salary: 500000, bonus: 1000000 }, book);
    expect(p.tax.bonus_tax).toBe(45000); // 5% of 9,000
    expect(p.tax.employment_income).toBe(600000); // 5,000 basic + 1,000 over the limit
  });
  it("counts bonus already paid this year against the limit", () => {
    const p = calculate({ ...base, basic_salary: 500000, bonus: 100000, bonus_paid_earlier_this_year: 900000 }, book);
    expect(p.tax.bonus_tax).toBe(0);
    expect(p.tax.employment_income).toBe(600000);
  });
});

describe("overtime", () => {
  it("uses 5% up to half of basic and 10% above for junior staff", () => {
    const p = calculate({ ...base, basic_salary: 100000, overtime: 70000 }, book);
    expect(p.tax.overtime_tax).toBe(2500 + 2000);
  });
  it("taxes overtime as normal income above the qualifying limit", () => {
    const p = calculate({ ...base, basic_salary: 200000, overtime: 50000 }, book);
    expect(p.tax.overtime_tax).toBe(0);
    expect(p.tax.employment_income).toBe(250000);
    expect(p.warnings.join(" ")).toMatch(/junior staff/);
  });
});

describe("non-residents and casual workers", () => {
  it("taxes non-residents at a flat 25%", () => {
    const p = calculate({ ...base, basic_salary: 500000, residency: "non_resident" }, book);
    expect(p.tax.paye).toBe(118125); // 25% of 4,725.00
    expect(p.tax.bands).toEqual([]);
  });
  it("withholds 5% from casual workers", () => {
    const p = calculate({ ...base, basic_salary: 100000, employment: "casual", ssnit_member: false }, book);
    expect(p.tax.total).toBe(5000);
    expect(p.net_pay).toBe(95000);
  });
});

describe("reliefs and deductions", () => {
  it("caps Tier 3 relief at 16.5% of basic but still deducts the full amount", () => {
    const p = calculate({ ...base, basic_salary: 500000, tier3_contribution: 100000 }, book);
    expect(p.tax.chargeable_income).toBe(500000 - 27500 - 82500);
    expect(p.deductions.tier3).toBe(100000);
    expect(p.warnings.join(" ")).toMatch(/Tier 3/);
  });
  it("takes after-tax deductions from net pay only", () => {
    const a = calculate({ ...base, basic_salary: 500000 }, book);
    const b = calculate({ ...base, basic_salary: 500000, deductions: [{ name: "Staff loan", amount: 20000 }] }, book);
    expect(b.tax.total).toBe(a.tax.total);
    expect(b.net_pay).toBe(a.net_pay - 20000);
  });
});

describe("rate tables", () => {
  it("refuses periods with no official table instead of guessing", () => {
    expect(() => calculate({ period: "2026-08", basic_salary: 500000 }, book)).toThrow(NoRateTableError);
  });
  it("monthly bands add up to GHS 50,000 before the top rate", () => {
    const widths = book.paye[0]!.monthly_bands.map((b) => b.width ?? 0);
    expect(widths.reduce((a, b) => a + b)).toBe(5000000);
  });
  it("applyBands rows add up to the amount taxed", () => {
    const rows = applyBands(1234567, book.paye[0]!.monthly_bands);
    expect(rows.reduce((a, r) => a + r.taxed, 0)).toBe(1234567);
  });
});

describe("invariants over many salaries", () => {
  it("keeps the books balanced and tax rising with pay", () => {
    let lastTax = -1;
    for (let basic = 0; basic <= 12000000; basic += 37311) {
      const p = calculate({ ...base, basic_salary: basic, allowances: [{ name: "Rent", amount: 25000 }] }, book);
      expect(p.ssnit.employee + p.ssnit.employer).toBe(p.ssnit.tier1 + p.ssnit.tier2);
      expect(p.net_pay).toBe(p.earnings.gross_cash_pay - p.deductions.total);
      expect(p.tax.bands.reduce((a, b) => a + b.tax, 0)).toBe(p.tax.paye);
      expect(p.tax.paye).toBeGreaterThanOrEqual(lastTax);
      lastTax = p.tax.paye;
    }
  });
});

describe("gross-up", () => {
  it("finds the basic salary for a target net pay", () => {
    const r = grossUp({ ...base, target_net_pay: 468925, allowances: [{ name: "Transport", amount: 100000 }] }, book);
    expect(r.basic_salary).toBe(500000);
    expect(r.payslip.net_pay).toBe(468925);
  });
  it("returns the smallest basic that reaches the target", () => {
    const r = grossUp({ ...base, target_net_pay: 1234567 }, book);
    expect(r.payslip.net_pay).toBeGreaterThanOrEqual(1234567);
    expect(calculate({ ...base, basic_salary: r.basic_salary - 1 }, book).net_pay).toBeLessThan(1234567);
  });
});
