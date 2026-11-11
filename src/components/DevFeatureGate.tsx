import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';

// 開発中の機能(dApp接続・NFT)の画面を包む。非表示のままURLを直接開かれても入れないよう、
// 解除されていなければホームへ戻す。解除は 設定 画面の最下部の表記を7回タップ。
export default function DevFeatureGate({ children }: { children: ReactElement }) {
  const unlocked = useAppStore((s) => s.devFeaturesUnlocked);
  if (!unlocked) {
    return <Navigate to="/top?tab=home" replace />;
  }
  return children;
}
