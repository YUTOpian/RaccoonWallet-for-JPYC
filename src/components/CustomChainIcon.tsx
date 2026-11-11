import type { SxProps, Theme } from '@mui/material';
import { Avatar } from '@mui/material';
import EthereumSilhouetteIcon from './EthereumSilhouetteIcon';

// カスタムEVM(設定 > カスタムEVM で追加したネットワーク)のアイコン表示用の共通Avatar。
// assets/icon_menu_ethereum.png は白一色で、SideMenuの濃色サイドバー専用に作られて
// いるため、白背景やグレーのピル(grey.100/grey.200)の上でそのまま使うと消えて見える。
// ここでは、ユーザーが独自アイコンを設定していない場合、代わりにEthereumSilhouetteIcon
// (グレー濃淡のシルエット)をグレーの円背景の上に表示することで、明るい背景でも視認できる
// ようにしている。
type CustomChainIconProps = {
  iconDataUrl?: string;
  size?: number;
  sx?: SxProps<Theme>;
};

export default function CustomChainIcon({ iconDataUrl, size = 32, sx }: CustomChainIconProps) {
  return (
    <Avatar src={iconDataUrl || undefined} sx={{ width: size, height: size, bgcolor: 'grey.200', ...sx }}>
      {!iconDataUrl && <EthereumSilhouetteIcon size={Math.round(size * 0.5)} />}
    </Avatar>
  );
}
