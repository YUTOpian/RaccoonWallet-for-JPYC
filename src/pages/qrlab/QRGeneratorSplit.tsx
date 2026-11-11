import { useEffect, useRef, useState } from 'react';
import {
  Avatar, Box, Card, FormControlLabel, IconButton, Menu, MenuItem, Snackbar, Switch, TextField, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';
import DownloadIcon from '@mui/icons-material/Download';
import { QRCodeCanvas } from 'qrcode.react';
import { Decimal } from 'decimal.js';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import AmountField from '../../components/AmountField';
import { WalletsHelper } from '../../lib/storage';
import { CHAINS, getJpycDecimals, getUsdcTokenInfo } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { CHAIN_ICONS } from '../../lib/chainIcons';
import { buildJpycPaymentUri } from '../../lib/jpycPayment';
import { downloadPaymentReceiptImage } from '../../lib/paymentReceiptImage';
import { MAX_SPLIT_PEOPLE, splitBill } from '../../lib/splitBill';
import { useAppStore } from '../../store/appStore';

const CHAIN_KEYS = Object.keys(CHAINS) as ChainKey[];

/**
 * QR Lab の「割り勘・立替精算」: 立て替えた合計金額を人数で割り、請求先ごとの支払いQR(と
 * 同じ内容のリンク)を一括で発行する。QRの宛先は自分(アクティブなウォレット)で、金額は
 * 各人の負担額。QRの中身は他の「指定金額を受け取る」系の画面と同じEIP-681形式
 * (lib/jpycPayment.ts の buildJpycPaymentUri)。入金の自動検知はこの画面では行わない。
 */
export default function QRGeneratorSplit() {
  const { t } = useTranslation();
  const activeChain = useAppStore((s) => s.activeChain);
  const displayCurrency = useAppStore((s) => s.displayCurrency);

  const [chain, setChain] = useState<ChainKey>(activeChain as ChainKey);
  const [chainMenuAnchor, setChainMenuAnchor] = useState<null | HTMLElement>(null);
  const [totalText, setTotalText] = useState('');
  const [people, setPeople] = useState(3);
  const [includeSelf, setIncludeSelf] = useState(true);
  const [names, setNames] = useState<Record<number, string>>({});
  const [address, setAddress] = useState('');
  const [decimals, setDecimals] = useState(18);
  const [snackbar, setSnackbar] = useState('');
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});

  // 表示通貨がUSDならUSDC、それ以外(またはそのチェーンにUSDCが無い場合)はJPYC。
  const usdcInfo = displayCurrency === 'USD' ? getUsdcTokenInfo(chain) : undefined;
  const unit = usdcInfo ? usdcInfo.symbol : 'JPYC';
  const step = usdcInfo ? new Decimal('0.01') : new Decimal(1);

  useEffect(() => {
    (async () => {
      const wallet = await WalletsHelper.getActive();
      setAddress(wallet?.address ?? '');
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const value = usdcInfo ? usdcInfo.decimals : await getJpycDecimals(chain);
      if (!cancelled) setDecimals(value);
    })();
    return () => { cancelled = true; };
  }, [chain, usdcInfo]);

  // AmountField は「.」や「1.」のような途中の入力も通すので、Decimal が例外を投げないよう 0 扱いにする。
  let total = new Decimal(0);
  try {
    total = new Decimal(totalText || '0');
  } catch {
    total = new Decimal(0);
  }
  const result = splitBill(total, people, includeSelf, step);
  const nameOf = (index: number) => names[index] ?? t('qrlab.split_default_name', { n: index + 1 });
  const uriFor = (amount: Decimal) => buildJpycPaymentUri(chain, address, amount, decimals, usdcInfo?.address);

  const onCopy = async (amount: Decimal) => {
    try {
      await navigator.clipboard.writeText(uriFor(amount));
      setSnackbar(t('qrlab.split_link_copied'));
    } catch (e) {
      console.warn('Failed to copy payment link', e);
    }
  };

  const onShare = async (index: number, amount: Decimal) => {
    try {
      await navigator.share({
        text: `${nameOf(index)}: ${amount.toString()} ${unit} (${CHAINS[chain].name})\n${uriFor(amount)}`,
      });
    } catch (e) {
      // ユーザーが共有シートを閉じた場合も例外になるので、握りつぶす。
      console.debug('Share cancelled or failed', e);
    }
  };

  const onDownload = (index: number, amount: Decimal) => {
    const canvas = canvasRefs.current[index];
    if (!canvas) return;
    downloadPaymentReceiptImage({
      qrCanvas: canvas,
      title: t('qrlab.split_receipt_title', { name: nameOf(index) }),
      totalLabel: `${amount.toString()} ${unit}`,
      chainLabel: CHAINS[chain].name,
      addressLabel: t('qrlab.receipt_address_label'),
      address,
    });
  };

  return (
    <Box>
      <AppToolBar back="/top?tab=qrlab" title={t('qrlab.split_title')} />
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-end' }}>
          <Box sx={{ flex: '0 0 42%', minWidth: 0 }}>
            <Typography sx={{ color: 'primary.main', mb: 0.5 }}>{t('marketplace.collect_chain_label')}</Typography>
            <Box
              onClick={(e) => setChainMenuAnchor(e.currentTarget)}
              sx={{
                bgcolor: 'grey.100', borderRadius: 3, px: 1.5, height: 56, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Avatar src={CHAIN_ICONS[chain]} sx={{ width: 28, height: 28, flexShrink: 0 }} />
                <Typography noWrap sx={{ fontWeight: 'bold' }}>{CHAINS[chain].name}</Typography>
              </Box>
              <ExpandMoreIcon sx={{ color: 'text.secondary', flexShrink: 0 }} />
            </Box>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ color: 'primary.main', mb: 0.5 }}>{t('qrlab.split_total_label')}</Typography>
            <AmountField value={totalText} unit={unit} onChange={setTotalText} />
          </Box>
        </Box>
        <Menu anchorEl={chainMenuAnchor} open={!!chainMenuAnchor} onClose={() => setChainMenuAnchor(null)}>
          {CHAIN_KEYS.map((key) => (
            <MenuItem key={key} selected={key === chain} onClick={() => { setChain(key); setChainMenuAnchor(null); }}>
              <Avatar src={CHAIN_ICONS[key]} sx={{ width: 24, height: 24, mr: 1.5 }} />
              {CHAINS[key].name}
            </MenuItem>
          ))}
        </Menu>

        <TextField
          type="number" label={t('qrlab.split_people_label')} value={people}
          onChange={(e) => setPeople(Math.floor(Number(e.target.value)))}
          slotProps={{ htmlInput: { min: 1, max: MAX_SPLIT_PEOPLE, inputMode: 'numeric' } }}
          helperText={t('qrlab.split_people_hint', { max: MAX_SPLIT_PEOPLE })}
        />
        <FormControlLabel
          control={<Switch checked={includeSelf} onChange={(e) => setIncludeSelf(e.target.checked)} />}
          label={t('qrlab.split_include_self')}
        />

        {result === null ? (
          <Typography align="center" color="text.secondary" sx={{ mt: 2 }}>{t('qrlab.split_invalid')}</Typography>
        ) : (
          <>
            <Card sx={{ p: 2 }} elevation={0} variant="outlined">
              <Typography sx={{ fontWeight: 'bold' }}>
                {t('qrlab.split_per_person', { amount: result.shares[0].toString(), unit })}
              </Typography>
              {result.selfShare !== null && (
                <Typography variant="body2" color="text.secondary">
                  {t('qrlab.split_self_share', { amount: result.selfShare.toString(), unit })}
                </Typography>
              )}
              {!result.effectiveTotal.equals(total) && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {t('qrlab.split_rounded_note', { amount: result.effectiveTotal.toString(), unit })}
                </Typography>
              )}
            </Card>

            <Typography sx={{ color: 'primary.main' }}>
              {t('qrlab.split_members_heading', { count: result.shares.length })}
            </Typography>
            {result.shares.map((amount, index) => (
              <Card key={index} sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <TextField
                    size="small" fullWidth label={t('common.name')} value={names[index] ?? ''}
                    placeholder={t('qrlab.split_default_name', { n: index + 1 })}
                    onChange={(e) => setNames({ ...names, [index]: e.target.value })}
                  />
                  <QRCodeCanvas
                    ref={(el) => { canvasRefs.current[index] = el; }}
                    value={uriFor(amount)} size={160}
                  />
                  <Typography sx={{ fontSize: 'x-large', fontWeight: 'bold' }}>{amount.toString()} {unit}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <IconButton color="primary" aria-label={t('qrlab.split_copy_link')} onClick={() => onCopy(amount)}>
                      <ContentCopyIcon />
                    </IconButton>
                    {typeof navigator.share === 'function' && (
                      <IconButton color="primary" aria-label={t('qrlab.split_share')} onClick={() => onShare(index, amount)}>
                        <ShareIcon />
                      </IconButton>
                    )}
                    <IconButton color="primary" aria-label={t('qrlab.download_qr')} onClick={() => onDownload(index, amount)}>
                      <DownloadIcon />
                    </IconButton>
                  </Box>
                </Box>
              </Card>
            ))}
            <Typography variant="caption" color="text.secondary">{t('qrlab.split_note')}</Typography>
          </>
        )}
      </Box>
      <Snackbar open={snackbar !== ''} autoHideDuration={2000} onClose={() => setSnackbar('')} message={snackbar} />
    </Box>
  );
}
