import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, CardActionArea, Chip, IconButton, Tab, Tabs, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { InvoicesHelper } from '../../lib/storage';
import type { InvoiceRecord } from '../../lib/storage';
import { formatAmount, todayString } from '../../lib/invoice';

type Filter = 'open' | 'paid' | 'all';

// 請求書一覧: everything issued from this wallet, with open (未入金) invoices called out and
// overdue ones flagged. Opening one goes to InvoiceDetail (share link, PDF, payment check).
export default function InvoiceList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('open');

  const load = useCallback(async () => {
    setRecords(await InvoicesHelper.list());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const today = todayString();
  const openRecords = useMemo(() => records.filter((r) => r.status === 'issued'), [records]);
  const openTotal = openRecords.reduce((sum, r) => sum + r.total, 0);
  const visible = records.filter((r) => (filter === 'open' ? r.status === 'issued' : filter === 'paid' ? r.status === 'paid' : true));

  return (
    <Box>
      <AppToolBar
        back="/top?tab=qrlab"
        onBack={() => navigate('/top?tab=qrlab')}
        title={t('invoice.title')}
        actions={
          <IconButton aria-label={t('invoice.settings_title')} onClick={() => navigate('/invoice/settings')}>
            <SettingsOutlinedIcon />
          </IconButton>
        }
      />
      <Box sx={{ p: 2 }}>
        <Button variant="contained" fullWidth startIcon={<AddIcon />} onClick={() => navigate('/invoice/form')}>
          {t('invoice.create')}
        </Button>

        {openRecords.length > 0 && (
          <Card sx={{ p: 2, mt: 2 }}>
            <Typography variant="body2" color="text.secondary">{t('invoice.open_total')}</Typography>
            <Typography sx={{ fontSize: 'x-large', fontWeight: 'bold' }}>{`${formatAmount(openTotal)} JPYC`}</Typography>
            <Typography variant="caption" color="text.secondary">{t('invoice.open_count', { count: openRecords.length })}</Typography>
          </Card>
        )}

        <Tabs value={filter} onChange={(_, v: Filter) => setFilter(v)} variant="fullWidth" sx={{ mt: 2 }}>
          <Tab value="open" label={t('invoice.tab_open')} />
          <Tab value="paid" label={t('invoice.tab_paid')} />
          <Tab value="all" label={t('invoice.tab_all')} />
        </Tabs>

        {!loading && visible.length === 0 && (
          <Typography align="center" color="text.secondary" sx={{ mt: 4, px: 2 }}>
            {records.length === 0 ? t('invoice.empty_message') : t('invoice.empty_filtered')}
          </Typography>
        )}

        {visible.map((record) => {
          const overdue = record.status === 'issued' && record.due !== '' && record.due < today;
          return (
            <Card key={record.id} sx={{ mt: 1.5 }}>
              <CardActionArea onClick={() => navigate(`/invoice/detail?id=${record.id}`)} sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 'bold', wordBreak: 'break-word' }}>{record.recipient}</Typography>
                    <Typography variant="caption" color="text.secondary">{record.number}</Typography>
                  </Box>
                  <Typography sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{`${formatAmount(record.total)} JPYC`}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                  {record.status === 'paid' && <Chip size="small" color="success" label={t('invoice.status_paid')} />}
                  {record.status === 'cancelled' && <Chip size="small" label={t('invoice.status_cancelled')} />}
                  {record.status === 'issued' && <Chip size="small" color={overdue ? 'error' : 'warning'} label={overdue ? t('invoice.status_overdue') : t('invoice.status_open')} />}
                  <Typography variant="caption" color="text.secondary">
                    {record.due !== '' ? `${t('invoice.due_date')}: ${record.due}` : `${t('invoice.issue_date')}: ${record.issueDate}`}
                  </Typography>
                </Box>
              </CardActionArea>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}
