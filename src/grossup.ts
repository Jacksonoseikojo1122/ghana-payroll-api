import { z } from "zod";
import { calculate, EmployeeInput, Period, type Payslip } from "./calc.js";
import { MAX_AMOUNT } from "./money.js";
import type { RateBook } from "./rates.js";

export const GrossUpInput = EmployeeInput.omit({ basic_salary: true }).extend({
  period: Period,
  target_net_pay: z.number().int().min(0).max(MAX_AMOUNT),
});

export class GrossUpError extends Error {}

/**
 * The smallest basic salary whose net pay is at least `target_net_pay`, with everything else
 * (allowances, bonus, deductions...) held as given. Net pay rises with basic salary, so a binary
 * search over whole pesewas finds it in about 40 steps.
 */
export function grossUp(raw: z.input<typeof GrossUpInput>, book: RateBook): { basic_salary: number; payslip: Payslip } {
  const { target_net_pay, ...rest } = GrossUpInput.parse(raw);
  const run = (basic: number) => calculate({ ...rest, basic_salary: basic }, book);

  if (run(0).net_pay >= target_net_pay) return { basic_salary: 0, payslip: run(0) };
  let lo = 0;
  let hi = 1_000;
  while (run(hi).net_pay < target_net_pay) {
    lo = hi;
    hi *= 2;
    if (hi > MAX_AMOUNT) throw new GrossUpError("That net pay can't be reached with a basic salary under GHS 1 billion");
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (run(mid).net_pay >= target_net_pay) hi = mid;
    else lo = mid;
  }
  return { basic_salary: hi, payslip: run(hi) };
}
