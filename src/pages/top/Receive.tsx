import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, TextField, Avatar, Menu, MenuItem } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { QRCodeSVG } from 'qrcode.react';
import { Decimal } from 'decimal.js';
import { useTranslation } from 'react-i18next';
import { WalletsHelper, CustomChainsHelper } from '../../lib/storage';
import type { CustomChainRecord } from '../../lib/storage';
import { CHAINS, getJpycDecimals } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { CHAIN_ICONS } from '../../lib/chainIcons';
import { buildJpycPaymentUri, buildChainLockedAddressUri, buildChainLockedAddressUriForChainId } from '../../lib/jpycPayment';
import { useAppStore } from '../../store/appStore';
import CustomChainIcon from '../../components/CustomChainIcon';

const CHAIN_KEYS = Object.keys(CHAINS) as ChainKey[];

// Neutral blue-grey used for a network added under 設定 > カスタムEVM, since it has no
// brand color of its own.
const CUSTOM_CHAIN_COLOR = '#607D8B';

// Every network this screen can generate a receive QR for: one entry per EVM chain
// (Ethereum/Polygon/Avalanche/Kaia - JPYC moves on all four, but as different tokens on
// different chains, so a QR for one must not be scannable as a request on another) plus
// any network the person added
// by hand under 設定 > カスタムEVM (see CustomChainRecord in lib/storage.ts) - `custom:${id}`
// so several custom chains can each be picked individually, same as any of the officially-
// supported ones. Picking a chain here - not just "EVM" generically - is what lets the QR
// itself be chain-locked (see qrValue below / buildChainLockedAddressUri), so a sender's
// wallet can reject or auto-correct a mismatched chain instead of silently sending the
// wrong asset on the wrong network.
type ReceiveMode = ChainKey | `custom:${string}`;

// Type guard (rather than a plain .startsWith() check) so TypeScript can actually narrow
// `mode` away from the `custom:${string}` branch below - a template literal type isn't
// narrowed by string methods like .startsWith() on their own, only by an explicit
// predicate like this one.
function isCustomReceiveMode(mode: ReceiveMode): mode is `custom:${string}` {
  return mode.startsWith('custom:');
}

// Ported from src/components/pages/top/Receive.vue, then extended with an optional amount.
// Entering an amount switches an EVM QR to an EIP-681 ERC-20 transfer request for that
// many JPYC (`ethereum:<JPYC contract>@<chainId>/transfer?address=<addr>&uint256=<amountWei>`,
// see lib/jpycPayment.ts and https://note.com/choconaak/n/n4d44183f1c8b for a worked
// example); leaving it blank still encodes the chosen chain's id (via
// buildChainLockedAddressUri) so the QR is never chain-ambiguous even without an amount.
export default function Receive() {
  const { t } = useTranslation();
  const activeChain = useAppStore((s) => s.activeChain);
  const [address, setAddress] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [decimals, setDecimals] = useState<number | null>(null);

  const [mode, setMode] = useState<ReceiveMode>(activeChain);
  // Networks added under 設定 > カスタムEVM - offered here too so a custom network's
  // receive QR isn't only reachable from that settings screen. Same underlying address as
  // the curated EVM chains above (it's still an EVM account), just chain-locked to that
  // network's chainId instead of one of CHAINS's.
  const [customChains, setCustomChains] = useState<CustomChainRecord[]>([]);
  // Anchor for the chain/asset picker's dropdown menu - same tappable-card-plus-Menu pattern
  // used on Swap/QR Lab's chain selectors.
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  useEffect(() => {
    (async () => {
      const activeWallet = await WalletsHelper.getActive();
      setAddress(activeWallet?.address ?? '');
      setCustomChains(await CustomChainsHelper.list());
    })();
  }, []);

  const amount = useMemo(() => {
    const trimmed = amountInput.trim();
    if (trimmed.length === 0) return null;
    try {
      const value = new Decimal(trimmed);
      return value.greaterThan(0) ? value : null;
    } catch {
      return null;
    }
  }, [amountInput]);

  // The chain/token picker below can land on: a curated EVM chain or a
  // custom chain (`custom:${id}`) - only the first of these has the JPYC-amount-request
  // behavior below (a custom chain has no configured JPYC contract to build that URI
  // from), so it gets its own flag distinct from "is this an EVM-style address at all".
  const customChainId = isCustomReceiveMode(mode) ? mode.slice('custom:'.length) : null;
  const selectedCustomChain = customChainId !== null
    ? customChains.find((c) => c.id === customChainId) ?? null
    : null;
  const showCustomMode = customChainId !== null && selectedCustomChain !== null;

  const isEvmMode = !isCustomReceiveMode(mode);
  const chain = isEvmMode ? mode : null;

  // Only look up JPYC's on-chain decimals once an amount is actually entered - a plain
  // chain-locked QR (the common case) shouldn't fire an RPC call for nothing.
  useEffect(() => {
    if (amount === null || chain === null) return;
    let cancelled = false;
    (async () => {
      const value = await getJpycDecimals(chain);
      if (!cancelled) setDecimals(value);
    })();
    return () => {
      cancelled = true;
    };
  }, [amount, chain]);

  const qrValue = chain === null || address.length === 0
    ? address
    : amount !== null && decimals !== null
      ? buildJpycPaymentUri(chain, address, amount, decimals)
      : buildChainLockedAddressUri(chain, address);

  // Options for the chain/asset picker pill below - one per EVM chain, plus any network added under
  // 設定 > カスタムEVM.
  const options: { value: ReceiveMode; icon?: string; iconDataUrl?: string; label: string; color?: string }[] = [
    ...CHAIN_KEYS.map((key) => ({ value: key as ReceiveMode, icon: CHAIN_ICONS[key], label: CHAINS[key].name })),
    ...customChains.map((c) => ({
      value: `custom:${c.id}` as ReceiveMode,
      iconDataUrl: c.iconDataUrl,
      label: c.name,
      color: CUSTOM_CHAIN_COLOR,
    })),
  ];
  const selected = options.find((o) => o.value === mode) ?? options[0];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {/* ラベルとプルダウンを1行に並べ、プルダウンも細くして、その分QRコードを上に上げる。 */}
      <Box sx={{ px: 4, mt: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography noWrap sx={{ fontWeight: 'bold', flexShrink: 0 }}>{t('receive.chain_label')}</Typography>
        <Box
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          sx={{
            bgcolor: 'grey.100', borderRadius: 3, px: 1.5, py: 0.75, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flex: '0 1 260px', minWidth: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            {selected.icon ? (
              <Avatar src={selected.icon} sx={{ width: 24, height: 24 }} />
            ) : (
              <CustomChainIcon iconDataUrl={selected.iconDataUrl} size={24} />
            )}
            <Typography noWrap sx={{ fontWeight: 'bold', color: selected.color }}>{selected.label}</Typography>
          </Box>
          <ExpandMoreIcon sx={{ color: 'text.secondary' }} />
        </Box>
        <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
          {options.map((opt) => (
            <MenuItem
              key={opt.value}
              selected={opt.value === mode}
              onClick={() => { setMode(opt.value); setMenuAnchor(null); }}
            >
              {opt.icon ? (
                <Avatar src={opt.icon} sx={{ width: 24, height: 24, mr: 1.5 }} />
              ) : (
                <CustomChainIcon iconDataUrl={opt.iconDataUrl} size={24} sx={{ mr: 1.5 }} />
              )}
              <Typography sx={{ color: opt.color }}>{opt.label}</Typography>
            </MenuItem>
          ))}
        </Menu>
      </Box>

      {showCustomMode ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 1.5 }}>
          {address.length > 0 && (
            <QRCodeSVG
              value={buildChainLockedAddressUriForChainId(selectedCustomChain!.chainId, address)}
              size={200}
            />
          )}
          <Typography sx={{ mt: 4, color: CUSTOM_CHAIN_COLOR }}>{t('receive.your_address')}</Typography>
          <Typography align="center" sx={{ wordBreak: 'break-all', mx: 4 }}>{address}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 3, mb: 4, mx: 4, textAlign: 'center' }}>
            {t('receive.custom_chain_caution', { name: selectedCustomChain!.name })}
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 1.5 }}>
            {address.length > 0 && <QRCodeSVG value={qrValue} size={200} />}
            <Typography sx={{ mt: 4, color: 'primary.main' }}>{t('receive.your_address')}</Typography>
            <Typography align="center" sx={{ wordBreak: 'break-all', mx: 4 }}>{address}</Typography>
          </Box>

          <Box sx={{ px: 4, mt: 4, mb: 4 }}>
            <Typography sx={{ color: 'primary.main', mb: 0.5 }}>{t('receive.amount_label')}</Typography>
            <TextField
              type="number"
              fullWidth
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder={t('receive.amount_placeholder')}
              slotProps={{
                htmlInput: { min: 0, step: 'any' },
                input: { endAdornment: <Typography color="text.secondary" sx={{ ml: 1 }}>{t('marketplace.price_unit')}</Typography> },
              }}
            />

            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('receive.amount_hint')}
            </Typography>
          </Box>
        </>
      )}
    </Box>
  );
}
