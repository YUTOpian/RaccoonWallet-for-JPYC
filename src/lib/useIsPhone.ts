import { useMediaQuery } from '@mui/material';

// スマホ判定。幅が狭い(縦持ち)か、タッチ端末で高さが低い(横持ち)ときに true。
// タブレット・PC(幅600px以上)は従来どおりサイドメニューのままにする。
// noSsr: 初回描画から正しい値を返し、サイドメニュー→下部ナビのちらつきを防ぐ。
export const PHONE_QUERY = '(max-width: 599.95px), (pointer: coarse) and (max-height: 500px)';

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY, { noSsr: true });
}
