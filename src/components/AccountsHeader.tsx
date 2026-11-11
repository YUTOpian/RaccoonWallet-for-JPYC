import { AppBar, Tab, Tabs, Toolbar, IconButton, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// 「マイアカウント」(ウォレット切替) と「マイ連絡先」(アドレス帳) を1つの画面グループに
// 統合するための共通ヘッダー。タブで /wallet/select と /addressbook を行き来する。
// ヒーロー画像は使わない。
const ACCOUNT_PATH = '/wallet/select';
const CONTACTS_PATH = '/addressbook';

interface AccountsHeaderProps {
  // アドレス帳をSendの宛先ピッカーとして開いた場合などタブを出さない。
  hideTabs?: boolean;
  title?: string;
}

export default function AccountsHeader({ hideTabs = false, title }: AccountsHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const value = pathname.startsWith(CONTACTS_PATH) ? CONTACTS_PATH : ACCOUNT_PATH;

  return (
    <AppBar position="sticky" color="default" elevation={1}>
      {/* 通常表示(タブあり)ではタイトルバーを出さずタブだけにする。
          宛先ピッカー(hideTabs)のときだけ、戻るボタン付きのバーを残す。 */}
      {hideTabs && (
        <Toolbar>
          <IconButton onClick={() => navigate(-1)} edge="start" aria-label="back">
            <ArrowBackIcon color="primary" />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>{title ?? t('account.title')}</Typography>
        </Toolbar>
      )}
      {!hideTabs && (
        <Tabs
          value={value}
          onChange={(_, next: string) => { if (next !== value) navigate(next, { replace: true }); }}
          variant="fullWidth"
        >
          <Tab value={ACCOUNT_PATH} label={t('account.tab_account')} />
          <Tab value={CONTACTS_PATH} label={t('account.tab_contacts')} />
        </Tabs>
      )}
    </AppBar>
  );
}
