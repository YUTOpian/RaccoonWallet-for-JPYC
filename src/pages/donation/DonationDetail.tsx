import { Box, Card, CardContent, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import iconYuki from '../../assets/icon_yuki.png';
import iconRhime from '../../assets/icon_rhime.png';
import iconRyuta from '../../assets/icon_ryuta.png';

const targets: Record<string, { name: string; icon: string; jobKey: 'engineer' | 'designer'; jobPrefix?: string; detailKey: string }> = {
  android: {
    name: 'Android Developer',
    icon: iconYuki,
    jobKey: 'engineer',
    detailKey: 'donation.android_developer_detail',
  },
  rhime: {
    name: 'Rhime',
    icon: iconRhime,
    jobKey: 'designer',
    jobPrefix: 'UI',
    detailKey: 'donation.rhime_detail',
  },
  ryuta: {
    name: 'Ryuta',
    icon: iconRyuta,
    jobKey: 'engineer',
    jobPrefix: 'iOS',
    detailKey: 'donation.ryuta_detail',
  },
};

export default function DonationDetail() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const target = targets[searchParams.get('target') || ''];

  if (!target) {
    return null;
  }

  return (
    <Box>
      <AppToolBar back="/donation/top" title={t('donation.detail_title')} />
      <Box sx={{ p: 2 }}>
        <Card>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1 }}>
            <Box component="img" src={target.icon} sx={{ width: 72 }} />
            <Typography sx={{ color: 'primary.main' }}>{target.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {target.jobPrefix ?? ''}{t(`common.${target.jobKey}`)}
            </Typography>
          </Box>
          <CardContent>
            <Typography>
              {(t(target.detailKey, { returnObjects: true }) as string[]).map((line, i) => (
                <span key={i}>{line}<br /></span>
              ))}
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
