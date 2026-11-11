import { useEffect, useState } from 'react';
import { Avatar, Box, Button, IconButton, Menu, MenuItem, TextField, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ethers } from 'ethers';
import AmountField from './AmountField';
import ErrorSnackbar from './ErrorSnackbar';
import { AddressSafetyHint } from './AddressSafetyBlock';
import { useAddressSafety } from '../hooks/useAddressSafety';
import { CHAINS, fetchBalances, fetchTokenBalances } from '../lib/chains';
import type { ChainKey } from '../lib/chains';
import { CHAIN_ICONS } from '../lib/chainIcons';
import { getTokenIcon } from '../lib/tokenIcons';
import { WalletsHelper, CustomTokensHelper, CustomChainsHelper } from '../lib/storage';
import type { CustomChainRecord } from '../lib/storage';
import { fetchCustomChainNativeBalance, fetchCustomChainTokenBalance } from '../lib/customChains';
import { useAppStore } from '../store/appStore';
import CustomChainIcon from './CustomChainIcon';
import EthereumSilhouetteIcon from './EthereumSilhouetteIcon';
import iconAddressbook from '../assets/icon_addressbook.png';

// Same rounded "grey card" look as the chain/token pickers on the Swap screen (see
// pages/swap/SwapTop.tsx's CARD_SX) - reused here so the two chain-then-token pickers this
// screen now uses look like one consistent pattern across the app, not a one-off.
const CARD_SX = { bgcolor: 'grey.100', borderRadius: 5, px: 2, py: 1.5 } as const;

// Identifies which "chain" step 1's picker has selected: either one of CHAINS's curated
// chains, or `custom:${id}` for a network added by hand under 設定 > カスタムEVM (see
// CustomChainRecord in lib/storage.ts). Keeping this as a plain string union - rather than
// widening ChainKey itself - means every other screen that indexes CHAINS[activeChain]
// (WalletBar, Balance.tsx, Swap, ...) is unaffected; only this screen (and
// SendConfirmation, which reads the same sendCustomChainId store field) needs to know
// about the custom case.
type ChainGroupKey = ChainKey | `custom:${string}`;

// One selectable entry in the asset dropdown below: a chain's native coin, its JPYC, or
// one of its ERC-20 tokens (curated or custom-added) - now also including a custom
// network's native coin and hand-registered tokens. `key` uniquely identifies the entry
// across every chain group at once ("ethereum|jpyc", "polygon|native",
// "custom:custom-137|0xAbc...") so the same dropdown can mix chains - "ABCトークン
// (Ethereum)" next to "RRRトークン (Polygon)" - without the person needing to switch chains
// first to find an asset.
interface AssetOption {
  key: string;
  chainGroup: ChainGroupKey;
  currency: 'native' | 'jpyc' | 'token';
  symbol: string;
  balance: string;
  tokenMeta: { address: string; symbol: string; decimals: number } | null;
}

const optionKey = (chainGroup: ChainGroupKey, currency: string) => `${chainGroup}|${currency}`;
const isCustomGroup = (key: ChainGroupKey): key is `custom:${string}` => key.startsWith('custom:');
const customIdOf = (key: ChainGroupKey): string => key.slice('custom:'.length);

interface SendFormProps {
  // Home の「送る」パネル用: 送るトークンを JPYC に固定する(チェーンのみ選択可)。
  // JPYC 以外(各チェーンのネイティブ通貨・ERC-20)はトークン画面から
  // /send/amount を開いて送る。
  jpycOnly?: boolean;
  // 確認画面の「戻る」の戻り先。
  backPath?: string;
  // トークン画面から開いた送金用: チェーンとトークンは選択済みなので、プルダウンにせず
  // 固定表示にする(タップしても変更できない)。
  lockAsset?: boolean;
}

export default function SendForm({ jpycOnly = false, backPath = '/top?tab=send', lockAsset = false }: SendFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const storeFormula = useAppStore((s) => s.calculatorFormula);
  const setCalculatorFormula = useAppStore((s) => s.setCalculatorFormula);
  const setCalculatorValue = useAppStore((s) => s.setCalculatorValue);
  const storeReceiver = useAppStore((s) => s.receiverAddress);
  const setReceiverAddress = useAppStore((s) => s.setReceiverAddress);
  const pickedContactAddress = useAppStore((s) => s.pickedContactAddress);
  const setPickedContactAddress = useAppStore((s) => s.setPickedContactAddress);
  const setBackPathFromSendConfirmation = useAppStore((s) => s.setBackPathFromSendConfirmation);
  // Address and amount are typed on this screen now (no separate destination step / numpad),
  // seeded from the store so a scanned QR / address-book pick / invoice still pre-fills them.
  const [address, setAddress] = useState(storeReceiver);
  const [amount, setAmount] = useState(storeFormula === '0' ? '' : storeFormula);
  const [errorMessage, setErrorMessage] = useState('');
  const activeChain = useAppStore((s) => s.activeChain) as ChainKey;
  const sendCurrency = useAppStore((s) => s.sendCurrency);
  const sendCustomChainId = useAppStore((s) => s.sendCustomChainId);
  const setActiveChain = useAppStore((s) => s.setActiveChain);
  const setSendCurrency = useAppStore((s) => s.setSendCurrency);
  const setSendTokenMeta = useAppStore((s) => s.setSendTokenMeta);
  const setSendCustomChainId = useAppStore((s) => s.setSendCustomChainId);

  // JPYC 固定モード: 他画面で選ばれていたネイティブ/トークン/カスタムチェーンの選択が
  // 残っていても、このフォームでは必ず JPYC を送る状態に揃える。
  useEffect(() => {
    if (!jpycOnly) return;
    setSendCurrency('jpyc');
    setSendTokenMeta(null);
    setSendCustomChainId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jpycOnly]);

  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [customChains, setCustomChains] = useState<CustomChainRecord[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  // Anchor elements for the two pill dropdowns below (chain, then token) - same pattern as
  // the chain/token pickers on the Swap screen (see pages/swap/SwapTop.tsx).
  const [chainMenuAnchor, setChainMenuAnchor] = useState<null | HTMLElement>(null);
  const [tokenMenuAnchor, setTokenMenuAnchor] = useState<null | HTMLElement>(null);

  // Address picked in the address book (/addressbook?pick=1) - applied once on return.
  useEffect(() => {
    if (pickedContactAddress) {
      setAddress(pickedContactAddress);
      setPickedContactAddress('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedContactAddress]);

  // Every asset the active wallet actually holds, across every chain (curated and custom)
  // at once - not just whichever chain happens to be active - so the dropdown can offer
  // chain-mixed choices.
  useEffect(() => {
    (async () => {
      setLoadingOptions(true);
      const activeWallet = await WalletsHelper.getActive();
      if (activeWallet == null) {
        setAssetOptions([]);
        setCustomChains([]);
        setLoadingOptions(false);
        return;
      }
      try {
        const chains = Object.keys(CHAINS) as ChainKey[];
        const [perChain, customChainList] = await Promise.all([
          Promise.all(chains.map(async (chain): Promise<AssetOption[]> => {
            const customTokens = await CustomTokensHelper.list(chain);
            const [balances, tokens] = await Promise.all([
              fetchBalances(chain, activeWallet.address),
              fetchTokenBalances(chain, activeWallet.address, customTokens),
            ]);
            return [
              { key: optionKey(chain, 'jpyc'), chainGroup: chain, currency: 'jpyc', symbol: 'JPYC', balance: balances.jpyc, tokenMeta: null },
              { key: optionKey(chain, 'native'), chainGroup: chain, currency: 'native', symbol: CHAINS[chain].nativeCurrency.symbol, balance: balances.native, tokenMeta: null },
              ...tokens.map((token): AssetOption => ({
                key: optionKey(chain, token.address),
                chainGroup: chain,
                currency: 'token',
                symbol: token.symbol,
                balance: token.balance,
                tokenMeta: { address: token.address, symbol: token.symbol, decimals: token.decimals },
              })),
            ];
          })),
          CustomChainsHelper.list(),
        ]);

        // Networks added under 設定 > カスタムEVM - same shape as the curated chains above
        // (native coin + any hand-registered tokens), just with no JPYC entry, since a
        // custom chain has no configured JPYC contract.
        const perCustomChain = await Promise.all(customChainList.map(async (chain): Promise<AssetOption[]> => {
          const groupKey: ChainGroupKey = `custom:${chain.id}`;
          const customTokens = await CustomTokensHelper.list(chain.id);
          const [nativeBalance, tokens] = await Promise.all([
            fetchCustomChainNativeBalance(chain.rpcUrl, activeWallet.address).catch(() => '0'),
            Promise.all(customTokens.map((tok) =>
              fetchCustomChainTokenBalance(chain.rpcUrl, tok, activeWallet.address).catch(() => ({ ...tok, balance: '0' })),
            )),
          ]);
          return [
            { key: optionKey(groupKey, 'native'), chainGroup: groupKey, currency: 'native', symbol: chain.currencySymbol, balance: nativeBalance, tokenMeta: null },
            ...tokens.map((token): AssetOption => ({
              key: optionKey(groupKey, token.address),
              chainGroup: groupKey,
              currency: 'token',
              symbol: token.symbol,
              balance: token.balance,
              tokenMeta: { address: token.address, symbol: token.symbol, decimals: token.decimals },
            })),
          ];
        }));

        setAssetOptions([...perChain.flat(), ...perCustomChain.flat()]);
        setCustomChains(customChainList);
      } catch (e) {
        console.error('Failed to load asset options', e);
      } finally {
        setLoadingOptions(false);
      }
    })();
  }, []);

  // The currently-selected chain group is a curated ChainKey, unless sendCustomChainId
  // (set from here, or from Receive/Balance-style entry points) points at a network added
  // under 設定 > カスタムEVM - see the ChainGroupKey comment above.
  const currentChainGroup: ChainGroupKey = jpycOnly ? activeChain : (sendCustomChainId ? `custom:${sendCustomChainId}` : activeChain);

  // The currently-selected asset is derived from the store (chain group + sendCurrency),
  // rather than kept as separate local state, so a token pre-selected on the Token screen
  // (see pages/detail/Balance.tsx's onSendToken) shows up already selected here too.
  const selectedKey = optionKey(currentChainGroup, jpycOnly ? 'jpyc' : sendCurrency);
  const selectedOption = assetOptions.find((o) => o.key === selectedKey) ?? null;
  const currencyLabel = selectedOption?.symbol ?? '';
  const availableBalance = selectedOption?.balance ?? '0.0';

  // Every selectable chain group for step 1 - curated chains first, then any network added
  // under 設定 > カスタムEVM, each shown with the generic カスタムEVM badge (no curated logo
  // exists for a hand-entered chain - see Balance.tsx's identical fallback).
  // JPYC 固定モードでは JPYC が発行されている EVM チェーン(CHAINS)のみ。カスタムEVM・
  const chainGroups: { key: ChainGroupKey; name: string; icon?: string; iconDataUrl?: string }[] = [
    ...(Object.keys(CHAINS) as ChainKey[]).map((key) => ({ key: key as ChainGroupKey, name: CHAINS[key].name, icon: CHAIN_ICONS[key] })),
    ...(jpycOnly ? [] : [
      ...customChains.map((c) => ({ key: `custom:${c.id}` as ChainGroupKey, name: c.name, iconDataUrl: c.iconDataUrl })),
    ]),
  ];
  const selectedGroup = chainGroups.find((g) => g.key === currentChainGroup) ?? chainGroups[0] ?? null;
  const addressSafety = useAddressSafety(address, selectedGroup?.key ?? null);

  // Only this chain's assets - the token picker below is scoped to whichever chain group
  // is currently selected, matching the two-step "chain, then token" flow requested
  // (rather than a single dropdown mixing every chain's assets at once).
  const tokenOptionsForChain = assetOptions.filter((o) => o.chainGroup === currentChainGroup);

  // Logo for an asset pill: the chain's own logo for its native coin (or the generic
  // カスタムEVM badge for a custom chain's native coin), a curated logo for JPYC/USDT/USDC,
  // or null - callers fall back to a plain letter avatar for anything else (e.g. an
  // unrecognized custom token), same idea as SwapTop's tokenIcon helper.
  const assetIcon = (option: AssetOption | null): string | null => {
    if (!option) return null;
    if (option.currency === 'native') {
      return isCustomGroup(option.chainGroup) ? null : CHAIN_ICONS[option.chainGroup];
    }
    return getTokenIcon(option.symbol);
  };
  // カスタムEVMチェーンのネイティブ通貨は、assetIcon()がnullを返す(独自ロゴが存在しない)ため
  // 文字イニシャルの代わりにイーサリアムのシルエットを表示する対象かどうかの判定。
  const isEthFallbackAsset = (option: AssetOption | null): boolean =>
    !!option && option.currency === 'native' && isCustomGroup(option.chainGroup);

  // Applies whichever asset option was picked to the store - curated-chain assets set
  // activeChain and clear sendCustomChainId, custom-chain assets set sendCustomChainId
  // instead (leaving activeChain as whatever it last was, since it's ignored while
  // sendCustomChainId is set - see SendConfirmation.tsx).
  const applyOption = (option: AssetOption) => {
    if (isCustomGroup(option.chainGroup)) {
      setSendCustomChainId(customIdOf(option.chainGroup));
    } else {
      setActiveChain(option.chainGroup);
      setSendCustomChainId(null);
    }
    if (option.currency === 'token' && option.tokenMeta) {
      setSendCurrency(option.tokenMeta.address);
      setSendTokenMeta(option.tokenMeta);
    } else {
      setSendCurrency(option.currency);
      setSendTokenMeta(null);
    }
  };

  const onSelectAsset = (key: string) => {
    const option = assetOptions.find((o) => o.key === key);
    if (!option) return;
    applyOption(option);
  };

  // Switching chain groups keeps the same *kind* of asset selected when the new group has
  // one (e.g. staying on JPYC when moving from Ethereum to Polygon), falls back to that
  // group's JPYC, and otherwise just picks whatever that group offers first - so the token
  // picker is never left pointing at an asset that belongs to the chain you just left.
  const onSelectChainGroup = (group: ChainGroupKey) => {
    setChainMenuAnchor(null);
    if (group === currentChainGroup) return;
    if (jpycOnly) {
      if (!isCustomGroup(group)) setActiveChain(group);
      return;
    }
    const optionsForNewGroup = assetOptions.filter((o) => o.chainGroup === group);
    const sameKind = optionsForNewGroup.find(
      (o) => o.currency === selectedOption?.currency && o.symbol === selectedOption?.symbol
    );
    const next = sameKind ?? optionsForNewGroup.find((o) => o.currency === 'jpyc') ?? optionsForNewGroup[0] ?? null;
    if (next) {
      applyOption(next);
    } else if (isCustomGroup(group)) {
      setSendCustomChainId(customIdOf(group));
      setSendCurrency('native');
      setSendTokenMeta(null);
    } else {
      setActiveChain(group);
      setSendCustomChainId(null);
      setSendCurrency('jpyc');
      setSendTokenMeta(null);
    }
  };

  const amountNumber = Number(amount);
  const amountValid = amount !== '' && isFinite(amountNumber) && amountNumber > 0;
  const overBalance = amountValid && amountNumber > Number(availableBalance);
  const canSubmit = address.trim().length > 0 && amountValid && !overBalance;

  const onSubmit = async () => {
    if (!(await WalletsHelper.getActive())) {
      setErrorMessage(t('wallet.not_select_message'));
      return;
    }
    const receiver = address.trim();
    if (!ethers.isAddress(receiver)) {
      setErrorMessage(t('common.invalid_address'));
      return;
    }
    setReceiverAddress(receiver);
    setCalculatorFormula(amount);
    setCalculatorValue(amountNumber);
    setBackPathFromSendConfirmation(backPath);
    navigate('/send/confirmation');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', pb: 1 }}>
        {/* Step 0: 送信先 - destination address typed/pasted here (or picked from the address
            book); no separate destination step any more. */}
        <Box sx={{ px: 2, mt: 2 }}>
          <Typography sx={{ fontWeight: 'bold', mb: 1 }}>{t('send.destination')}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <TextField
              id="address"
              label={t('send.input_address')}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              fullWidth
              multiline
              maxRows={3}
              slotProps={{ htmlInput: { autoComplete: 'off', autoCapitalize: 'off', spellCheck: false } }}
            />
            <IconButton onClick={() => navigate('/addressbook?pick=1')} aria-label={t('common.address_book')} sx={{ ml: 1 }}>
              <Box component="img" src={iconAddressbook} sx={{ height: 32 }} />
            </IconButton>
          </Box>
          {/* アドレス詐欺対策: 貼り付けた時点で、登録済みの相手か・似たアドレスかなどを知らせる。 */}
          <AddressSafetyHint assessment={addressSafety} />
        </Box>

        {/* チェーン・(トークン)・金額は、幅があるときは横に並べ、狭いときは折り返して縦に積む。
            チェーンの右に金額が来る。 */}
        <Box sx={{ px: 2, mt: 2, display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 2, alignItems: 'flex-start' }}>
        {/* Step 1: チェーン - pick the network first. Picking a new chain re-derives the
            token selection below (see onSelectChainGroup) rather than leaving it pointing
            at an asset that no longer belongs to the active chain. */}
        <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
          <Typography sx={{ fontWeight: 'bold', mb: 1 }}>{t('send.chain_label')}</Typography>
          <Box
            onClick={lockAsset ? undefined : (e) => setChainMenuAnchor(e.currentTarget)}
            sx={{ ...CARD_SX, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: lockAsset ? 'default' : 'pointer' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {selectedGroup?.icon ? (
                <Avatar src={selectedGroup.icon} sx={{ width: 32, height: 32 }} />
              ) : (
                <CustomChainIcon iconDataUrl={selectedGroup?.iconDataUrl} size={32} />
              )}
              <Typography sx={{ fontWeight: 'bold' }}>{selectedGroup?.name}</Typography>
            </Box>
            {!lockAsset && <ExpandMoreIcon sx={{ color: 'text.secondary' }} />}
          </Box>
          <Menu anchorEl={chainMenuAnchor} open={!lockAsset && !!chainMenuAnchor} onClose={() => setChainMenuAnchor(null)}>
            {chainGroups.map((group) => (
              <MenuItem key={group.key} selected={group.key === currentChainGroup} onClick={() => onSelectChainGroup(group.key)}>
                {group.icon ? (
                  <Avatar src={group.icon} sx={{ width: 24, height: 24, mr: 1.5 }} />
                ) : (
                  <CustomChainIcon iconDataUrl={group.iconDataUrl} size={24} sx={{ mr: 1.5 }} />
                )}
                {group.name}
              </MenuItem>
            ))}
          </Menu>
        </Box>

        {/* Step 2: トークン - pick which asset on that chain to send (scoped to the chain
            chosen above). */}
        {!jpycOnly && (
        <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
          <Typography sx={{ fontWeight: 'bold', mb: 1 }}>{t('send.token_label')}</Typography>
          {/* チェーンのカードと同じ幅・同じ高さ(アイコン32px)にそろえる。 */}
          <Box
            onClick={lockAsset ? undefined : (e) => tokenOptionsForChain.length > 0 && setTokenMenuAnchor(e.currentTarget)}
            sx={{
              ...CARD_SX, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: !lockAsset && tokenOptionsForChain.length > 0 ? 'pointer' : 'default',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
              <Avatar
                src={assetIcon(selectedOption) ?? undefined}
                sx={{ width: 32, height: 32, fontSize: 14, ...(isEthFallbackAsset(selectedOption) ? { bgcolor: 'grey.200' } : {}) }}
              >
                {isEthFallbackAsset(selectedOption) ? <EthereumSilhouetteIcon size={16} /> : currencyLabel.charAt(0)}
              </Avatar>
              <Typography noWrap sx={{ fontWeight: 'bold' }}>
                {loadingOptions ? t('common.loading') : (currencyLabel || t('send.select_token'))}
              </Typography>
            </Box>
            {!lockAsset && <ExpandMoreIcon sx={{ color: 'text.secondary' }} />}
          </Box>
          <Menu anchorEl={tokenMenuAnchor} open={!lockAsset && !!tokenMenuAnchor} onClose={() => setTokenMenuAnchor(null)}>
            {tokenOptionsForChain.map((option) => (
              <MenuItem
                key={option.key}
                selected={option.key === selectedKey}
                onClick={() => { onSelectAsset(option.key); setTokenMenuAnchor(null); }}
              >
                <Avatar
                  src={assetIcon(option) ?? undefined}
                  sx={{ width: 24, height: 24, mr: 1.5, fontSize: 12, ...(isEthFallbackAsset(option) ? { bgcolor: 'grey.200' } : {}) }}
                >
                  {isEthFallbackAsset(option) ? <EthereumSilhouetteIcon size={12} /> : option.symbol.charAt(0)}
                </Avatar>
                {option.symbol}
              </MenuItem>
            ))}
            {tokenOptionsForChain.length === 0 && <MenuItem disabled>{t('send.select_token')}</MenuItem>}
          </Menu>
        </Box>
        )}

        {/* Step 3: 金額 - typed directly (no numpad), for the asset picked above. */}
        <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
          <Typography sx={{ fontWeight: 'bold', mb: 1 }}>{t('common.amount')}</Typography>
          <AmountField value={amount} onChange={setAmount} unit={currencyLabel} error={overBalance} />
          <Typography sx={{ color: '#929292', fontSize: 12, mt: 0.5 }}>
            {t('send.available_balance')}: {availableBalance} {currencyLabel}
          </Typography>
          {overBalance && (
            <Typography sx={{ color: 'error.main', fontSize: 12, mt: 0.5 }}>
              {t('chain.insufficient_balance_error')}
            </Typography>
          )}
        </Box>
        </Box>

        <Box sx={{ px: 2, py: 3 }}>
          <Button variant="contained" color="primary" fullWidth disabled={!canSubmit} onClick={onSubmit}>OK</Button>
        </Box>
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
