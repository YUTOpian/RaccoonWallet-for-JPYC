import type { ReactNode } from 'react';
import { useState } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useLocation } from 'react-router-dom';
import SideMenu, { SIDE_MENU_COLLAPSED_WIDTH, SIDE_MENU_EXPANDED_WIDTH } from './SideMenu';
import BottomNav, { BOTTOM_NAV_HEIGHT, showsBottomNav } from './BottomNav';
import { useIsPhone } from '../lib/useIsPhone';

// Layout wrapper for every screen that has navigation.
//
// タブレット・PC: ページは常時表示の SideMenu の右側に収まる。メニューが確保する幅は
// CSS変数 --side-menu-w として公開し、ページ内の position:fixed 要素(ビューポート基準)が
//   left: 'var(--side-menu-w, 0px)'
// のようにメニューを避けられるようにしてある。メニューは折りたたみ(アイコンのみ)と
// 展開(アイコン+ラベル+プロフィール)があり、`open` はハンバーガーでの明示的な選択。
//
// スマホ: サイドメニューは出さず、画面下の BottomNav(親指で押せるタブ)に切り替える。
// ページの横幅をメニューに取られないので、画面幅をフルに使える。
//   --side-menu-w   常に 0px(左の余白なし)
//   --bottom-nav-h  下部ナビが占める高さ(ナビを出さない画面では 0px)。画面下に固定する
//                   バーは bottom: 'var(--bottom-nav-h, 0px)' でナビの上に載せる
//   --safe-bottom   ナビが無い画面での、ホームインジケータ分の余白
export default function AppShell({ children }: { children: ReactNode }) {
  const isPhone = useIsPhone();
  const isWide = useMediaQuery((theme: Theme) => theme.breakpoints.up('sm'));
  const { pathname } = useLocation();
  const [open, setOpen] = useState<boolean | null>(null);

  if (isPhone) {
    const withNav = showsBottomNav(pathname);
    const navH = withNav ? `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px))` : '0px';
    return (
      <Box
        sx={{
          '--side-menu-w': '0px',
          '--bottom-nav-h': navH,
          '--safe-bottom': withNav ? '0px' : 'env(safe-area-inset-bottom, 0px)',
          pl: 'env(safe-area-inset-left, 0px)',
          pr: 'env(safe-area-inset-right, 0px)',
          pb: 'var(--bottom-nav-h)',
          minHeight: '100dvh',
          boxSizing: 'border-box',
        }}
      >
        {children}
        {withNav && <BottomNav />}
      </Box>
    );
  }

  const expanded = open ?? isWide;
  const reserved = isWide && expanded ? SIDE_MENU_EXPANDED_WIDTH : SIDE_MENU_COLLAPSED_WIDTH;

  return (
    <Box
      sx={{
        '--side-menu-w': `${reserved}px`,
        '--bottom-nav-h': '0px',
        '--safe-bottom': '0px',
        pl: 'var(--side-menu-w)',
        transition: 'padding-left 200ms ease',
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      {children}
      <SideMenu
        expanded={expanded}
        floating={!isWide}
        onToggle={() => setOpen(!expanded)}
        onNavigate={() => { if (!isWide) setOpen(null); }}
      />
    </Box>
  );
}
