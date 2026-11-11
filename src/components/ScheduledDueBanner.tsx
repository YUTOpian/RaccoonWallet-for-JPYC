import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Card, Typography } from '@mui/material';
import EventRepeatOutlinedIcon from '@mui/icons-material/EventRepeatOutlined';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loadDueSnapshot } from '../lib/scheduledDue';
import type { DueSnapshot } from '../lib/scheduledDue';
import { daysBetween } from '../lib/scheduledPayments';
import { formatAmount, todayString } from '../lib/invoice';

// Home's reminder for 予約送金: payments that are due (with a one-tap "支払う") and ones coming up
// inside their reminder window. Renders nothing when there is nothing to do.
export default function ScheduledDueBanner({ refreshKey }: { refreshKey?: unknown }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<DueSnapshot>({ due: [], upcoming: [] });

  const load = useCallback(async () => {
    try {
      setSnapshot(await loadDueSnapshot());
    } catch (e) {
      console.error('Failed to load scheduled payments', e);
    }
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load, refreshKey]);

  const { due, upcoming } = snapshot;
  if (due.length === 0 && upcoming.length === 0) return null;
  const today = todayString();

  return (
    <Card sx={{ mt: 2, p: 2, border: due.length > 0 ? '1px solid' : 'none', borderColor: 'warning.main' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <EventRepeatOutlinedIcon color={due.length > 0 ? 'warning' : 'primary'} />
        <Typography sx={{ fontWeight: 'bold', flexGrow: 1 }}>
          {due.length > 0 ? t('scheduled.banner_due', { count: due.length }) : t('scheduled.banner_upcoming')}
        </Typography>
        <Button size="small" onClick={() => navigate('/scheduled')}>{t('scheduled.banner_all')}</Button>
      </Box>
      {due.map((r) => {
        const late = -daysBetween(today, r.nextDue);
        return (
          <Box key={r.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 500 }}>{r.label}</Typography>
              <Typography variant="caption" color={late > 0 ? 'error' : 'text.secondary'}>
                {`${formatAmount(Number(r.amount))} JPYC · ${late > 0 ? t('scheduled.days_overdue', { count: late }) : t('scheduled.due_today')}`}
              </Typography>
            </Box>
            <Button variant="contained" size="small" onClick={() => navigate(`/scheduled/pay?id=${r.id}`)}>{t('scheduled.pay')}</Button>
          </Box>
        );
      })}
      {upcoming.map((r) => (
        <Box key={r.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 500 }}>{r.label}</Typography>
            <Typography variant="caption" color="text.secondary">
              {`${formatAmount(Number(r.amount))} JPYC · ${t('scheduled.in_days', { count: daysBetween(today, r.nextDue) })}`}
            </Typography>
          </Box>
          <Button size="small" onClick={() => navigate(`/scheduled/pay?id=${r.id}`)}>{t('scheduled.view')}</Button>
        </Box>
      ))}
    </Card>
  );
}
