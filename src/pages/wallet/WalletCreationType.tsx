import { Box, Card, CardMedia, CardContent, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import AppToolBar from '../../components/AppToolBar';
import { useTranslation } from 'react-i18next';
import heroNewCard from '../../assets/heroimage_new_card.png';
import heroLoginCard from '../../assets/heroimage_login_card.png';

const items = [
  { image: heroNewCard, color: 'primary' as const, text: 'Create New Wallet', to: '/wallet/creation/name' },
  { image: heroLoginCard, color: 'nemBlue', text: 'LOGIN', to: '/wallet/login/import' },
];

export default function WalletCreationType() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div>
      <AppToolBar back="/wallet/select" title={t('wallet.select')} />
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((item) => (
          <Card key={item.image} sx={{ m: 2 }}>
            <CardMedia component="img" image={item.image} sx={{ width: '100%', objectFit: 'contain' }} />
            <CardContent>
              <Button
                fullWidth
                variant="contained"
                sx={item.color === 'nemBlue' ? { bgcolor: (theme) => theme.palette.nemBlue } : undefined}
                color={item.color === 'primary' ? 'primary' : undefined}
                onClick={() => navigate(item.to)}
              >
                {item.text}
              </Button>
            </CardContent>
          </Card>
        ))}
      </Box>
    </div>
  );
}
