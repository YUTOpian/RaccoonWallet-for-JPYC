import { useEffect } from 'react';
import { Alert, Box, Button, Fade } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '../store/notificationStore';
import type { AppNotification } from '../store/notificationStore';

const DEFAULT_DURATION: Record<AppNotification['severity'], number> = {
  info: 6000,
  success: 8000,
  error: 12000,
};

function NotificationItem({ item }: { item: AppNotification }) {
  const { t } = useTranslation();
  const dismiss = useNotificationStore((s) => s.dismiss);

  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), item.durationMs ?? DEFAULT_DURATION[item.severity]);
    return () => clearTimeout(timer);
  }, [item.id, item.durationMs, item.severity, dismiss]);

  return (
    <Fade in appear>
      <Alert
        severity={item.severity}
        variant="filled"
        elevation={6}
        onClose={() => dismiss(item.id)}
        action={
          item.explorerUrl ? (
            <Button color="inherit" size="small" href={item.explorerUrl} target="_blank" rel="noopener">
              {t('send.notice_view_tx')}
            </Button>
          ) : undefined
        }
        sx={{ alignItems: 'center', borderRadius: 3, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', pointerEvents: 'auto' }}
      >
        {item.message}
      </Alert>
    </Fade>
  );
}

// 右上に通知を積み重ねて表示する。App のルートに1つだけ置く。
export default function NotificationHost() {
  const items = useNotificationStore((s) => s.items);
  if (items.length === 0) return null;
  return (
    <Box
      sx={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        right: 12,
        width: 'min(380px, calc(100vw - 24px))',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        zIndex: (theme) => theme.zIndex.snackbar,
        pointerEvents: 'none', // 通知の外側は下の画面を操作できるように
      }}
    >
      {items.map((item) => (
        <NotificationItem key={item.id} item={item} />
      ))}
    </Box>
  );
}
