import { Box, Divider, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatAmount, payloadTotals } from '../lib/invoice';
import type { InvoicePayload } from '../lib/invoice';

// Line items + per-tax-rate totals of an invoice, shared by the issuer's detail screen and the
// payer's /pay screen so both show exactly the same figures (both derive them from the payload
// with payloadTotals, never from stored numbers).
export default function InvoiceSummary({ payload }: { payload: InvoicePayload }) {
  const { t } = useTranslation();
  const totals = payloadTotals(payload);
  return (
    <Box>
      {payload.it.map((item, i) => (
        <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.75 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ wordBreak: 'break-word' }}>{item.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {`${formatAmount(item.price)} × ${item.qty}  ·  ${item.rate === 0 ? t('invoice.tax_exempt_short') : `${item.rate}%${item.rate === 8 ? '※' : ''}`}`}
            </Typography>
          </Box>
          <Typography sx={{ whiteSpace: 'nowrap' }}>{formatAmount(totals.lineAmounts[i])}</Typography>
        </Box>
      ))}
      {payload.it.some((item) => item.rate === 8) && (
        <Typography variant="caption" color="text.secondary">{t('invoice.reduced_rate_note')}</Typography>
      )}
      <Divider sx={{ my: 1 }} />
      {totals.groups.map((g) => (
        <Box key={g.rate}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              {g.rate === 0 ? t('invoice.tax_exempt_target') : t('invoice.rate_target_net', { rate: g.rate })}
            </Typography>
            <Typography variant="body2">{formatAmount(g.net)}</Typography>
          </Box>
          {g.rate !== 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body2" color="text.secondary">{t('invoice.consumption_tax', { rate: g.rate })}</Typography>
              <Typography variant="body2">{formatAmount(g.tax)}</Typography>
            </Box>
          )}
        </Box>
      ))}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mt: 1 }}>
        <Typography sx={{ fontWeight: 'bold' }}>{t('invoice.total_incl_tax')}</Typography>
        <Typography sx={{ fontWeight: 'bold', fontSize: 'x-large' }}>{`${formatAmount(totals.total)} JPYC`}</Typography>
      </Box>
    </Box>
  );
}
