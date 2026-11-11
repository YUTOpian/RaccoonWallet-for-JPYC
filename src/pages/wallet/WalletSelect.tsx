import { useEffect, useState } from 'react';
import { Box, Button, Typography, ButtonBase, IconButton } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import AddIcon from '@mui/icons-material/Add';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { WalletsHelper } from '../../lib/storage';
import type { Wallet } from '../../lib/storage';
import { DEFAULT_CHAIN, fetchBalances, fetchNativeJpyRate } from '../../lib/chains';
import { useAppStore } from '../../store/appStore';
import AccountsHeader from '../../components/AccountsHeader';
import PasswordDialog from '../../components/PasswordDialog';
import WalletSettingsDialog from '../../components/WalletSettingsDialog';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { MnemonicHelper } from '../../lib/mnemonic';
import { findNextAccountIndex } from '../../lib/nextAccount';
import emptyImage from '../../assets/image_empty2_large.png';
import { TILE_GRID_SX } from '../../lib/tileGrid';

// 0x1234...abcd — short enough to fit on one line next to the wallet name.
function shortenAddress(address: string): string {
  if (address.length <= 14) {
    return address;
  }
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export default function WalletSelect() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  // 歯車で開く「ウォレットの設定」ポップアップの対象ID。URLの ?settings=<id> を真実の源にして
  // いるので、詳細・アドレス・バックアップ・削除の各画面から戻ると、ポップアップが再び開く。
  const settingsWalletId = searchParams.get('settings') ?? '';
  const closeSettings = () => setSearchParams({}, { replace: true });
  const setBackPathFromLesson = useAppStore((s) => s.setBackPathFromLesson);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Each wallet's JPY-denominated total (JPYC + native converted at the current rate, on
  // the default chain) — fetched once per wallet so it can be shown right in this list.
  const [jpyBalances, setJpyBalances] = useState<Record<string, number>>({});
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const getActiveWalletIndex = async (allWallets: Wallet[]): Promise<number> => {
    const activeWallet = await WalletsHelper.getActive();
    if (!activeWallet) {
      return -1;
    }
    return allWallets.findIndex((w) => w.id === activeWallet.id);
  };

  const load = async () => {
    const allWallets = await WalletsHelper.gets();
    setWallets(allWallets);
    setActiveIndex(await getActiveWalletIndex(allWallets));

    const jpyRate = await fetchNativeJpyRate(DEFAULT_CHAIN);
    const entries = await Promise.all(allWallets.map(async (wallet) => {
      try {
        const balances = await fetchBalances(DEFAULT_CHAIN, wallet.address);
        return [wallet.id, Number(balances.jpyc) + Number(balances.native) * jpyRate] as const;
      } catch (e) {
        console.error(`Failed to fetch balance for wallet ${wallet.id}`, e);
        return [wallet.id, 0] as const;
      }
    }));
    setJpyBalances(Object.fromEntries(entries));
  };

  useEffect(() => {
    load();
  }, []);

  const setActiveWallet = async (wallet: Wallet) => {
    await WalletsHelper.setActive(wallet.id);
    setActiveIndex(await getActiveWalletIndex(wallets));
    navigate('/top');
  };

  // 「アカウントを追加」: 登録済みのリカバリーフレーズから、次の BIP44 インデックス番号の
  // アカウントをその場で追加する(名前入力・バックアップ画面は挟まない)。リカバリー
  // フレーズを持つウォレットがまだ無い(初回 / 秘密鍵インポートのみ)ときは、従来どおり
  // 新規作成・ログインの選択画面へ進む。
  const onAddAccount = () => {
    if (!wallets.some((w) => w.hasMnemonic())) {
      navigate('/wallet/creation/type');
      return;
    }
    setShowPasswordDialog(true);
  };

  const onPinReady = async (pin: string) => {
    try {
      const all = await WalletsHelper.gets();
      let phrase: string | null = null;
      for (const w of all) {
        if (!w.hasMnemonic()) continue;
        const decrypted = await WalletsHelper.decryptMnemonic(w.id, pin);
        if (decrypted != null && MnemonicHelper.isValid(decrypted)) {
          phrase = decrypted;
          break;
        }
      }
      if (phrase == null) {
        setErrorMessage(t('account.add_failed'));
        return;
      }
      const index = findNextAccountIndex(phrase, all);
      const account = MnemonicHelper.accountFromMnemonic(phrase, index);
      const wallet = await WalletsHelper.createWithMnemonic(
        `${t('account.default_name')} ${index + 1}`,
        account.address, account.publicKey, account.privateKey, phrase, pin,
      );
      wallet.derivationIndex = index;
      await WalletsHelper.add(wallet);
      await WalletsHelper.setActive(wallet.id);
      await load();
    } catch (e) {
      console.error('Failed to add account', e);
      setErrorMessage(t('account.add_failed'));
    } finally {
      setShowPasswordDialog(false);
    }
  };

  // 「セキュリティレッスンを受ける」導線は、以前はナビゲーションメニューの Help から
  // 開いていたが、初めてウォレットに触れる人がまず目にするこの画面（For BEGINNERS）に
  // 一本化した。backPathFromLesson に現在地を記録しておくことで、レッスン画面の「←」で
  // ここに戻ってこられる。
  const goToSecurityLesson = () => {
    setBackPathFromLesson(location.pathname + location.search);
    navigate('/welcome');
  };

  return (
    <div>
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <AccountsHeader />
        {wallets.length === 0 && (
          <Box sx={{ textAlign: 'center', mt: 2 }}>
            <Box component="img" src={emptyImage} sx={{ width: '50vw', maxWidth: 150 }} />
            <Typography variant="h6" color="text.secondary">{t('wallet.no_wallet_title')}</Typography>
            <Typography color="text.secondary" sx={{ mx: 2 }}>
              {(t('wallet.no_wallet_message', { returnObjects: true }) as string[]).map((line, i) => (
                <span key={i}>{line}<br /></span>
              ))}
            </Typography>
          </Box>
        )}

        {/* タイル表示: 1アカウント=1タイル。最後のタイルが「アカウントを追加」(次の
            インデックス番号のアカウントを追加)。 */}
        <Box sx={{ display: 'grid', ...TILE_GRID_SX, gap: 1.5, p: 2 }}>
          {wallets.map((wallet, index) => {
            const active = index === activeIndex;
            return (
              <ButtonBase
                key={wallet.id}
                component="div"
                onClick={() => setActiveWallet(wallet)}
                sx={{
                  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  textAlign: 'left', gap: 0.25, p: 1.25, aspectRatio: '1 / 1', borderRadius: 2,
                  border: 2, borderColor: active ? 'primary.main' : 'divider',
                  bgcolor: active ? 'action.selected' : 'background.paper',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: active ? 'primary.main' : 'action.active' }}>
                    {active && <CheckCircleIcon fontSize="small" />}
                    {active && <Typography variant="caption" sx={{ fontWeight: 'bold' }}>{t('account.active')}</Typography>}
                  </Box>
                  <IconButton
                    size="small"
                    aria-label="settings"
                    onClick={(e) => { e.stopPropagation(); setSearchParams({ settings: wallet.id }); }}
                  >
                    <SettingsIcon fontSize="small" color="primary" />
                  </IconButton>
                </Box>
                <Typography noWrap sx={{ fontWeight: 'bold', width: '100%' }}>{wallet.name}</Typography>
                {typeof wallet.derivationIndex === 'number' && (
                  <Typography variant="caption" color="text.secondary">
                    {t('account.index_label', { index: wallet.derivationIndex })}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary" noWrap sx={{ width: '100%' }}>
                  {shortenAddress(wallet.address)}
                </Typography>
                {/* 真ん中の空白を埋める大きなウォレットアイコン。 */}
                <Box sx={{
                  flexGrow: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: active ? 'primary.main' : 'action.active',
                  '& svg': { fontSize: { xs: 56, sm: 64, md: 80 }, opacity: active ? 1 : 0.6 },
                }}>
                  <AccountBalanceWalletOutlinedIcon />
                </Box>
                <Typography sx={{ fontWeight: 'bold', fontSize: { xs: '1rem', md: '1.15rem' } }}>
                  {new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(jpyBalances[wallet.id] ?? 0)}
                </Typography>
              </ButtonBase>
            );
          })}

          <ButtonBase
            onClick={onAddAccount}
            sx={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.5,
              aspectRatio: '1 / 1', borderRadius: 2, border: 2, borderStyle: 'dashed', borderColor: 'primary.main',
              color: 'primary.main',
            }}
          >
            <AddIcon sx={{ fontSize: { xs: 56, sm: 64, md: 80 } }} />
            <Typography sx={{ fontWeight: 'bold' }}>{t('account.add')}</Typography>
          </ButtonBase>
        </Box>

        {/* 初めて触る人向けのレッスン導線: ウォレットが0件のときだけ表示する(既にある状態で
            レッスンに入るとベータ用のウォレットがもう1つ作られてしまうため)。 */}
        {wallets.length === 0 && (
          <Box sx={{ px: 2, pb: 2 }}>
            <Button variant="outlined" color="primary" fullWidth onClick={goToSecurityLesson}>
              {t('wallet.for_beginners')}
            </Button>
          </Box>
        )}
      </Box>
      <WalletSettingsDialog walletId={settingsWalletId} onClose={closeSettings} onRenamed={load} />
      <PasswordDialog
        open={showPasswordDialog}
        mode="check"
        onClose={() => {}}
        onCancel={() => setShowPasswordDialog(false)}
        onPass={onPinReady}
      />
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </div>
  );
}
