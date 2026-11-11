import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Avatar, Box, ButtonBase, Drawer, List, ListItemButton, Typography } from '@mui/material';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import SwapHorizOutlinedIcon from '@mui/icons-material/SwapHorizOutlined';
import EventRepeatOutlinedIcon from '@mui/icons-material/EventRepeatOutlined';
import CurrencyYenIcon from '@mui/icons-material/CurrencyYen';
import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined';
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { WalletsHelper, AddressBookHelper } from '../lib/storage';
import type { AddressBookRecord } from '../lib/storage';
import logoPyoko from '../assets/logo_pyoko.png';
import iconMenuEthereum from '../assets/icon_menu_ethereum.png';

// タブ本体の高さ(ホームインジケータ分の safe-area は AppShell 側で足す)。
export const BOTTOM_NAV_HEIGHT = 60;

const INK = '#1c2f2d';
const MUTED = '#5f7f7b';
const ACTIVE = '#00a596';
const LINE = '#d3ebe8';

// 下部ナビを出す画面(各メニューの入口になる画面)。ここ以外の画面は戻る矢印付きの
// 詳細画面・入力フローなので、画面の高さを広く使えるようナビを隠す。
const NAV_PATHS = [
  '/top', '/swap', '/jpyc/exchange', '/balance', '/wallet/select',
  '/addressbook', '/settings/top', '/settings/asset_recovery',
];
export function showsBottomNav(pathname: string): boolean {
  return NAV_PATHS.includes(pathname);
}

type Item = { key: string; title: string; icon: ReactNode; path: string; isActive: boolean };

function MaskIcon({ src, size }: { src: string; size: number }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block', width: size, height: size, bgcolor: 'currentColor',
        maskImage: `url(${src})`, WebkitMaskImage: `url(${src})`,
        maskSize: 'contain', WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center', WebkitMaskPosition: 'center',
      }}
    />
  );
}

// スマホ用のナビゲーション。主要4つ(ホーム/QRラボ/スワップ/アカウント)を親指で押せる
// 下部タブに置き、残り(JPYC発行・償還/トークン/カスタムEVM/設定)は「メニュー」から
// 下から出るシートで開く。
export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [walletName, setWalletName] = useState('');
  const [selfProfile, setSelfProfile] = useState<AddressBookRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const wallet = await WalletsHelper.getActive();
      const self = await AddressBookHelper.getSelf();
      if (cancelled) return;
      setWalletName(wallet === null ? t('common.not_select') : wallet.name);
      setSelfProfile(self);
    })();
    return () => { cancelled = true; };
  }, [t, pathname, search]);

  const hasCustomSelfProfile = selfProfile !== null && (selfProfile.name !== 'GUEST' || selfProfile.iconDataUrl.length > 0);
  const hasIcon = hasCustomSelfProfile && !!selfProfile?.iconDataUrl;

  const tab = new URLSearchParams(search).get('tab');
  const onTop = pathname === '/top';

  const tabs: Item[] = [
    { key: 'home', title: 'Home', icon: <HomeOutlinedIcon />, path: '/top?tab=home', isActive: onTop && tab !== 'qrlab' },
    { key: 'qrlab', title: t('home.nav_qrlab'), icon: <QrCode2Icon />, path: '/top?tab=qrlab', isActive: onTop && tab === 'qrlab' },
    { key: 'swap', title: t('home.nav_swap'), icon: <SwapHorizOutlinedIcon />, path: '/swap', isActive: pathname.startsWith('/swap') },
    { key: 'account', title: t('home.nav_account_short'), icon: <AccountCircleOutlinedIcon />, path: '/wallet/select', isActive: pathname === '/wallet/select' || pathname.startsWith('/addressbook') },
  ];

  const sheetItems: Item[] = [
    { key: 'jpyc-ex', title: t('home.nav_jpyc_ex'), icon: <CurrencyYenIcon />, path: '/jpyc/exchange', isActive: pathname.startsWith('/jpyc') },
    { key: 'token', title: t('home.nav_token'), icon: <ListAltOutlinedIcon />, path: '/balance', isActive: pathname === '/balance' },
    { key: 'scheduled', title: t('scheduled.title'), icon: <EventRepeatOutlinedIcon />, path: '/scheduled', isActive: pathname.startsWith('/scheduled') },
    { key: 'asset-recovery', title: t('asset_recovery.menu_title'), icon: <MaskIcon src={iconMenuEthereum} size={24} />, path: '/settings/asset_recovery', isActive: pathname.startsWith('/settings/asset_recovery') },
    { key: 'settings', title: t('common.settings'), icon: <SettingsOutlinedIcon />, path: '/settings/top', isActive: pathname === '/settings/top' },
  ];
  const menuActive = sheetItems.some((i) => i.isActive);

  const go = (path: string) => {
    setSheetOpen(false);
    navigate(path, { replace: true });
  };

  const renderTab = (key: string, title: string, icon: ReactNode, active: boolean, onClick: () => void) => (
    <ButtonBase
      key={key}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      sx={{
        flex: 1, minWidth: 0, height: BOTTOM_NAV_HEIGHT,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px',
        color: active ? ACTIVE : MUTED, borderRadius: 0,
        '& .MuiSvgIcon-root': { fontSize: 26 },
      }}
    >
      {/* アクティブなタブは、アイコンの背後に丸みのあるピルを敷いて現在地を示す */}
      <Box
        sx={{
          width: 56, height: 30, borderRadius: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: active ? 'rgba(0, 195, 178, 0.16)' : 'transparent', transition: 'background-color 150ms',
        }}
      >
        {icon}
      </Box>
      <Typography noWrap sx={{ fontSize: '0.68rem', lineHeight: 1.1, fontWeight: active ? 700 : 500, color: 'inherit', maxWidth: '100%', px: 0.5 }}>
        {title}
      </Typography>
    </ButtonBase>
  );

  return (
    <>
      <Box
        component="nav"
        aria-label="main"
        sx={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          zIndex: (theme) => theme.zIndex.appBar + 2,
          display: 'flex', alignItems: 'stretch',
          pl: 'env(safe-area-inset-left, 0px)', pr: 'env(safe-area-inset-right, 0px)',
          pb: 'env(safe-area-inset-bottom, 0px)',
          bgcolor: '#fff', borderTop: `1px solid ${LINE}`,
          boxShadow: '0 -4px 16px rgba(10, 50, 46, 0.06)',
        }}
      >
        {tabs.map((i) => renderTab(i.key, i.title, i.icon, i.isActive, () => go(i.path)))}
        {renderTab('menu', t('home.nav_menu'), <MenuIcon />, menuActive || sheetOpen, () => setSheetOpen(true))}
      </Box>

      <Drawer
        anchor="bottom"
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        slotProps={{
          paper: {
            sx: {
              borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80dvh',
              background: 'linear-gradient(180deg, #ffffff 0%, #eef9f7 100%)',
              pb: 'env(safe-area-inset-bottom, 0px)',
            },
          },
        }}
      >
        {/* つまみ(下へ引っ込められることを示す) */}
        <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: LINE, mx: 'auto', mt: 1.25, mb: 1 }} />

        {/* プロフィール: タップで自分のプロフィール編集へ */}
        <Box
          onClick={() => go(`/addressbook/detail?id=${AddressBookHelper.SELF_ID}`)}
          sx={{ display: 'flex', alignItems: 'center', gap: 1.75, px: 2.5, py: 1.25, cursor: 'pointer' }}
        >
          <Avatar src={hasIcon ? selfProfile?.iconDataUrl : undefined} sx={{ width: 48, height: 48, bgcolor: '#c9ece8' }}>
            {!hasIcon && <Box component="img" src={logoPyoko} alt="" sx={{ width: '72%' }} />}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ fontSize: '1.15rem', color: INK, lineHeight: 1.25 }}>
              {hasCustomSelfProfile ? selfProfile?.name : 'GUEST'}
            </Typography>
            <Typography noWrap variant="caption" sx={{ color: MUTED, display: 'block' }}>{walletName}</Typography>
          </Box>
          <ChevronRightIcon sx={{ color: MUTED }} />
        </Box>

        <List disablePadding sx={{ px: 1, pb: 1.5, overflowY: 'auto' }}>
          {sheetItems.map((item) => (
            <ListItemButton
              key={item.key}
              onClick={() => go(item.path)}
              aria-current={item.isActive ? 'page' : undefined}
              sx={{
                minHeight: 56, borderRadius: '16px', gap: 2, px: 2, my: 0.25,
                color: item.isActive ? '#fff' : INK,
                background: item.isActive ? 'linear-gradient(90deg, #00c3b2 0%, #00a596 100%)' : 'transparent',
                '& .item-icon': { color: item.isActive ? '#fff' : MUTED, display: 'flex', width: 28, justifyContent: 'center' },
                '&:hover': { background: item.isActive ? 'linear-gradient(90deg, #00c3b2 0%, #00a596 100%)' : 'rgba(0, 195, 178, 0.10)' },
              }}
            >
              <Box className="item-icon">{item.icon}</Box>
              <Typography sx={{ fontSize: '1.05rem', fontWeight: item.isActive ? 700 : 400, color: 'inherit' }}>{item.title}</Typography>
            </ListItemButton>
          ))}
        </List>
      </Drawer>
    </>
  );
}
