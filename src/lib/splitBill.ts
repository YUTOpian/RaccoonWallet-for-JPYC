import { Decimal } from 'decimal.js';

// 割り勘・立替精算の金額計算。合計を「最小単位(JPYCなら1円、USDCなら0.01)」の整数に直して割るので、
// 端数がどこへ行くかが常にはっきりしていて、請求額の合計が必ず合計金額と一致する。
//
// - includeSelf = true  : 人数に自分を含める。請求するのは (人数 - 1) 人で、端数は自分が負担する。
// - includeSelf = false : 人数全員に請求する。端数は先頭の人から1単位ずつ上乗せする。
export interface SplitResult {
  /** 請求する各人の金額(請求順)。 */
  shares: Decimal[];
  /** includeSelf のときの自分の負担額(端数込み)。それ以外は null。 */
  selfShare: Decimal | null;
  /** 実際に分割した合計(最小単位未満は切り捨て)。 */
  effectiveTotal: Decimal;
}

export const MAX_SPLIT_PEOPLE = 30;

export function splitBill(total: Decimal, people: number, includeSelf: boolean, step: Decimal): SplitResult | null {
  if (!Number.isInteger(people) || people < (includeSelf ? 2 : 1) || people > MAX_SPLIT_PEOPLE) return null;
  if (!total.isFinite() || total.lessThanOrEqualTo(0) || step.lessThanOrEqualTo(0)) return null;

  const units = total.div(step).floor();
  if (units.lessThan(people)) return null; // 1人あたり最小単位に満たない

  const base = units.div(people).floor();
  const remainder = units.minus(base.mul(people));
  const payers = includeSelf ? people - 1 : people;

  const shares = Array.from({ length: payers }, (_, i) => {
    const extra = !includeSelf && new Decimal(i).lessThan(remainder) ? 1 : 0;
    return base.plus(extra).mul(step);
  });
  return {
    shares,
    selfShare: includeSelf ? base.plus(remainder).mul(step) : null,
    effectiveTotal: units.mul(step),
  };
}
