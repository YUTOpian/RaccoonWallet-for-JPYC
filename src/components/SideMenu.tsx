import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Avatar, Box, Divider, IconButton, List, ListItemButton, Tooltip, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import SwapHorizOutlinedIcon from '@mui/icons-material/SwapHorizOutlined';
import EventRepeatOutlinedIcon from '@mui/icons-material/EventRepeatOutlined';
import CurrencyYenIcon from '@mui/icons-material/CurrencyYen';
import LinkIcon from '@mui/icons-material/Link';
import CollectionsOutlinedIcon from '@mui/icons-material/CollectionsOutlined';
import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined';
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { WalletsHelper, AddressBookHelper } from '../lib/storage';
import { useAppStore } from '../store/appStore';
import type { AddressBookRecord } from '../lib/storage';
import logoPyoko from '../assets/logo_pyoko.png';
import logoRaccoonWordmark from '../assets/logo_raccoon_wordmark_2line.png';
import iconMenuEthereum from '../assets/icon_menu_ethereum.png';

export const SIDE_MENU_COLLAPSED_WIDTH = 76;
export const SIDE_MENU_EXPANDED_WIDTH = 264;

// Palette of the menu (light mint panel, app-primary green accent for the current page).
const INK = '#1c2f2d';
const MUTED = '#5f7f7b';
const ACCENT_GRADIENT = 'linear-gradient(90deg, #00c3b2 0%, #00a596 100%)';

interface SideMenuProps {
  expanded: boolean;
  // True on phones: the expanded menu overlays the page (with a tap-away backdrop) rather
  // than pushing it aside.
  floating: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}

type Item = {
  key: string;
  title: string;
  // An MUI icon, or an image URL (the EVM logos, which are white-on-transparent
  // PNGs) that gets tinted to the text color via a CSS mask.
  icon: ReactNode | string;
  path: string;
  isActive: boolean;
  sub?: boolean;
  // 指定があれば、画面遷移の代わりにこれを実行する。
  onClick?: () => void;
};

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

// The side menu replaces the old hamburger drawer and every bottom navigation bar - all
// destinations live here, always on screen.
export default function SideMenu({ expanded, floating, onToggle, onNavigate }: SideMenuProps) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { t } = useTranslation();
  const devFeaturesUnlocked = useAppStore((s) => s.devFeaturesUnlocked);
  const setDevFeaturesUnlocked = useAppStore((s) => s.setDevFeaturesUnlocked);
  const devTapsRef = useRef<number[]>([]);
  const [walletName, setWalletName] = useState('');
  const [selfProfile, setSelfProfile] = useState<AddressBookRecord | null>(null);

  // ハンバーガーボタンを10秒以内に20回押すと、開発中の機能(dApp接続・NFT)が出る。
  // 通知は出さない(メニューに項目が増えるだけ)。ボタン本来の開閉は、そのまま働く。
  const DEV_TAPS = 20;
  const DEV_WINDOW_MS = 10000;
  const onHamburger = () => {
    onToggle();
    if (devFeaturesUnlocked) return;
    const now = Date.now();
    const taps = devTapsRef.current.filter((x) => now - x <= DEV_WINDOW_MS);
    taps.push(now);
    devTapsRef.current = taps;
    if (taps.length >= DEV_TAPS) {
      devTapsRef.current = [];
      setDevFeaturesUnlocked(true);
    }
  };

  // Re-read on navigation: the active wallet and the self-profile can change on other
  // screens, and this component stays mounted across them.
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
  const mainItems: Item[] = [
    // Home's own in-page tabs: anything on /top other than QR Lab (home, receive, send,
    // scan) counts as Home - receive/send are reached from Home's buttons, not this menu.
    { key: 'home', title: 'Home', icon: <HomeOutlinedIcon />, path: '/top?tab=home', isActive: onTop && tab !== 'qrlab' },
    { key: 'qrlab', title: t('home.nav_qrlab'), icon: <QrCode2Icon />, path: '/top?tab=qrlab', isActive: onTop && tab === 'qrlab' },
    { key: 'swap', title: t('home.nav_swap'), icon: <SwapHorizOutlinedIcon />, path: '/swap', isActive: pathname.startsWith('/swap') },
    { key: 'jpyc-ex', title: t('home.nav_jpyc_ex'), icon: <CurrencyYenIcon />, path: '/jpyc/exchange', isActive: pathname.startsWith('/jpyc') },
    { key: 'token', title: t('home.nav_token'), icon: <ListAltOutlinedIcon />, path: '/balance', isActive: pathname === '/balance' },
    // 開発中の機能。設定画面の隠し操作で解除するまでは出さない。
    ...(devFeaturesUnlocked ? [
      { key: 'dapp', title: t('dapp.title'), icon: <LinkIcon />, path: '/dapp', isActive: pathname === '/dapp' },
      { key: 'nft', title: t('nft.title'), icon: <CollectionsOutlinedIcon />, path: '/nft', isActive: pathname === '/nft' },
    ] : []),
    { key: 'scheduled', title: t('scheduled.title'), icon: <EventRepeatOutlinedIcon />, path: '/scheduled', isActive: pathname.startsWith('/scheduled') },
    { key: 'account', title: t('home.nav_account'), icon: <AccountCircleOutlinedIcon />, path: '/wallet/select', isActive: pathname === '/wallet/select' || pathname.startsWith('/addressbook') },
  ];

  const chainItems: Item[] = [
    { key: 'asset-recovery', title: t('asset_recovery.menu_title'), icon: iconMenuEthereum, path: '/settings/asset_recovery', isActive: pathname.startsWith('/settings/asset_recovery') },
  ];

  const footerItems: Item[] = [
    { key: 'settings', title: t('common.settings'), icon: <SettingsOutlinedIcon />, path: '/settings/top', isActive: pathname === '/settings/top' },
    // 解除中だけ、設定ボタンの下に「非表示にする」ボタンを出す。
    ...(devFeaturesUnlocked ? [
      { key: 'hide-dev', title: t('settings.hide_dev_features'), icon: <VisibilityOffOutlinedIcon />, path: '', isActive: false, onClick: () => setDevFeaturesUnlocked(false) },
    ] : []),
  ];

  const go = (path: string) => {
    navigate(path, { replace: true });
    onNavigate();
  };

  const renderItem = (item: Item) => {
    const iconSize = item.sub ? 20 : 24;
    return (
      <Tooltip key={item.key} title={expanded ? '' : item.title} placement="right" enterDelay={400}>
        <ListItemButton
          onClick={() => (item.onClick ? item.onClick() : go(item.path))}
          aria-current={item.isActive ? 'page' : undefined}
          sx={{
            mx: 1, my: 0.25, borderRadius: '16px', minHeight: item.sub ? 44 : 52,
            // Expanded: icon + label in a row. Collapsed: icon only, centred.
            justifyContent: expanded ? 'flex-start' : 'center',
            gap: 2, px: expanded ? 2.5 : 0, ml: expanded && item.sub ? 3 : 1,
            color: item.isActive ? '#fff' : INK,
            background: item.isActive ? ACCENT_GRADIENT : 'transparent',
            boxShadow: item.isActive ? '0 10px 24px rgba(0, 195, 178, 0.32)' : 'none',
            transition: 'background-color 150ms, box-shadow 150ms',
            '&:hover': { background: item.isActive ? ACCENT_GRADIENT : 'rgba(0, 195, 178, 0.10)' },
            '& .item-icon': { color: item.isActive ? '#fff' : MUTED, display: 'flex', '& .MuiSvgIcon-root': { fontSize: iconSize } },
          }}
        >
          <Box className="item-icon" sx={{ width: 28, justifyContent: 'center', flexShrink: 0 }}>
            {typeof item.icon === 'string' ? <MaskIcon src={item.icon} size={iconSize} /> : item.icon}
          </Box>
          {expanded && (
            <Typography noWrap sx={{ fontSize: item.sub ? '0.9rem' : '1.05rem', fontWeight: item.isActive ? 700 : 400, color: 'inherit' }}>
              {item.title}
            </Typography>
          )}
        </ListItemButton>
      </Tooltip>
    );
  };

  const width = expanded ? SIDE_MENU_EXPANDED_WIDTH : SIDE_MENU_COLLAPSED_WIDTH;

  return (
    <>
      {/* Phone only: tap outside the floating menu to fold it back to the rail. */}
      {floating && expanded && (
        <Box
          onClick={onToggle}
          sx={{ position: 'fixed', inset: 0, zIndex: (theme) => theme.zIndex.appBar + 1, bgcolor: 'rgba(10, 40, 36, 0.28)' }}
        />
      )}
      <Box
        component="nav"
        aria-label="main"
        sx={{
          position: 'fixed', top: 0, left: 0, bottom: 0, width,
          zIndex: (theme) => theme.zIndex.appBar + 2,
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto', overflowX: 'hidden',
          background: 'linear-gradient(180deg, #ffffff 0%, #e8f7f5 100%)',
          borderRight: '1px solid #d3ebe8',
          boxShadow: floating && expanded ? '8px 0 32px rgba(10, 50, 46, 0.18)' : 'none',
          transition: 'width 200ms ease',
        }}
      >
        <Box sx={{ pt: 1.5, pb: 1.5, borderBottom: '1px solid #d3ebe8', flexShrink: 0 }}>
          {/* Logo: the wordmark lives here now that the top app bar is gone (no icon). Shown only
              when expanded; the rail just has the hamburger. Tapping the wordmark goes Home. */}
          {/* ハンバーガーボタンの右にワードマークを置く。ワードマークは2段組で、
              「Raccoon Wallet」の下に「for JPYC」が来る。 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <IconButton onClick={onHamburger} aria-label="menu" sx={{ ml: expanded ? 1.5 : 'auto', mr: expanded ? 0 : 'auto', display: 'flex', color: INK, flexShrink: 0 }}>
              <MenuIcon />
            </IconButton>
            {expanded && (
              <Box
                component="img" src={logoRaccoonWordmark} alt="Raccoon Wallet for JPYC" onClick={() => go('/top?tab=home')}
                sx={{ display: 'block', height: 30, width: 'auto', maxWidth: 'calc(100% - 64px)', minWidth: 0, objectFit: 'contain', objectPosition: 'left center', cursor: 'pointer' }}
              />
            )}
          </Box>
          {/* Profile: tapping opens the self-profile editor, same as the old drawer header. */}
          <Box
            onClick={() => go(`/addressbook/detail?id=${AddressBookHelper.SELF_ID}`)}
            sx={{
              mt: 1, px: expanded ? 1.75 : 0, display: 'flex', alignItems: 'center', gap: 1.75, cursor: 'pointer',
              justifyContent: expanded ? 'flex-start' : 'center', minWidth: 0,
            }}
          >
            <Avatar
              src={hasIcon ? selfProfile?.iconDataUrl : undefined}
              sx={{ width: 48, height: 48, bgcolor: '#c9ece8', flexShrink: 0 }}
            >
              {!hasIcon && <Box component="img" src={logoPyoko} alt="" sx={{ width: '72%' }} />}
            </Avatar>
            {expanded && (
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: '1.25rem', color: INK, lineHeight: 1.25 }}>
                  {hasCustomSelfProfile ? selfProfile?.name : 'GUEST'}
                </Typography>
                <Typography noWrap variant="caption" sx={{ color: MUTED, display: 'block' }}>{walletName}</Typography>
              </Box>
            )}
          </Box>
        </Box>

        <List disablePadding sx={{ flexGrow: 1, py: 1 }}>
          {mainItems.map(renderItem)}
          <Divider sx={{ my: 1, mx: 1, borderColor: '#d3ebe8' }} />
          {chainItems.map(renderItem)}
          <Divider sx={{ my: 1, mx: 1, borderColor: '#d3ebe8' }} />
          {footerItems.map(renderItem)}
        </List>
      </Box>
    </>
  );
}
