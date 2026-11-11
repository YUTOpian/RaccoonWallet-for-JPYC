import { useCallback, useEffect, useState } from 'react';
import { Box, Card, Typography, List, ListItemButton, ListItemText, Divider } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { PendingReceivesHelper } from '../../lib/storage';
import type { PendingReceiveRecord } from '../../lib/storage';
import { CHAINS } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';

// QR Lab「指定金額を受け取る」の「入金待ち一覧」: every receive whose payment QR has
// already been shown but hasn't been confirmed (or manually completed) yet - see
// PendingReceiveRecord in lib/storage.ts and QRGeneratorCollect.tsx, which creates one of
// these the moment it generates a payment QR and removes it once the receive finalizes or
// is explicitly cancelled. Tapping an item resumes QRGeneratorCollect directly in its
// waiting/payment screen (via ?pendingId=), re-anchored at the same starting block so a
// payment made while this screen wasn't open is still picked up.
export default function QRGeneratorPending() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [pending, setPending] = useState<PendingReceiveRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setPending(await PendingReceivesHelper.list());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box>
      <AppToolBar back="/qrlab/amount" title={t('qrlab.pending_title')} />

      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('qrlab.pending_hint')}
        </Typography>

        {!loading && pending.length === 0 ? (
          <Typography align="center" color="text.secondary" sx={{ mt: 6 }}>
            {t('qrlab.pending_empty')}
          </Typography>
        ) : (
          <Card>
            <List sx={{ py: 0 }}>
              {pending.map((record, i) => (
                <Box key={record.id}>
                  <ListItemButton onClick={() => navigate(`/qrlab/collect?pendingId=${record.id}`)}>
                    <ListItemText
                      primary={`${Number(record.amount).toLocaleString()} ${record.currency === 'USD' ? 'USDC' : t('marketplace.price_unit')} ・ ${CHAINS[record.chain as ChainKey]?.name ?? record.chain}`}
                      secondary={new Date(record.createdAt).toLocaleString()}
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
