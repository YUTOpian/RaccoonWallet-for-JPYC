import type { TxAnnotationRecord, TxAnnotationTag } from './storage';

// 費目(勘定科目)の候補。分類(売上・経費・私用)の下に付ける自由入力の項目で、会計ソフトに渡す
// 相手勘定科目になる(マネーフォワード形式)。候補にない名前も自由に入力でき、一度使った名前は
// 次回から候補に出る。会計ソフト側に同名の勘定科目が無いと取り込めないので、標準的な名前を並べている。
export const PRESET_CATEGORIES: Record<'sales' | 'expense', string[]> = {
  sales: ['売上高', '雑収入'],
  expense: ['仕入高', '消耗品費', '旅費交通費', '通信費', '接待交際費', '会議費', '外注費', '支払手数料', '雑費'],
};

/** 費目を付けられるのは、売上と経費だけ。 */
export function supportsCategory(tag: TxAnnotationTag): tag is 'sales' | 'expense' {
  return tag === 'sales' || tag === 'expense';
}

/** 入力欄の候補: 既定の候補 + これまでに同じ分類で使った費目(重複なし)。 */
export function categorySuggestions(tag: TxAnnotationTag, annotations: Record<string, TxAnnotationRecord>): string[] {
  if (!supportsCategory(tag)) return [];
  const used = Object.values(annotations)
    .filter((a) => a.tag === tag && a.category)
    .map((a) => a.category as string);
  return [...new Set([...PRESET_CATEGORIES[tag], ...used])];
}
