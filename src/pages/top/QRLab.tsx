import { Box, Card, CardActionArea, Typography } from '@mui/material';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import iconDentaku from '../../assets/icon_dentaku.png';
import iconList from '../../assets/icon_list.png';
import iconRegister from '../../assets/icon_register_84px.png';

export default function QRLab() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const smallItems = [
    { icon: iconDentaku, text: t('qrlab.calculator_description'), to: '/qrlab/amount' },
    { icon: iconList, text: t('qrlab.list_description'), to: '/marketplace' },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', px: 2, pt: 2 }}>
        {smallItems.map((item) => (
          <Card key={item.icon} sx={{ mb: 2 }}>
            <CardActionArea onClick={() => navigate(item.to)} sx={{ display: 'flex' }}>
              <Box sx={{ bgcolor: 'primary.main', p: 2.5, width: '20%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Box component="img" src={item.icon} sx={{ maxHeight: '100%', maxWidth: '100%' }} />
              </Box>
              <Typography sx={{ p: 3, width: '80%' }}>{item.text}</Typography>
            </CardActionArea>
          </Card>
        ))}

        <Card sx={{ mb: 2 }}>
          <CardActionArea onClick={() => navigate('/qrlab/register')} sx={{ display: 'flex' }}>
            <Box sx={{ bgcolor: 'primary.main', p: 2.5, width: '33%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Box component="img" src={iconRegister} sx={{ maxHeight: '100%', maxWidth: '100%' }} />
            </Box>
            <Box sx={{ p: 3, width: '67%' }}>
              <Typography sx={{ fontSize: 'large' }}>{t('qrlab.register_name')}</Typography>
              <Typography sx={{ fontSize: 'small' }}>{t('qrlab.register_description')}</Typography>
            </Box>
          </CardActionArea>
        </Card>

        <Card sx={{ mb: 2 }}>
          <CardActionArea onClick={() => navigate('/qrlab/split')} sx={{ display: 'flex' }}>
            <Box sx={{ bgcolor: 'primary.main', p: 2.5, width: '20%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CallSplitIcon sx={{ color: '#fff', fontSize: 40 }} />
            </Box>
            <Typography sx={{ p: 3, width: '80%' }}>{t('qrlab.split_description')}</Typography>
          </CardActionArea>
        </Card>

        <Card sx={{ mb: 2 }}>
          <CardActionArea onClick={() => navigate('/invoice')} sx={{ display: 'flex' }}>
            <Box sx={{ bgcolor: 'primary.main', p: 2.5, width: '20%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ReceiptLongOutlinedIcon sx={{ color: '#fff', fontSize: 40 }} />
            </Box>
            <Typography sx={{ p: 3, width: '80%' }}>{t('invoice.menu_description')}</Typography>
          </CardActionArea>
        </Card>
      </Box>
    </Box>
  );
}
