import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, ButtonBase, List, ListItemButton, ListItemText, Switch, Dialog, DialogTitle, Typography } from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import CurrencyYenIcon from '@mui/icons-material/CurrencyYen';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import BackupOutlinedIcon from '@mui/icons-material/BackupOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PasswordDialog from '../../components/PasswordDialog';
import MessageDialog from '../../components/MessageDialog';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import GaslessSettingsDialog from '../../components/GaslessSettingsDialog';
import { useAppStore } from '../../store/appStore';
import type { AppLanguage, DisplayCurrency } from '../../store/appStore';
import { PinCodeHelper, WalletsHelper } from '../../lib/storage';
import { disconnectExternalWallet } from '../../lib/externalWallet';
import type { ExternalWalletKind } from '../../lib/externalWallet';
import { TILE_GRID_SX } from '../../lib/tileGrid';

export default function SettingsTop() {
  const { t } = useTranslation();
  // Each language's own name, shown in its own script regardless of the app's current
  // display language (the standard "endonym" pattern - e.g. always "日本語", never a
  // translated word like "Japanese"/"日本語" depending on which language happens to be
  // active right now).
  const LANGUAGE_OPTIONS: { code: AppLanguage; label: string }[] = [
    { code: 'ja', label: t('settings.language_name_ja') },
    { code: 'en', label: t('settings.language_name_en') },
  ];
  // Same endonym idea as LANGUAGE_OPTIONS above, but "JPY"/"USD" read the same regardless
  // of display language, so these two are just fixed labels rather than translated ones.
  const CURRENCY_OPTIONS: { code: DisplayCurrency; label: string }[] = [
    { code: 'JPY', label: t('settings.display_currency_name_jpy') },
    { code: 'USD', label: t('settings.display_currency_name_usd') },
  ];
  const navigate = useNavigate();
  const networkMode = useAppStore((s) => s.networkMode);
  const setNetworkMode = useAppStore((s) => s.setNetworkMode);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const setDisplayCurrency = useAppStore((s) => s.setDisplayCurrency);
  const [showLanguageDialog, setShowLanguageDialog] = useState(false);
  const [showCurrencyDialog, setShowCurrencyDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showDebugModeConfirm, setShowDebugModeConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showGaslessDialog, setShowGaslessDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const showNotImplementedYet = () => setErrorMessage(t('common.coming_soon'));

  // Shows the recovery phrase for whichever wallet is currently active - same
  // caution-screen-then-reveal flow as a single wallet's own "Backup" menu item
  // (see WalletSettingsDialog.tsx), just reached from the app-wide settings screen instead. No
  // id is passed - WalletBackup already falls back to the active wallet when id is blank -
  // only `back` is set, so both screens' "←"/"完了" return here instead of a (nonexistent)
  // per-wallet settings URL.
  const goToBackup = () => {
    navigate('/wallet/backup_caution?back=/settings/top&mode=mnemonic');
  };

  // Turning testnet mode ON replaces mainnet with Sepolia / Amoy / Kairos / Fuji for the
  // EVM chains (see lib/chains.ts) everywhere in the app - mainnet becomes
  // unreachable until it's turned back off. That's disruptive enough to confirm first.
  // Turning it back OFF just restores normal use, so that direction doesn't need a
  // confirmation step.
  const onDebugModeSwitchChange = () => {
    if (networkMode === 'debug') {
      setNetworkMode('mainnet');
    } else {
      setShowDebugModeConfirm(true);
    }
  };

  const confirmEnableDebugMode = () => {
    setNetworkMode('debug');
    setShowDebugModeConfirm(false);
  };

  // Erases every recovery phrase and private key stored on this device, plus the PIN
  // code itself - keeping the PIN around after logout would let it unlock nothing yet
  // still leak whether the previous user had one set, and would otherwise get reused
  // as the PIN for whatever wallet is set up next. Irreversible without an external
  // backup, so this always goes through a confirmation dialog. No PIN check is required
  // here - someone who forgot their PIN still needs a way to log out, and logging out
  // only erases local data (it doesn't move any assets), so it doesn't need the same
  // gate as deleting a single wallet. Lands on /welcome (not /wallet/select) since
  // there's no wallet left to select from at all after this - matches router.tsx's own
  // fallback for the no-wallets case.
  const performLogout = async () => {
    // 1) 外部ウォレット(MetaMask / Bitget)に繋いでいた場合は、削除の前に拡張側の接続許可を
    //    取り消す。ウォレット情報を消した後では、どの拡張を使っていたか分からなくなるため。
    //    取り消しに失敗(拡張が未対応・応答なし)してもログアウトは続行する。
    const wallets = await WalletsHelper.gets();
    const kinds = Array.from(
      new Set(wallets.map((w) => w.externalProvider).filter((k): k is ExternalWalletKind => k != null)),
    );
    const results = await Promise.all(kinds.map((k) => disconnectExternalWallet(k)));

    // 2) 端末内のウォレット・PINを削除。
    await WalletsHelper.deleteAll();
    await PinCodeHelper.remove();

    // 3) 画面側に残っている送金・スワップの途中状態(宛先・金額・直前のハッシュ等)も消す。
    useAppStore.setState({
      calculatorFormula: '0',
      calculatorValue: 0,
      receiverAddress: '',
      pickedContactAddress: '',
      transaction: null,
      transactionListCache: null,
      balanceCache: null,
      sendCurrency: 'jpyc',
      sendTokenMeta: null,
      sendCustomChainId: null,
      lastTxHash: '',
    });

    // 取り消せなかった拡張がある場合だけ、手動での解除を案内してから移動する。
    if (results.some((ok) => !ok)) {
      setErrorMessage(t('settings.logout_external_manual'));
      setTimeout(() => navigate('/welcome'), 2500);
      return;
    }
    navigate('/welcome');
  };

  const onConfirmLogout = async () => {
    setShowLogoutConfirm(false);
    await performLogout();
  };

  const currentLanguageLabel = LANGUAGE_OPTIONS.find((o) => o.code === language)?.label ?? '';
  const currentCurrencyLabel = CURRENCY_OPTIONS.find((o) => o.code === displayCurrency)?.label ?? '';

  const onSelectLanguage = (code: AppLanguage) => {
    setLanguage(code);
    setShowLanguageDialog(false);
  };

  const onSelectCurrency = (code: DisplayCurrency) => {
    setDisplayCurrency(code);
    setShowCurrencyDialog(false);
  };

  // タイル表示: 1設定項目=1タイル(ホーム/アカウント画面と同じ auto-fill グリッド)。
  // ヒーロー画像は使わない。テストネットモードだけはタイル内のスイッチで切り替える。
  interface SettingTile {
    key: string;
    icon: ReactNode;
    text: string;
    secondary?: string;
    action: () => void;
    toggle?: boolean;
    danger?: boolean;
  }
  const tiles: SettingTile[] = [
    { key: 'language', icon: <LanguageIcon />, text: t('settings.language_select'), secondary: currentLanguageLabel, action: () => setShowLanguageDialog(true) },
    { key: 'currency', icon: <CurrencyYenIcon />, text: t('settings.display_currency_select'), secondary: currentCurrencyLabel, action: () => setShowCurrencyDialog(true) },
    { key: 'gasless', icon: <BoltOutlinedIcon />, text: t('gas.settings_title'), action: () => setShowGaslessDialog(true) },
    { key: 'notification', icon: <NotificationsNoneIcon />, text: t('settings.notification_settings'), action: showNotImplementedYet },
    { key: 'password', icon: <LockOutlinedIcon />, text: t('settings.change_password'), action: () => setShowPasswordDialog(true) },
    { key: 'debug', icon: <BugReportOutlinedIcon />, text: t('settings.debug_mode'), action: onDebugModeSwitchChange, toggle: true },
    { key: 'backup', icon: <BackupOutlinedIcon />, text: t('common.backup'), action: goToBackup },
    { key: 'logout', icon: <LogoutIcon />, text: t('settings.logout'), action: () => setShowLogoutConfirm(true), danger: true },
  ];

  return (
    <Box>

      <Box sx={{ display: 'grid', ...TILE_GRID_SX, gap: 1.5, p: 2 }}>
        {tiles.map((tile) => {
          const color = tile.danger ? 'error.main' : 'primary.main';
          return (
            <ButtonBase
              key={tile.key}
              // スイッチ(input)を内包するタイルがあるので、<button>の入れ子を避けて div で描画する。
              component="div"
              onClick={tile.action}
              sx={{
                aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                justifyContent: 'space-between', textAlign: 'left', p: 1.5, borderRadius: 2,
                border: 2, borderColor: tile.danger ? 'error.main' : 'divider', bgcolor: 'background.paper',
              }}
            >
              {/* 上段: スイッチ(デバッグモードのタイルのみ)。右上に寄せる。高さは常に確保して、
                  どのタイルでも中央のアイコン位置がそろうようにする。 */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%', minHeight: 24 }}>
                {tile.toggle && (
                  // タイル全体がボタンなので、スイッチ自体のクリックは親に伝えず onChange だけで切り替える。
                  <Switch
                    size="small"
                    checked={networkMode === 'debug'}
                    onClick={(e) => e.stopPropagation()}
                    onChange={onDebugModeSwitchChange}
                    slotProps={{ input: { 'aria-label': t('settings.debug_mode') } }}
                  />
                )}
              </Box>
              {/* 中段: タイルの真ん中に大きなアイコン。 */}
              <Box sx={{
                flexGrow: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color,
                '& svg': { fontSize: { xs: 48, sm: 56, md: 64 } },
              }}>
                {tile.icon}
              </Box>
              <Box sx={{ width: '100%' }}>
                <Typography sx={{ fontWeight: 'bold', color: tile.danger ? 'error.main' : 'text.primary', wordBreak: 'break-word' }}>
                  {tile.text}
                </Typography>
                {tile.secondary && (
                  <Typography variant="caption" color="text.secondary">{tile.secondary}</Typography>
                )}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>

      <Dialog open={showLanguageDialog} onClose={() => setShowLanguageDialog(false)}>
        <DialogTitle>{t('settings.language_select')}</DialogTitle>
        <List sx={{ minWidth: 240, pt: 0 }}>
          {LANGUAGE_OPTIONS.map((option) => (
            <ListItemButton key={option.code} selected={option.code === language} onClick={() => onSelectLanguage(option.code)}>
              <ListItemText primary={option.label} />
            </ListItemButton>
          ))}
        </List>
      </Dialog>
      <Dialog open={showCurrencyDialog} onClose={() => setShowCurrencyDialog(false)}>
        <DialogTitle>{t('settings.display_currency_select')}</DialogTitle>
        <List sx={{ minWidth: 240, pt: 0 }}>
          {CURRENCY_OPTIONS.map((option) => (
            <ListItemButton key={option.code} selected={option.code === displayCurrency} onClick={() => onSelectCurrency(option.code)}>
              <ListItemText primary={option.label} />
            </ListItemButton>
          ))}
        </List>
      </Dialog>
      <GaslessSettingsDialog open={showGaslessDialog} onClose={() => setShowGaslessDialog(false)} />
      <PasswordDialog open={showPasswordDialog} mode="change" onClose={() => setShowPasswordDialog(false)} onPass={() => setShowPasswordDialog(false)} />
      <MessageDialog
        open={showDebugModeConfirm}
        title={t('settings.debug_mode')}
        texts={[t('settings.debug_mode_confirm_1'), t('settings.debug_mode_confirm_2')]}
        selectable
        onClose={confirmEnableDebugMode}
        onCancel={() => setShowDebugModeConfirm(false)}
      />
      <MessageDialog
        open={showLogoutConfirm}
        title={t('settings.logout_confirm_title')}
        texts={t('settings.logout_confirm_message', { returnObjects: true }) as string[]}
        selectable
        onClose={onConfirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
