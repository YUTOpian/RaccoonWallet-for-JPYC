import { useState } from 'react';
import { Box, Typography, Button, Avatar, Menu, MenuItem } from '@mui/material';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import AmountField from '../../components/AmountField';
import { CHAINS } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { CHAIN_ICONS } from '../../lib/chainIcons';
import { useAppStore } from '../../store/appStore';

const CHAIN_KEYS = Object.keys(CHAINS) as ChainKey[];

/**
 * QR Lab's 指定金額を受け取る: pick an amount and a chain, then generate a payment QR for it
 * (see QRGeneratorCollect). Normally this is JPYC - JPY-pegged 1:1 (see lib/chains.ts), so
 * unlike the app's old XEM-based version of this screen, there's no exchange rate to fetch or
 * XEM/JPY base to toggle between, the amount entered here is the JPYC amount, full stop - but
 * when 設定 > 表示通貨 is set to USD, this screen (and QRGeneratorCollect after it) switches
 * over to USDC instead, so the same "amount entered is the amount sent" property holds there
 * too.
 */
export default function QRGeneratorAmount() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const calculatorFormula = useAppStore((s) => s.calculatorFormula);
  const calculatorValue = useAppStore((s) => s.calculatorValue);
  const setCalculatorFormula = useAppStore((s) => s.setCalculatorFormula);
  const setCalculatorValue = useAppStore((s) => s.setCalculatorValue);
  const activeChain = useAppStore((s) => s.activeChain);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const [chain, setChain] = useState<ChainKey>(activeChain as ChainKey);
  // Anchor for the chain-picker menu below - same tappable-pill-plus-Menu pattern SwapTop
  // uses for its own chain selector, in place of the old ToggleButtonGroup row.
  const [chainMenuAnchor, setChainMenuAnchor] = useState<null | HTMLElement>(null);

  const currencyUnit = displayCurrency === 'USD' ? 'USDC' : 'JPYC';

  return (
    <Box sx={{ height: '100%' }}>
      <AppToolBar back="/top?tab=qrlab" title={t('qrlab.amount_title')} />
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ px: 2 }}>
          <Button
            variant="text"
            fullWidth
            startIcon={<HourglassTopIcon />}
            sx={{ mb: 1 }}
            onClick={() => navigate('/qrlab/pending')}
          >
            {t('qrlab.pending_view')}
          </Button>

          {/* 左: 受け取るチェーン / 右: 金額 を1行に並べる。 */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-end', mt: 1 }}>
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
              <Typography sx={{ color: 'primary.main', mb: 0.5 }}>{t('common.amount')}</Typography>
              <AmountField
                value={calculatorFormula === '0' ? '' : calculatorFormula}
                unit={currencyUnit}
                onChange={(v) => { setCalculatorFormula(v === '' ? '0' : v); setCalculatorValue(Number(v) || 0); }}
              />
            </Box>
          </Box>
          <Menu anchorEl={chainMenuAnchor} open={!!chainMenuAnchor} onClose={() => setChainMenuAnchor(null)}>
            {CHAIN_KEYS.map((key) => (
              <MenuItem
                key={key}
                selected={key === chain}
                onClick={() => { setChain(key); setChainMenuAnchor(null); }}
              >
                <Avatar src={CHAIN_ICONS[key]} sx={{ width: 24, height: 24, mr: 1.5 }} />
                {CHAINS[key].name}
              </MenuItem>
            ))}
          </Menu>
        </Box>
      </Box>
      <Box sx={{ px: 2, py: 2 }}>
        <Button
          variant="contained"
          fullWidth
          disabled={!(calculatorValue > 0)}
          onClick={() => navigate(`/qrlab/collect?amount=${calculatorValue}&chain=${chain}&currency=${displayCurrency}`)}
        >
          OK
        </Button>
      </Box>
    </Box>
  );
}
