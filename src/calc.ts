import { z } from "zod";
import { ghs, MAX_AMOUNT, pct, rate, sum } from "./money.js";
import type { PayeTable, RateBook, SsnitTable } from "./rates.js";

const Amount = z.number().int("Amounts are whole pesewas, e.g. GHS 1,234.50 is 123450").min(0).max(MAX_AMOUNT);
const Item = z.object({ name: z.string().trim().min(1).max(80), amount: Amount });

export const EmployeeInput = z.object({
  residency: z.enum(["resident", "non_resident"]).default("resident"),
  employment: z.enum(["regular", "casual"]).default("regular"),
  basic_salary: Amount,
  allowances: z.array(Item.extend({ taxable: z.boolean().default(true) })).max(50).default([]),
  benefits_in_kind: z.array(Item).max(50).default([]),
  bonus: Amount.default(0),
  bonus_paid_earlier_this_year: Amount.default(0),
  annual_basic_salary: Amount.optional(),
  overtime: Amount.default(0),
  annual_qualifying_income: Amount.optional(),
  ssnit_member: z.boolean().default(true),
  tier3_contribution: Amount.default(0),
  reliefs: z.array(Item).max(20).default([]),
  deductions: z.array(Item).max(50).default([]),
});

export const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM, e.g. 2026-10");
export const PayslipInput = EmployeeInput.extend({ period: Period });

export type EmployeeInput = z.input<typeof EmployeeInput>;
export type PayslipInput = z.infer<typeof PayslipInput>;

export type BandRow = { from: number; to: number | null; rate_bp: number; taxed: number; tax: number };
export type Step = { step: string; amount: number; working: string };

export type Payslip = {
  period: string;
  rate_tables: { id: string; effective_from: string; sources: { title: string; url: string }[] }[];
  earnings: {
    basic_salary: number;
    taxable_allowances: number;
    non_taxable_allowances: number;
    bonus: number;
    overtime: number;
    gross_cash_pay: number;
    benefits_in_kind: number;
  };
  ssnit: { insurable_earnings: number; employee: number; employer: number; total: number; tier1: number; tier2: number };
  tax: {
    method: "graduated" | "non_resident_flat" | "casual_flat";
    employment_income: number;
    chargeable_income: number;
    paye: number;
    bonus_tax: number;
    overtime_tax: number;
    total: number;
    bands: BandRow[];
  };
  deductions: { ssnit_employee: number; tier3: number; tax: number; other: number; total: number };
  net_pay: number;
  employer_cost: number;
  working: Step[];
  warnings: string[];
};

/** Tax on `amount` across graduated bands. Each band's tax is rounded to the pesewa, so the rows add up to the total. */
export function applyBands(amount: number, bands: PayeTable["monthly_bands"]): BandRow[] {
  const rows: BandRow[] = [];
  let from = 0;
  for (const b of bands) {
    if (amount <= from) break;
    const to = b.width === null ? null : from + b.width;
    const taxed = (to === null ? amount : Math.min(amount, to)) - from;
    rows.push({ from, to, rate_bp: b.rate_bp, taxed, tax: pct(taxed, b.rate_bp) });
    if (to === null) break;
    from = to;
  }
  return rows;
}

/** One month's payslip, worked out the way GRA and SSNIT describe it. */
export function calculate(raw: z.input<typeof PayslipInput>, book: RateBook): Payslip {
  const input = PayslipInput.parse(raw);
  const date = `${input.period}-01`;
  const paye = book.payeFor(date);
  const ssnitT = book.ssnitFor(date);
  const working: Step[] = [];
  const warnings: string[] = [];
  const add = (step: string, amount: number, text: string) => working.push({ step, amount, working: text });

  // --- Earnings -------------------------------------------------------------
  const basic = input.basic_salary;
  const taxableAllow = sum(input.allowances.filter((a) => a.taxable).map((a) => a.amount));
  const nonTaxableAllow = sum(input.allowances.filter((a) => !a.taxable).map((a) => a.amount));
  const bik = sum(input.benefits_in_kind.map((b) => b.amount));
  const gross = basic + taxableAllow + nonTaxableAllow + input.bonus + input.overtime;
  add("gross_cash_pay", gross, `basic ${ghs(basic)} + taxable allowances ${ghs(taxableAllow)} + non-taxable allowances ${ghs(nonTaxableAllow)} + bonus ${ghs(input.bonus)} + overtime ${ghs(input.overtime)}`);
  if (nonTaxableAllow > 0) {
    warnings.push("Allowances marked non-taxable are paid but not taxed. GRA treats cash allowances as taxable, so only use this for genuine exemptions such as reimbursed expenses.");
  }

  // --- SSNIT ----------------------------------------------------------------
  const ssnit = ssnitFor(basic, input.ssnit_member, ssnitT, add, warnings);

  // --- Tax ------------------------------------------------------------------
  let tax: Payslip["tax"];
  const tier3 = input.tier3_contribution;
  if (input.employment === "casual") {
    const base = basic + taxableAllow + input.bonus + input.overtime;
    const t = pct(base, paye.casual_rate_bp);
    add("casual_tax", t, `${rate(paye.casual_rate_bp)} of ${ghs(base)} paid to a casual worker`);
    if (input.reliefs.length || tier3) warnings.push("Reliefs and Tier 3 relief don't apply to the flat casual-worker tax, so they were ignored for tax.");
    tax = { method: "casual_flat", employment_income: base, chargeable_income: base, paye: t, bonus_tax: 0, overtime_tax: 0, total: t, bands: [] };
  } else {
    tax = employmentTax(input, paye, basic, taxableAllow, bik, ssnit.employee, add, warnings);
  }

  // --- Net ------------------------------------------------------------------
  const other = sum(input.deductions.map((d) => d.amount));
  const totalDeductions = ssnit.employee + tier3 + tax.total + other;
  const net = gross - totalDeductions;
  add("net_pay", net, `gross ${ghs(gross)} − SSNIT ${ghs(ssnit.employee)} − Tier 3 ${ghs(tier3)} − tax ${ghs(tax.total)} − other deductions ${ghs(other)}`);
  if (net < 0) warnings.push("Deductions are larger than pay for this period: net pay is negative.");
  const employerCost = gross + ssnit.employer;
  add("employer_cost", employerCost, `gross ${ghs(gross)} + employer SSNIT ${ghs(ssnit.employer)} (benefits in kind not included)`);

  return {
    period: input.period,
    rate_tables: [paye, ssnitT].map((t) => ({
      id: t.id,
      effective_from: t.effective_from,
      sources: t.sources.map(({ title, url }) => ({ title, url })),
    })),
    earnings: {
      basic_salary: basic,
      taxable_allowances: taxableAllow,
      non_taxable_allowances: nonTaxableAllow,
      bonus: input.bonus,
      overtime: input.overtime,
      gross_cash_pay: gross,
      benefits_in_kind: bik,
    },
    ssnit,
    tax,
    deductions: { ssnit_employee: ssnit.employee, tier3, tax: tax.total, other, total: totalDeductions },
    net_pay: net,
    employer_cost: employerCost,
    working,
    warnings,
  };
}

function ssnitFor(
  basic: number,
  member: boolean,
  t: SsnitTable,
  add: (s: string, a: number, w: string) => void,
  warnings: string[],
): Payslip["ssnit"] {
  if (!member || basic === 0) {
    add("ssnit", 0, member ? "No basic salary, so no SSNIT contribution" : "Not an SSNIT member: no contribution");
    return { insurable_earnings: 0, employee: 0, employer: 0, total: 0, tier1: 0, tier2: 0 };
  }
  const insurable = Math.min(Math.max(basic, t.min_insurable), t.max_insurable);
  if (basic > t.max_insurable) {
    add("ssnit_insurable", insurable, `basic ${ghs(basic)} is above the maximum insurable earnings, so contributions use ${ghs(t.max_insurable)}`);
  } else if (basic < t.min_insurable) {
    add("ssnit_insurable", insurable, `basic ${ghs(basic)} is below the minimum insurable earnings, so contributions use ${ghs(t.min_insurable)}`);
    warnings.push("Basic salary is below SSNIT's minimum insurable earnings, so SSNIT is worked out on the minimum. The employee contribution is more than 5.5% of their actual basic.");
  } else {
    add("ssnit_insurable", insurable, `basic salary ${ghs(basic)}`);
  }
  // Round the totals once, then split, so employee + employer always equals Tier 1 + Tier 2.
  const total = pct(insurable, t.employee_bp + t.employer_bp);
  const employee = pct(insurable, t.employee_bp);
  const employer = total - employee;
  const tier2 = pct(insurable, t.tier2_bp);
  const tier1 = total - tier2;
  add("ssnit_employee", employee, `${rate(t.employee_bp)} of ${ghs(insurable)}, deducted from pay`);
  add("ssnit_employer", employer, `${rate(t.employer_bp)} of ${ghs(insurable)}, paid by the employer on top of pay`);
  add("ssnit_tier1", tier1, `${rate(t.employee_bp + t.employer_bp - t.tier2_bp)} of ${ghs(insurable)}, remitted to SSNIT`);
  add("ssnit_tier2", tier2, `${rate(t.tier2_bp)} of ${ghs(insurable)}, remitted to the Tier 2 trustee`);
  return { insurable_earnings: insurable, employee, employer, total, tier1, tier2 };
}

function employmentTax(
  input: PayslipInput,
  t: PayeTable,
  basic: number,
  taxableAllow: number,
  bik: number,
  ssnitEmployee: number,
  add: (s: string, a: number, w: string) => void,
  warnings: string[],
): Payslip["tax"] {
  const nonResident = input.residency === "non_resident";
  let bonusTax = 0;
  let bonusExcess = 0;
  let overtimeTax = 0;
  let overtimeAsIncome = 0;

  // Bonus: a low flat rate up to 15% of annual basic for the year; anything over joins normal income.
  if (input.bonus > 0) {
    if (nonResident) {
      bonusTax = pct(input.bonus, t.non_resident_bonus_overtime_rate_bp);
      add("bonus_tax", bonusTax, `non-resident: ${rate(t.non_resident_bonus_overtime_rate_bp)} of bonus ${ghs(input.bonus)}`);
    } else {
      const annualBasic = input.annual_basic_salary ?? basic * 12;
      const cap = Math.max(0, pct(annualBasic, t.bonus.cap_of_annual_basic_bp) - input.bonus_paid_earlier_this_year);
      const low = Math.min(input.bonus, cap);
      bonusExcess = input.bonus - low;
      bonusTax = pct(low, t.bonus.rate_bp);
      add(
        "bonus_tax",
        bonusTax,
        `${rate(t.bonus.rate_bp)} of ${ghs(low)} (bonus allowance left this year: ${rate(t.bonus.cap_of_annual_basic_bp)} of annual basic ${ghs(annualBasic)}, less ${ghs(input.bonus_paid_earlier_this_year)} already paid)` +
          (bonusExcess ? `; the other ${ghs(bonusExcess)} is added to income and taxed at the normal rates` : ""),
      );
    }
  }

  // Overtime: only junior staff on qualifying income up to the limit get the overtime rates.
  if (input.overtime > 0) {
    if (nonResident) {
      overtimeTax = pct(input.overtime, t.non_resident_bonus_overtime_rate_bp);
      add("overtime_tax", overtimeTax, `non-resident: ${rate(t.non_resident_bonus_overtime_rate_bp)} of overtime ${ghs(input.overtime)}`);
    } else {
      const qualifying = input.annual_qualifying_income ?? (basic + taxableAllow) * 12;
      if (qualifying <= t.overtime.max_annual_qualifying_income) {
        const half = pct(basic, t.overtime.low_cap_of_monthly_basic_bp);
        const low = Math.min(input.overtime, half);
        const high = input.overtime - low;
        overtimeTax = pct(low, t.overtime.low_rate_bp) + pct(high, t.overtime.high_rate_bp);
        add(
          "overtime_tax",
          overtimeTax,
          `${rate(t.overtime.low_rate_bp)} of ${ghs(low)} (up to ${rate(t.overtime.low_cap_of_monthly_basic_bp)} of basic)` +
            (high ? ` + ${rate(t.overtime.high_rate_bp)} of the remaining ${ghs(high)}` : ""),
        );
      } else {
        overtimeAsIncome = input.overtime;
        warnings.push(
          `Overtime rates only apply to junior staff whose qualifying income for the year is at most GHS ${ghs(t.overtime.max_annual_qualifying_income)}. This employee's is ${ghs(qualifying)}, so the overtime was taxed as normal income.`,
        );
      }
    }
  }

  const employmentIncome = basic + taxableAllow + bik + bonusExcess + overtimeAsIncome;
  add("employment_income", employmentIncome, `basic ${ghs(basic)} + taxable allowances ${ghs(taxableAllow)} + benefits in kind ${ghs(bik)}` + (bonusExcess ? ` + bonus over the limit ${ghs(bonusExcess)}` : "") + (overtimeAsIncome ? ` + overtime ${ghs(overtimeAsIncome)}` : ""));

  const tier3Cap = pct(basic, t.provident_relief_cap_of_basic_bp);
  const tier3Relief = Math.min(input.tier3_contribution, tier3Cap);
  if (input.tier3_contribution > tier3Cap) {
    warnings.push(`Only ${ghs(tier3Cap)} of the Tier 3 contribution (${rate(t.provident_relief_cap_of_basic_bp)} of basic) reduces tax. The rest is still deducted from pay.`);
  }
  const otherReliefs = sum(input.reliefs.map((r) => r.amount));
  const chargeable = Math.max(0, employmentIncome - ssnitEmployee - tier3Relief - otherReliefs);
  add("chargeable_income", chargeable, `employment income ${ghs(employmentIncome)} − SSNIT ${ghs(ssnitEmployee)} − Tier 3 relief ${ghs(tier3Relief)} − other reliefs ${ghs(otherReliefs)}`);

  let paye: number;
  let bands: BandRow[] = [];
  if (nonResident) {
    paye = pct(chargeable, t.non_resident_rate_bp);
    add("paye", paye, `non-resident: flat ${rate(t.non_resident_rate_bp)} of ${ghs(chargeable)}`);
  } else {
    bands = applyBands(chargeable, t.monthly_bands);
    paye = sum(bands.map((b) => b.tax));
    const parts = bands.filter((b) => b.taxed > 0).map((b) => `${rate(b.rate_bp)} × ${ghs(b.taxed)}`);
    add("paye", paye, `monthly bands (${t.id}): ${parts.join(" + ")}`);
  }

  const total = paye + bonusTax + overtimeTax;
  add("total_tax", total, `PAYE ${ghs(paye)} + bonus tax ${ghs(bonusTax)} + overtime tax ${ghs(overtimeTax)}`);
  return {
    method: nonResident ? "non_resident_flat" : "graduated",
    employment_income: employmentIncome,
    chargeable_income: chargeable,
    paye,
    bonus_tax: bonusTax,
    overtime_tax: overtimeTax,
    total,
    bands,
  };
}
