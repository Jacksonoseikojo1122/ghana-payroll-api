// All money is integer pesewas (GHS 1.00 = 100). Rates are basis points (17.5% = 1750).

/** Largest amount accepted anywhere: GHS 1 billion. Keeps amount × rate inside Number's safe range. */
export const MAX_AMOUNT = 100_000_000_000;

/** amount × bp / 10000, rounded half up to the nearest pesewa. */
export function pct(amount: number, bp: number): number {
  if (amount <= 0 || bp <= 0) return 0;
  return Math.floor((amount * bp + 5000) / 10000);
}

/** 123456 -> "1,234.56" */
export function ghs(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const a = Math.abs(amount);
  const whole = Math.floor(a / 100).toLocaleString("en-US");
  return `${sign}${whole}.${String(a % 100).padStart(2, "0")}`;
}

/** 1750 -> "17.5%" */
export function rate(bp: number): string {
  return `${bp / 100}%`;
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
