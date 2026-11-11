import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { loadDueSnapshot } from '../lib/scheduledDue';
import { formatAmount } from '../lib/invoice';
import { notify } from '../store/notificationStore';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Renders nothing. While the app is open it checks for 予約送金 that have fallen due (at launch,
// whenever the tab comes back to the foreground, and every few minutes) and tells the person once
// per occurrence per session: an in-app notification, plus a system notification if they allowed
// those and the app is in a background tab. (A closed PWA can't be woken - that's what the
// calendar export on the 予約送金 screen is for.)
export default function ScheduledPaymentWatcher() {
  const { t } = useTranslation();
  const announced = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const { due } = await loadDueSnapshot();
        if (cancelled) return;
        const fresh = due.filter((r) => !announced.current.has(`${r.id}:${r.nextDue}`));
        if (fresh.length === 0) return;
        fresh.forEach((r) => announced.current.add(`${r.id}:${r.nextDue}`));

        const message = fresh.length === 1
          ? t('scheduled.notice_one', { label: fresh[0].label, amount: formatAmount(Number(fresh[0].amount)) })
          : t('scheduled.notice_many', { count: fresh.length });
        notify({ severity: 'info', message, durationMs: 12000 });

        if (document.visibilityState === 'hidden' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification(t('scheduled.title'), { body: message, tag: 'scheduled-payments' });
          } catch {
            // some mobile browsers only allow notifications through a service worker - ignore
          }
        }
      } catch (e) {
        console.error('Scheduled payment check failed', e);
      }
    };

    check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    const handle = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(handle);
    };
  }, [t]);

  return null;
}
