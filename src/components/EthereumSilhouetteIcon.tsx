import type { SxProps, Theme } from '@mui/material';
import { Box } from '@mui/material';

// カスタムEVMネットワーク/トークンのアイコン未選択時に表示する、
// イーサリアムのダイヤモンドロゴをモノトーンのシルエットにしたプレースホルダー。
// Avatarの初期表示（アカウントの人型アイコン）の代わりに使う。
type EthereumSilhouetteIconProps = {
  size?: number;
  sx?: SxProps<Theme>;
};

export default function EthereumSilhouetteIcon({ size = 32, sx }: EthereumSilhouetteIconProps) {
  return (
    <Box
      component="svg"
      viewBox="0 0 32 52"
      sx={{ width: size, height: (size * 52) / 32, display: 'block', color: 'grey.400', ...sx }}
    >
      <path
        d="M16 0 L16 19.4 L1 26.5 Z"
        fill="currentColor"
        opacity={0.55}
      />
      <path
        d="M16 0 L16 19.4 L31 26.5 Z"
        fill="currentColor"
        opacity={0.85}
      />
      <path
        d="M16 22.6 L16 34 L1 29.4 Z"
        fill="currentColor"
        opacity={0.55}
      />
      <path
        d="M16 22.6 L16 34 L31 29.4 Z"
        fill="currentColor"
        opacity={0.85}
      />
      <path
        d="M1 32.8 L16 43.6 L16 52 Z"
        fill="currentColor"
        opacity={0.55}
      />
      <path
        d="M31 32.8 L16 43.6 L16 52 Z"
        fill="currentColor"
        opacity={0.85}
      />
    </Box>
  );
}
