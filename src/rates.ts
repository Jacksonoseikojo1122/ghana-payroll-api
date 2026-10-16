import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const Source = z.object({ title: z.string(), url: z.url(), retrieved: z.string() });
const Band = z.object({ width: z.number().int().positive().nullable(), rate_bp: z.number().int().min(0).max(10000) });
const Bp = z.number().int().min(0).max(10000);

const Base = {
  id: z.string(),
  effective_from: z.iso.date(),
  description: z.string(),
  sources: z.array(Source).min(1),
};

export const PayeTable = z.object({
  ...Base,
  kind: z.literal("paye"),
  monthly_bands: z.array(Band).min(1),
  annual_bands: z.array(Band).min(1),
  non_resident_rate_bp: Bp,
  non_resident_bonus_overtime_rate_bp: Bp,
  casual_rate_bp: Bp,
  bonus: z.object({ rate_bp: Bp, cap_of_annual_basic_bp: Bp }),
  overtime: z.object({
    max_annual_qualifying_income: z.number().int().positive(),
    low_rate_bp: Bp,
    low_cap_of_monthly_basic_bp: Bp,
    high_rate_bp: Bp,
  }),
  provident_relief_cap_of_basic_bp: Bp,
});

export const SsnitTable = z.object({
  ...Base,
  kind: z.literal("ssnit"),
  employee_bp: Bp,
  employer_bp: Bp,
  tier2_bp: Bp,
  min_insurable: z.number().int().positive(),
  max_insurable: z.number().int().positive(),
});

export type PayeTable = z.infer<typeof PayeTable>;
export type SsnitTable = z.infer<typeof SsnitTable>;
export type RateTable = PayeTable | SsnitTable;

export class NoRateTableError extends Error {
  constructor(public kind: string, public date: string, public earliest?: string) {
    super(
      `No official ${kind.toUpperCase()} table is loaded for ${date}.` +
        (earliest ? ` The earliest one starts on ${earliest}.` : ""),
    );
  }
}

/** Every rate table, oldest first. Tables are plain JSON files in /rates so changes show up in review. */
export class RateBook {
  readonly paye: PayeTable[];
  readonly ssnit: SsnitTable[];

  constructor(tables: RateTable[]) {
    const byDate = (a: RateTable, b: RateTable) => a.effective_from.localeCompare(b.effective_from);
    this.paye = tables.filter((t): t is PayeTable => t.kind === "paye").sort(byDate);
    this.ssnit = tables.filter((t): t is SsnitTable => t.kind === "ssnit").sort(byDate);
    for (const t of this.paye) checkBands(t);
  }

  static fromDir(dir: string): RateBook {
    const tables = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
        const parsed = raw.kind === "paye" ? PayeTable.safeParse(raw) : SsnitTable.safeParse(raw);
        if (!parsed.success) throw new Error(`${f}: ${parsed.error.message}`);
        return parsed.data;
      });
    return new RateBook(tables);
  }

  /** The table in force on `date` (YYYY-MM-DD): the latest one that started on or before it. */
  payeFor(date: string): PayeTable {
    return pick(this.paye, "paye", date);
  }
  ssnitFor(date: string): SsnitTable {
    return pick(this.ssnit, "ssnit", date);
  }
}

function pick<T extends RateTable>(tables: T[], kind: string, date: string): T {
  const t = tables.filter((x) => x.effective_from <= date).at(-1);
  if (!t) throw new NoRateTableError(kind, date, tables[0]?.effective_from);
  return t;
}

/** Only the last band may be open-ended, and the monthly bands must be a twelfth of the annual ones. */
function checkBands(t: PayeTable) {
  for (const bands of [t.monthly_bands, t.annual_bands]) {
    bands.forEach((b, i) => {
      if ((b.width === null) !== (i === bands.length - 1)) throw new Error(`${t.id}: only the last band can be open-ended`);
    });
  }
  t.monthly_bands.forEach((b, i) => {
    const annual = t.annual_bands[i];
    if (!annual || annual.rate_bp !== b.rate_bp || (b.width !== null && annual.width !== b.width * 12)) {
      throw new Error(`${t.id}: monthly band ${i + 1} doesn't match the annual table`);
    }
  });
}
