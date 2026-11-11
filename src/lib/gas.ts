import Decimal from 'decimal.js';

/**
 * ガス代まわりの純粋な計算(画面・通信から切り離してテストできるように)。
 * 手数料は送信直前に動くので、足りるかどうかの判定には余裕(FEE_MARGIN 倍)を見込む。
 */
export const FEE_MARGIN = 1.2;
/** 「目安」として案内する、送金何回分のガス代か。 */
export const SUGGEST_TRANSFERS = 10;

export type GasStatus = 'unknown' | 'ok' | 'low' | 'empty';

export interface GasAssessment {
  status: GasStatus;
  /** この送金に必要なネイティブ通貨(手数料+余裕、ネイティブ送金なら送金額も)。unknown なら null。 */
  need: string | null;
  /** 不足分(足りている/不明なら '0')。 */
  shortfall: string;
}

function parse(value: string | null | undefined): Decimal | null {
  if (value == null || value.trim() === '') return null;
  try {
    const d = new Decimal(value);
    return d.isFinite() && !d.isNegative() ? d : null;
  } catch {
    return null;
  }
}

/** Decimal を指数表記なしの文字列にする。 */
const plain = (d: Decimal) => d.toFixed();

export function assessGas(input: {
  /** 見積りした手数料(ネイティブ通貨)。取れなかった/計算中は null。 */
  fee: string | null;
  /** 残高(ネイティブ通貨)。取れなかった場合は null。 */
  balance: string | null;
  /** ネイティブ通貨そのものを送る場合の送金額。JPYC/トークン送金では '0'。 */
  nativeSendAmount?: string;
}): GasAssessment {
  const fee = parse(input.fee);
  const balance = parse(input.balance);
  if (fee === null || balance === null) return { status: 'unknown', need: null, shortfall: '0' };
  const sendAmount = parse(input.nativeSendAmount ?? '0') ?? new Decimal(0);
  const need = fee.mul(FEE_MARGIN).add(sendAmount);
  if (balance.gte(need)) return { status: 'ok', need: plain(need), shortfall: '0' };
  return { status: balance.isZero() ? 'empty' : 'low', need: plain(need), shortfall: plain(need.sub(balance)) };
}

/** ネイティブ通貨の量を円にする。換算レートが無い/不正なら null。 */
export function toJpy(native: string | null, rate: number | null | undefined): number | null {
  const amount = parse(native);
  if (amount === null || rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  return amount.mul(rate).toNumber();
}

/** 円の表示用文字列(¥なし)。1円未満は小数2桁、それ以上は整数に丸める。 */
export function formatYen(yen: number): string {
  if (yen <= 0) return '0';
  if (yen < 0.01) return '0.01未満';
  if (yen < 1) return yen.toFixed(2);
  if (yen < 10) return yen.toFixed(1).replace(/\.0$/, '');
  return Math.round(yen).toLocaleString('ja-JP');
}

/** ネイティブ通貨の表示用(有効数字を絞る)。 */
export function formatNative(value: string): string {
  const d = parse(value);
  if (d === null) return value;
  if (d.isZero()) return '0';
  return plain(d.toSignificantDigits(3, Decimal.ROUND_UP));
}

/** 送金SUGGEST_TRANSFERS回分の目安(手数料×余裕×回数)。 */
export function suggestedTopUp(fee: string | null): string | null {
  const d = parse(fee);
  return d === null ? null : plain(d.mul(FEE_MARGIN).mul(SUGGEST_TRANSFERS));
}
