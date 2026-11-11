import {Decimal} from 'decimal.js'

export function getDivided(value: number, divisibility: number): Decimal {
  return new Decimal(value).div(10 ** divisibility);
}

export function roundAt(value: number, precision: number): Decimal {
  return new Decimal(value).mul(10 ** precision).round().div(10 ** precision)
}

/**
 * Converts a user-facing display amount (e.g. "123456789.123456", as typed on the send
 * screen) into the chain's smallest unit (micro-XEM, micro-XYM, or a token's raw integer
 * units) as a BigInt.
 *
 * Deliberately string-based via Decimal.js rather than `Number(display) * 10 ** divisibility`:
 * `Number` is an IEEE-754 double with only ~15-17 significant decimal digits of precision, so
 * for large-supply, high-divisibility assets (XEM: divisibility 6, ~9x10^9 total supply -> up
 * to ~9x10^15 micro-XEM, right at Number.MAX_SAFE_INTEGER) that multiplication can round to the
 * wrong integer and silently send a slightly different amount than what the user typed/confirmed.
 * Decimal.js keeps the full decimal string precision through the multiply-and-round step, so the
 * result always matches the displayed amount exactly.
 *
 * @param display Amount as typed by the user (empty string treated as 0).
 * @param divisibility Number of decimal places the chain/token uses.
 */
export function toRawAmount(display: string | number, divisibility: number): bigint {
  const input = display === '' || display === null || display === undefined ? '0' : display;
  const raw = new Decimal(input).mul(new Decimal(10).pow(divisibility)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return BigInt(raw.toFixed(0));
}
