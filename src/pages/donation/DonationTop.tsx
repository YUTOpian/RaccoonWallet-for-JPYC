import { Box, Card, CardActionArea, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import iconYuki from '../../assets/icon_yuki.png';
import iconRhime from '../../assets/icon_rhime.png';
import iconRyuta from '../../assets/icon_ryuta.png';
import iconBoxNext from '../../assets/icon_box_next.png';

export default function DonationTop() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Box>
      <AppToolBar back="/top?tab=home" title={t('donation.title')} />
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', mt: 2, px: 2 }}>
          <Card>
            <CardActionArea onClick={() => navigate('/donation/detail?target=android')}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 1 }}>
                <Box component="img" src={iconYuki} sx={{ width: 72 }} />
                <Typography sx={{ color: 'primary.main' }}>Android Developer</Typography>
                <Typography variant="body2" color="text.secondary">{t('common.engineer')}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Box component="img" src={iconBoxNext} sx={{ width: 42, mt: '-8px', mb: '-10px', mr: '-4px' }} />
              </Box>
            </CardActionArea>
          </Card>

          <Box sx={{ display: 'flex', mt: 1, gap: 1 }}>
            <Card sx={{ flex: 1 }}>
              <CardActionArea onClick={() => navigate('/donation/detail?target=rhime')}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1 }}>
                  <Box component="img" src={iconRhime} sx={{ width: 72 }} />
                  <Typography sx={{ color: 'primary.main' }}>Rhime</Typography>
                  <Typography variant="body2" color="text.secondary">UI{t('common.designer')}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Box component="img" src={iconBoxNext} sx={{ width: 42, mt: '-8px', mb: '-10px', mr: '-4px' }} />
                </Box>
              </CardActionArea>
            </Card>
            <Card sx={{ flex: 1 }}>
              <CardActionArea onClick={() => navigate('/donation/detail?target=ryuta')}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1 }}>
                  <Box component="img" src={iconRyuta} sx={{ width: 72 }} />
                  <Typography sx={{ color: 'primary.main' }}>Ryuta</Typography>
                  <Typography variant="body2" color="text.secondary">iOS{t('common.engineer')}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Box component="img" src={iconBoxNext} sx={{ width: 42, mt: '-8px', mb: '-10px', mr: '-4px' }} />
                </Box>
              </CardActionArea>
            </Card>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
