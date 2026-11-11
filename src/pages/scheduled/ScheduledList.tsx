import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardActionArea, Chip, IconButton, Snackbar, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EventOutlinedIcon from '@mui/icons-material/EventOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import { ScheduledPaymentsHelper, WalletsHelper } from '../../lib/storage';
import type { ScheduledPaymentRecord } from '../../lib/storage';
import { classify, daysBetween } from '../../lib/scheduledPayments';
import { exportScheduleCalendar } from '../../lib/scheduledCalendar';
import { formatAmount, formatJapaneseDate, todayString } from '../../lib/invoice';
import { CHAINS } from '../../lib/chains';
import { chainKeyForId } from '../../lib/invoicePayment';

// 予約送金の一覧。期日が来たものは目立たせ、そこから1タップで承認画面へ進める。
export default function ScheduledList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [records, setRecords] = useState<ScheduledPaymentRecord[]>([]);
  const [hasWallet, setHasWallet] = useState(true);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  const load = useCallback(async () => {
    const wallet = await WalletsHelper.getActive();
    setHasWallet(wallet !== null);
    setRecords(wallet ? await ScheduledPaymentsHelper.listFor(wallet.address) : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const today = todayString();
  const active = useMemo(() => records.filter((r) => r.status === 'active'), [records]);
  const inactive = useMemo(() => records.filter((r) => r.status !== 'active'), [records]);

  const frequencyText = (r: ScheduledPaymentRecord) => {
    switch (r.frequency) {
      case 'monthly': return t('scheduled.freq_monthly_on', { day: r.anchorDay >= 29 ? t('scheduled.day_end') : t('scheduled.day_n', { day: r.anchorDay }) });
      case 'weekly': return t('scheduled.freq_weekly');
      case 'yearly': return t('scheduled.freq_yearly');
      default: return t('scheduled.freq_once');
    }
  };

  const onEnableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setNotifPermission(await Notification.requestPermission());
  };

  const onExport = async () => {
    const targets = active;
    if (targets.length === 0) return;
    await exportScheduleCalendar(targets, t);
    setNotice(t('scheduled.calendar_saved'));
  };

  const renderCard = (r: ScheduledPaymentRecord) => {
    const { state, days } = classify(r, today);
    const chainKey = chainKeyForId(r.chainId);
    return (
      <Card key={r.id} sx={{ mt: 1.5, opacity: r.status === 'active' ? 1 : 0.7 }}>
        <CardActionArea onClick={() => navigate(r.status === 'active' ? `/scheduled/pay?id=${r.id}` : `/scheduled/form?id=${r.id}`)} sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 'bold', wordBreak: 'break-word' }}>{r.label}</Typography>
              <Typography variant="caption" color="text.secondary" component="div" noWrap>
                {r.recipientName !== '' ? r.recipientName : `${r.toAddress.slice(0, 8)}…${r.toAddress.slice(-6)}`}
                {` · ${chainKey ? CHAINS[chainKey].name : `chainId ${r.chainId}`}`}
              </Typography>
            </Box>
            <Typography sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{`${formatAmount(Number(r.amount))} JPYC`}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            {r.status === 'paused' && <Chip size="small" label={t('scheduled.status_paused')} />}
            {r.status === 'completed' && <Chip size="small" label={t('scheduled.status_completed')} />}
            {state === 'due' && <Chip size="small" color="warning" label={days < 0 ? t('scheduled.days_overdue', { count: -days }) : t('scheduled.due_today')} />}
            {state === 'upcoming' && <Chip size="small" color="primary" variant="outlined" label={t('scheduled.in_days', { count: days })} />}
            <Typography variant="caption" color="text.secondary">
              {r.status === 'completed'
                ? frequencyText(r)
                : `${frequencyText(r)} · ${t('scheduled.next')}: ${formatJapaneseDate(r.nextDue)}${r.status === 'active' && state === 'later' ? ` (${t('scheduled.in_days', { count: daysBetween(today, r.nextDue) })})` : ''}`}
            </Typography>
          </Box>
        </CardActionArea>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 1, pb: 0.5 }}>
          <Button size="small" onClick={() => navigate(`/scheduled/form?id=${r.id}`)}>{t('scheduled.edit')}</Button>
        </Box>
      </Card>
    );
  };

  return (
    <Box>
      <AppToolBar
        back="/top?tab=home"
        onBack={() => navigate('/top?tab=home')}
        title={t('scheduled.title')}
        actions={
          <IconButton aria-label={t('scheduled.export_calendar')} disabled={active.length === 0} onClick={onExport}>
            <EventOutlinedIcon />
          </IconButton>
        }
      />
      <Box sx={{ p: 2 }}>
        {!hasWallet && <Alert severity="warning">{t('scheduled.no_wallet')}</Alert>}
        <Button variant="contained" fullWidth startIcon={<AddIcon />} disabled={!hasWallet} onClick={() => navigate('/scheduled/form')}>
          {t('scheduled.create')}
        </Button>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>{t('scheduled.how_it_works')}</Typography>

        {notifPermission === 'default' && (
          <Alert severity="info" icon={<NotificationsActiveOutlinedIcon />} sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={onEnableNotifications}>{t('scheduled.allow')}</Button>}>
            {t('scheduled.notifications_hint')}
          </Alert>
        )}

        {!loading && records.length === 0 && hasWallet && (
          <Typography align="center" color="text.secondary" sx={{ mt: 4, px: 2 }}>{t('scheduled.empty')}</Typography>
        )}

        {active.length > 0 && (
          <>
            <Typography sx={{ fontWeight: 'bold', mt: 3 }}>{t('scheduled.section_active')}</Typography>
            {active.map(renderCard)}
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>{t('scheduled.calendar_hint')}</Typography>
          </>
        )}
        {inactive.length > 0 && (
          <>
            <Typography sx={{ fontWeight: 'bold', mt: 3 }}>{t('scheduled.section_inactive')}</Typography>
            {inactive.map(renderCard)}
          </>
        )}
      </Box>
      <Snackbar open={notice !== ''} autoHideDuration={3000} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}
