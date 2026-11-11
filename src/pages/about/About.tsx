import { Box, List, ListItem, ListItemButton, ListItemText, Divider, Typography, Card, CardActionArea, CardContent } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import topIcon from '../../assets/top_icon.png';
import topLogotype from '../../assets/top_logotype.png';
import iconLink from '../../assets/icon_link.png';

const openLink = (url: string) => window.open(url);

export default function About() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Clickable entries only - "About the original creators" navigates in-app. The Discord
  // entry (公式DISCORDサーバー | 紹介リンク) is listed separately below as plain,
  // non-clickable text: no onClick, no link icon, no outgoing URL.
  const links = [
    { text: t('donation.title'), action: () => navigate('/donation/top') },
  ];

  return (
    <Box>
      <AppToolBar back="/top?tab=home" title={t('about.title')} />

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', bgcolor: 'primary.main', py: 1 }}>
        <Box component="img" src={topIcon} sx={{ width: '25%', mt: 1 }} />
        <Box component="img" src={topLogotype} sx={{ width: '50%' }} />
        <Typography align="center" sx={{ color: 'white', mt: 3, px: 2, pb: 2 }}>
          {(t('about.app_concept', { returnObjects: true }) as string[]).map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Typography sx={{ m: 1 }}>Raccoon Wallet for JPYC</Typography>
        <List>
          {links.map((link) => (
            <Box key={link.text}>
              <ListItemButton onClick={link.action}>
                <ListItemText primary={link.text} />
                <Box component="img" src={iconLink} sx={{ width: 24 }} />
              </ListItemButton>
              <Divider />
            </Box>
          ))}
          <ListItem>
            <ListItemText primary={t('about.discord')} />
          </ListItem>
        </List>

        <Card variant="outlined" sx={{ border: 0 }}>
          <CardActionArea onClick={() => openLink('https://raccoonwallet.com/tos_pp/')}>
            <CardContent>
              <Typography align="center" sx={{ color: 'primary.main', textDecoration: 'underline' }}>
                {t('common.privacy_policy')}
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Box>
    </Box>
  );
}
