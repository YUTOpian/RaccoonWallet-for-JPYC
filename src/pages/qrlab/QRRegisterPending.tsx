import { useCallback, useEffect, useState } from 'react';
import { Box, Card, Typography, List, ListItemButton, ListItemText, Divider } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { PendingCheckoutsHelper } from '../../lib/storage';
import type { PendingCheckoutRecord } from '../../lib/storage';
import { CHAINS } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';

// QRレジスターの「入金待ち一覧」: every checkout whose payment QR has already been shown to
// a customer but hasn't been confirmed (or manually completed) yet - see
// PendingCheckoutRecord in lib/storage.ts and QRRegister.tsx, which creates one of these the
// moment it generates a payment QR and removes it once the sale is finalized or explicitly
// cancelled. Tapping an item resumes QRRegister directly in its waiting/payment screen
// (via ?pendingId=), re-anchored at the same starting block so a payment made while this
// screen wasn't open is still picked up.
export default function QRRegisterPending() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [pending, setPending] = useState<PendingCheckoutRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setPending(await PendingCheckoutsHelper.list());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summarize = (record: PendingCheckoutRecord) =>
    record.cart.map((line) => `${line.name}×${line.quantity}`).join(', ');

  return (
    <Box>
      <AppToolBar back="/qrlab/register" title={t('register.pending_title')} />

      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('register.pending_hint')}
        </Typography>

        {!loading && pending.length === 0 ? (
          <Typography align="center" color="text.secondary" sx={{ mt: 6 }}>
            {t('register.pending_empty')}
          </Typography>
        ) : (
          <Card>
            <List sx={{ py: 0 }}>
              {pending.map((record, i) => (
                <Box key={record.id}>
                  <ListItemButton onClick={() => navigate(`/qrlab/register?pendingId=${record.id}`)}>
                    <ListItemText
                      primary={`${Number(record.total).toLocaleString()} ${record.currency === 'USD' ? 'USDC' : t('marketplace.price_unit')} ・ ${CHAINS[record.chain as ChainKey]?.name ?? record.chain}`}
                      secondary={`${summarize(record)} ・ ${new Date(record.createdAt).toLocaleString()}`}
                    />
                    <ChevronRightIcon color="action" />
                  </ListItemButton>
                  {i < pending.length - 1 && <Divider />}
                </Box>
              ))}
            </List>
          </Card>
        )}
      </Box>
    </Box>
  );
}
