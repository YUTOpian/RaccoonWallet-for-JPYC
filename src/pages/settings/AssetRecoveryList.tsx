import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Box, Card, Typography, Button, IconButton, CircularProgress, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Alert, Avatar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import EthereumSilhouetteIcon from '../../components/EthereumSilhouetteIcon';
import CustomChainIcon from '../../components/CustomChainIcon';
import { WalletsHelper, CustomChainsHelper, CustomTokensHelper } from '../../lib/storage';
import type { CustomChainRecord, CustomTokenRecord } from '../../lib/storage';
import type { TokenBalance } from '../../lib/chains';
import {
  fetchCustomChainNativeBalance, fetchCustomChainTokenBalance, fetchCustomChainTokenMetadata,
} from '../../lib/customChains';
import { readFileAsDataUrl } from '../../lib/fileToDataUrl';
import { useAppStore } from '../../store/appStore';
import { TILE_GRID_SX } from '../../lib/tileGrid';

type ChainState = { nativeBalance: string; tokens: TokenBalance[] };

// One row of the asset list below (native currency or a registered token) - same shape/
// look as the Token screen's flat asset list (see pages/detail/Balance.tsx's AssetRowItem):
// a 40px icon, bold symbol, small grey balance underneath, tap-to-send. A custom chain's
// native coin has no curated logo (see Balance.tsx's identical fallback), and a hand-
// registered token generally has no icon either, so both fall back to a plain letter
// avatar rather than a chain-icon guess that could be mistaken for the asset's own logo.
function AssetRow({ icon, symbol, balance, first, onSend, onRemove, iconFallback }: {
  icon?: string; symbol: string; balance: string; first: boolean;
  onSend: () => void; onRemove?: () => void; iconFallback?: ReactNode;
}) {
  return (
    <Box
      onClick={onSend}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, cursor: 'pointer',
        borderTop: first ? undefined : '0.5px solid', borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Avatar src={icon} sx={{ width: 40, height: 40, bgcolor: '#fff', color: 'text.primary', flexShrink: 0 }}>
        {iconFallback ?? symbol.slice(0, 1)}
      </Avatar>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography noWrap sx={{ fontWeight: 'bold' }}>{symbol}</Typography>
        <Typography sx={{ color: '#929292', fontSize: 12 }}>{balance} {symbol}</Typography>
      </Box>
      {onRemove && (
        <IconButton
          size="small"
          aria-label="remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <CloseIcon fontSize="small" sx={{ color: '#929292' }} />
        </IconButton>
      )}
    </Box>
  );
}

// 設定 > 全般 > デバッグモード の下にある「通貨の取り出し」、およびナビゲーションメニュー
// から入る画面。対応チェーン(Ethereum/Polygon/Kaia/Avalanche)以外に誤って送ってしまった資産
// を確認するための救済機能だが、送金自体はトークン画面(Balance.tsx)の送金ボタンと全く同じ
// フロー(アドレス入力 → 電卓での数量入力 → 確認 → PIN)に乗せている - 送り先チェーンが
// カスタムEVMというだけで、体験が浮かないようにするため。sendCustomChainId 等をストアに積んで
// /top?tab=send に遷移する組み立ては Balance.tsx の onSendCustomChainNative/onSendCustomChainToken
// と同一。一覧表示自体も、複数チェーンを縦に積んだカードの塊(見づらい)ではなく、チェーンを
// 選ぶピル + そのチェーンの資産だけを並べた1枚のカードという、Send/Swap画面と同じ「チェーン
// を選んでから中身を見る」構成にしている。
export default function AssetRecoveryList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSendCurrency = useAppStore((s) => s.setSendCurrency);
  const setSendTokenMeta = useAppStore((s) => s.setSendTokenMeta);
  const setSendCustomChainId = useAppStore((s) => s.setSendCustomChainId);
  const clearReceiverAddress = useAppStore((s) => s.clearReceiverAddress);
  const [chains, setChains] = useState<CustomChainRecord[]>([]);
  const [states, setStates] = useState<Record<string, ChainState>>({});
  const [loading, setLoading] = useState(true);
  const [address, setAddress] = useState<string | null>(null);

  // Which registered network's assets are currently shown - defaults to the first one,
  // and re-anchors to the first remaining chain whenever the selected one is removed (or
  // this is the first load).
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const activeWallet = await WalletsHelper.getActive();
    setAddress(activeWallet?.address ?? null);
    const list = await CustomChainsHelper.list();
    setChains(list);
    if (activeWallet) {
      const entries = await Promise.all(list.map(async (chain) => {
        const customTokens = await CustomTokensHelper.list(chain.id);
        const [nativeBalance, tokens] = await Promise.all([
          fetchCustomChainNativeBalance(chain.rpcUrl, activeWallet.address).catch(() => '0'),
          Promise.all(customTokens.map((t) =>
            fetchCustomChainTokenBalance(chain.rpcUrl, t, activeWallet.address).catch(() => ({ ...t, balance: '0' })),
          )),
        ]);
        return [chain.id, { nativeBalance, tokens }] as const;
      }));
      setStates(Object.fromEntries(entries));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (chains.length === 0) {
      setSelectedChainId(null);
    } else if (!chains.some((c) => c.id === selectedChainId)) {
      setSelectedChainId(chains[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chains]);

  const selectedChain = chains.find((c) => c.id === selectedChainId) ?? null;
  const selectedState = selectedChainId ? states[selectedChainId] : undefined;

  // --- 削除確認 -------------------------------------------------------------------
  const [deleteTarget, setDeleteTarget] = useState<CustomChainRecord | null>(null);
  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    await CustomChainsHelper.remove(deleteTarget.id);
    setDeleteTarget(null);
    await load();
  };

  // --- トークンを追加ダイアログ ------------------------------------------------------
  const [tokenDialogChain, setTokenDialogChain] = useState<CustomChainRecord | null>(null);
  const [tokenAddress, setTokenAddress] = useState('');
  const [tokenIconDataUrl, setTokenIconDataUrl] = useState('');
  const [tokenSubmitting, setTokenSubmitting] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const tokenIconInputRef = useRef<HTMLInputElement>(null);

  const openTokenDialog = (chain: CustomChainRecord) => {
    setTokenDialogChain(chain);
    setTokenAddress('');
    setTokenIconDataUrl('');
    setTokenError(null);
  };

  const onTokenIconPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setTokenIconDataUrl(await readFileAsDataUrl(file));
  };

  const onSubmitToken = async () => {
    if (!tokenDialogChain || !address) return;
    const value = tokenAddress.trim();
    if (value.length === 0) {
      setTokenError(t('asset_recovery.error_contract_address_required'));
      return;
    }
    setTokenSubmitting(true);
    setTokenError(null);
    try {
      const meta = await fetchCustomChainTokenMetadata(tokenDialogChain.rpcUrl, value);
      const record: CustomTokenRecord = { chain: tokenDialogChain.id, ...meta, iconDataUrl: tokenIconDataUrl || undefined };
      await CustomTokensHelper.add(record);
      setTokenDialogChain(null);
      await load();
    } catch {
      setTokenError(t('asset_recovery.error_token_fetch_failed'));
    } finally {
      setTokenSubmitting(false);
    }
  };

  const onRemoveToken = async (chain: CustomChainRecord, token: TokenBalance) => {
    await CustomTokensHelper.remove(chain.id, token.address);
    await load();
  };

  // --- 送金 --------------------------------------------------------------------------
  //
  // トークン画面(Balance.tsx)のカスタムEVM資産と同じく、宛先入力からのフルフロー
  // (SEND タブ → SendAmount → SendConfirmation → SendComplete)に乗せる。専用の簡易送金
  // 画面(旧 AssetRecoverySend.tsx)は使わない。
  const onSendNative = (chain: CustomChainRecord) => {
    setSendCustomChainId(chain.id);
    setSendCurrency('native');
    setSendTokenMeta(null);
    clearReceiverAddress();
    navigate('/send/amount');
  };

  const onSendToken = (chain: CustomChainRecord, token: TokenBalance) => {
    setSendCustomChainId(chain.id);
    setSendCurrency(token.address);
    setSendTokenMeta({ address: token.address, symbol: token.symbol, decimals: token.decimals });
    clearReceiverAddress();
    navigate('/send/amount');
  };

  return (
    <Box>
      <Box sx={{ p: 2 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* ネットワークのタイル - タップで選択し、選んだネットワークの資産だけを下に
                表示する。最後のタイルは「ネットワークを追加」。 */}
            <Box sx={{ display: 'grid', ...TILE_GRID_SX, gap: 1.5 }}>
              {chains.map((chain) => {
                const isSelected = chain.id === selectedChainId;
                return (
                  <Card
                    key={chain.id}
                    onClick={() => setSelectedChainId(chain.id)}
                    sx={{
                      borderRadius: 3, p: 2, cursor: 'pointer', textAlign: 'center',
                      border: '2px solid', borderColor: isSelected ? 'primary.main' : 'transparent',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                      <CustomChainIcon iconDataUrl={chain.iconDataUrl} size={48} />
                    </Box>
                    <Typography noWrap sx={{ fontWeight: 'bold', mt: 1 }}>{chain.name}</Typography>
                    <Typography sx={{ color: '#929292', fontSize: 11 }}>
                      {t('asset_recovery.chain_id_suffix', { chainId: chain.chainId })}
                    </Typography>
                    <Typography noWrap sx={{ fontSize: 12, mt: 0.5 }}>
                      {states[chain.id]?.nativeBalance ?? '0.0'} {chain.currencySymbol}
                    </Typography>
                  </Card>
                );
              })}
              <Card
                onClick={() => navigate('/settings/asset_recovery/add')}
                aria-label={t('asset_recovery.add_network_aria')}
                sx={{
                  borderRadius: 3, p: 2, cursor: 'pointer', textAlign: 'center',
                  border: '2px dashed', borderColor: 'divider', boxShadow: 'none',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <AddIcon sx={{ fontSize: 40, color: 'primary.main' }} />
                <Typography sx={{ color: 'primary.main', fontSize: 12, mt: 0.5 }}>
                  {t('asset_recovery.add_network_aria')}
                </Typography>
              </Card>
            </Box>

            {chains.length === 0 && (
              <Typography align="center" color="text.secondary" sx={{ mt: 4 }}>
                {t('asset_recovery.empty_state')}
              </Typography>
            )}

            {selectedChain !== null && (
              <>
            {/* 資産一覧 - トークン画面の資産リストと同じ見た目(丸角カード、アイコン、
                太字シンボル、下に薄いグレーの残高)で、選んだチェーンの分だけを並べる。 */}
            <Card sx={{ mt: 3, borderRadius: 3, overflow: 'hidden' }}>
              <AssetRow
                icon={selectedChain.iconDataUrl}
                iconFallback={<EthereumSilhouetteIcon size={20} />}
                symbol={selectedChain.currencySymbol}
                balance={selectedState?.nativeBalance ?? '0.0'}
                first
                onSend={() => onSendNative(selectedChain)}
              />
              {selectedState?.tokens.map((token) => (
                <AssetRow
                  key={token.address}
                  icon={token.iconDataUrl ?? token.iconUrl}
                  symbol={token.symbol}
                  balance={token.balance}
                  first={false}
                  onSend={() => onSendToken(selectedChain, token)}
                  onRemove={() => onRemoveToken(selectedChain, token)}
                />
              ))}
            </Card>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1.5 }}>
              <Button
                size="small"
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => openTokenDialog(selectedChain)}
                sx={{ color: '#929292' }}
              >
                {t('asset_recovery.add_token_button')}
              </Button>
              <Button
                size="small"
                startIcon={<CloseIcon fontSize="small" />}
                onClick={() => setDeleteTarget(selectedChain)}
                sx={{ color: '#929292' }}
              >
                {t('asset_recovery.remove_network')}
              </Button>
            </Box>

            {selectedChain.blockExplorerUrl && (
              <Box sx={{ mt: 1 }}>
                <Typography
                  component="a"
                  href={selectedChain.blockExplorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  sx={{ fontSize: 12, color: 'primary.main' }}
                >
                  {t('common.view_on_explorer')}
                </Typography>
              </Box>
            )}
              </>
            )}
          </>
        )}
      </Box>

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>{t('asset_recovery.delete_confirm_title', { name: deleteTarget?.name })}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
          <Button onClick={onConfirmDelete} color="error">{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={tokenDialogChain !== null} onClose={() => !tokenSubmitting && setTokenDialogChain(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('asset_recovery.add_token_dialog_title')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'text.secondary', fontSize: 'small', mb: 2 }}>
            {t('asset_recovery.token_helper_text', { name: tokenDialogChain?.name })}
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <Box
              onClick={() => tokenIconInputRef.current?.click()}
              sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}
            >
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                <Avatar src={tokenIconDataUrl || undefined} sx={{ width: 56, height: 56, bgcolor: 'grey.200' }}>
                  {!tokenIconDataUrl && <EthereumSilhouetteIcon size={28} />}
                </Avatar>
                {tokenIconDataUrl && (
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); setTokenIconDataUrl(''); }}
                    aria-label={t('asset_recovery.form.remove_icon_aria')}
                    sx={{ position: 'absolute', top: -4, right: -4, width: 20, height: 20, bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper' } }}
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </Box>
              <Typography variant="caption" color="primary" sx={{ display: 'block', textAlign: 'center', mt: 0.5 }}>
                {t('asset_recovery.form.network_icon_label')}
              </Typography>
              <input ref={tokenIconInputRef} type="file" accept="image/*" hidden disabled={tokenSubmitting} onChange={onTokenIconPicked} />
            </Box>
          </Box>
          <TextField
            label={t('asset_recovery.contract_address_label')}
            placeholder="0x..."
            fullWidth
            margin="dense"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            disabled={tokenSubmitting}
            autoFocus
          />
          {tokenError && <Alert severity="error" sx={{ mt: 2 }}>{tokenError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTokenDialogChain(null)} disabled={tokenSubmitting}>{t('common.cancel')}</Button>
          <Button onClick={onSubmitToken} variant="contained" disabled={tokenSubmitting}>
            {tokenSubmitting ? <CircularProgress size={20} /> : t('common.add')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

