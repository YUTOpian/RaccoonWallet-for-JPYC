import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createHashRouter, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import PlaceholderPage from './pages/PlaceholderPage';
import PinExposureGuard from './components/PinExposureGuard';
import AppShell from './components/AppShell';
import DevFeatureGate from './components/DevFeatureGate';
import { WalletsHelper } from './lib/storage';

// Every real screen is loaded via React.lazy() so the initial JS bundle only contains the
// app shell (router, theme, i18n bootstrap) — each route's code is fetched on first visit
// instead of all being bundled into one ~1.4MB file up front.
const WalletCreationType = lazy(() => import('./pages/wallet/WalletCreationType'));
const WalletCreationName = lazy(() => import('./pages/wallet/WalletCreationName'));
const WalletCreationMnemonic = lazy(() => import('./pages/wallet/WalletCreationMnemonic'));
const WalletCreationNew = lazy(() => import('./pages/wallet/WalletCreationNew'));
const WalletCreationEnd = lazy(() => import('./pages/wallet/WalletCreationEnd'));
const WalletLoginImport = lazy(() => import('./pages/wallet/WalletLoginImport'));
const WalletLoginName = lazy(() => import('./pages/wallet/WalletLoginName'));
const WalletLoginEnd = lazy(() => import('./pages/wallet/WalletLoginEnd'));
const WalletSelect = lazy(() => import('./pages/wallet/WalletSelect'));
const Welcome = lazy(() => import('./pages/Welcome'));
const Top = lazy(() => import('./pages/top/Top'));
const Balance = lazy(() => import('./pages/detail/Balance'));
const SendAmount = lazy(() => import('./pages/send/SendAmount'));
const SendConfirmation = lazy(() => import('./pages/send/SendConfirmation'));
const TransactionList = lazy(() => import('./pages/transaction/TransactionList'));
const TransactionDetail = lazy(() => import('./pages/transaction/TransactionDetail'));
const TransactionExport = lazy(() => import('./pages/transaction/TransactionExport'));
const JpycExchange = lazy(() => import('./pages/jpyc/JpycExchange'));
const SwapTop = lazy(() => import('./pages/swap/SwapTop'));
const SwapConfirmation = lazy(() => import('./pages/swap/SwapConfirmation'));
const SwapComplete = lazy(() => import('./pages/swap/SwapComplete'));
const WalletDetail = lazy(() => import('./pages/wallet/WalletDetail'));
const WalletAddress = lazy(() => import('./pages/wallet/WalletAddress'));
const WalletBackupCaution = lazy(() => import('./pages/wallet/WalletBackupCaution'));
const WalletBackup = lazy(() => import('./pages/wallet/WalletBackup'));
const WalletDelete = lazy(() => import('./pages/wallet/WalletDelete'));
const SettingsTop = lazy(() => import('./pages/settings/SettingsTop'));
const AssetRecoveryList = lazy(() => import('./pages/settings/AssetRecoveryList'));
const AssetRecoveryForm = lazy(() => import('./pages/settings/AssetRecoveryForm'));
const DonationTop = lazy(() => import('./pages/donation/DonationTop'));
const DonationDetail = lazy(() => import('./pages/donation/DonationDetail'));
const About = lazy(() => import('./pages/about/About'));
const AccountCreate = lazy(() => import('./pages/account/AccountCreate'));
const AccountImport = lazy(() => import('./pages/account/AccountImport'));
const AccountComplete = lazy(() => import('./pages/account/AccountComplete'));
const QRGeneratorAmount = lazy(() => import('./pages/qrlab/QRGeneratorAmount'));
const QRGeneratorCollect = lazy(() => import('./pages/qrlab/QRGeneratorCollect'));
const QRGeneratorPending = lazy(() => import('./pages/qrlab/QRGeneratorPending'));
const QRGeneratorSplit = lazy(() => import('./pages/qrlab/QRGeneratorSplit'));
const QRRegister = lazy(() => import('./pages/qrlab/QRRegister'));
const QRRegisterPending = lazy(() => import('./pages/qrlab/QRRegisterPending'));
const AddressBookList = lazy(() => import('./pages/addressbook/AddressBookList'));
const AddressBookDetail = lazy(() => import('./pages/addressbook/AddressBookDetail'));
const AddressBookWalletForm = lazy(() => import('./pages/addressbook/AddressBookWalletForm'));
const MarketplaceList = lazy(() => import('./pages/marketplace/MarketplaceList'));
const MarketplaceForm = lazy(() => import('./pages/marketplace/MarketplaceForm'));
const MarketplaceDetail = lazy(() => import('./pages/marketplace/MarketplaceDetail'));
const MarketplaceCollect = lazy(() => import('./pages/marketplace/MarketplaceCollect'));
const MarketplaceSalesHistory = lazy(() => import('./pages/marketplace/MarketplaceSalesHistory'));
const InvoiceList = lazy(() => import('./pages/invoice/InvoiceList'));
const InvoiceForm = lazy(() => import('./pages/invoice/InvoiceForm'));
const InvoiceDetail = lazy(() => import('./pages/invoice/InvoiceDetail'));
const InvoiceSettings = lazy(() => import('./pages/invoice/InvoiceSettings'));
const PayInvoice = lazy(() => import('./pages/invoice/PayInvoice'));
const ScheduledList = lazy(() => import('./pages/scheduled/ScheduledList'));
const ScheduledForm = lazy(() => import('./pages/scheduled/ScheduledForm'));
const ScheduledApprove = lazy(() => import('./pages/scheduled/ScheduledApprove'));
const WalletPinRequired = lazy(() => import('./pages/wallet/WalletPinRequired'));
const DappConnect = lazy(() => import('./pages/dapp/DappConnect'));
const NftList = lazy(() => import('./pages/nft/NftList'));

function RouteFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh' }}>
      <CircularProgress color="primary" />
    </Box>
  );
}

// Wraps a lazily-loaded page in its own Suspense boundary so navigating to one route
// shows a spinner only for that route, not a blank screen for the whole app.
function withSuspense(element: ReactElement): ReactElement {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

// Every route (other than the root redirect) is wrapped in PinExposureGuard, which
// transparently redirects to /wallet/pin-required instead of rendering the requested
// page whenever the active wallet still has no real PIN behind it - see that component
// for why this can still happen (pre-fix installations) even though normal usage no
// longer produces the state. Outside the Suspense boundary so the guard's own check
// (a couple of storage reads) resolves before the destination page's lazy chunk even
// starts loading.
function withGuard(element: ReactElement): ReactElement {
  return <PinExposureGuard>{element}</PinExposureGuard>;
}

// 起動時の振り分け:
// - アクティブなウォレットがあれば /top（ホーム）へ。
// - それ以外（ウォレットが1件も無い/あるが選択中のものが無い）は常に /welcome（ウェルカム画面）へ。
//   ウォレットを持っていても一度もアクティブにしていない状態でいきなり /wallet/select
//   に飛ばすと welcome 画面を経由しないままになってしまうため、/wallet/select への
//   遷移は welcome 画面の GET STARTED ボタン経由（ウォレット登録済みならそのまま
//   一覧が表示される）のみとする。
function RootRedirect() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const activeWallet = await WalletsHelper.getActive();
        setTarget(activeWallet ? '/top' : '/welcome');
      } catch (e) {
        // ストレージの読み込みに失敗した場合（初期化がまだ済んでいない、ドライバが
        // 使えない等）でもここで固まらないように、安全側の /welcome にフォールバックする。
        console.error('Failed to determine active wallet', e);
        setTarget('/welcome');
      }
    })();
  }, []);

  if (target === null) {
    return <RouteFallback />;
  }
  return <Navigate to={target} replace />;
}

// Route list ported 1:1 from the Vue app's src/router/index.ts. Every path exists from
// day one; most still point at PlaceholderPage so in-app navigation/back-buttons don't
// 404 while screens are ported one at a time — replace an entry's element with the real
// component as each screen gets built.
const routeDefs: { path: string; name: string; element?: ReactElement }[] = [
  { path: '/welcome', name: 'Welcome', element: <Welcome /> },
  { path: '/top', name: 'Top', element: <Top /> },
  { path: '/balance', name: 'Balance', element: <Balance /> },
  { path: '/transaction/list', name: 'TransactionList', element: <TransactionList /> },
  { path: '/transaction/detail', name: 'TransactionDetail', element: <TransactionDetail /> },
  { path: '/transaction/export', name: 'TransactionExport', element: <TransactionExport /> },
  { path: '/wallet/select', name: 'WalletSelect', element: <WalletSelect /> },
  { path: '/wallet/creation/type', name: 'WalletCreationType', element: <WalletCreationType /> },
  { path: '/wallet/creation/name', name: 'WalletCreationName', element: <WalletCreationName /> },
  { path: '/wallet/creation/mnemonic', name: 'WalletCreationMnemonic', element: <WalletCreationMnemonic /> },
  { path: '/wallet/creation/new', name: 'WalletCreationNew', element: <WalletCreationNew /> },
  { path: '/wallet/creation/end', name: 'WalletCreationEnd', element: <WalletCreationEnd /> },
  { path: '/wallet/login/import', name: 'WalletLoginImport', element: <WalletLoginImport /> },
  { path: '/wallet/login/name', name: 'WalletLoginName', element: <WalletLoginName /> },
  { path: '/wallet/login/end', name: 'WalletLoginEnd', element: <WalletLoginEnd /> },
  { path: '/wallet/address', name: 'WalletAddress', element: <WalletAddress /> },
  { path: '/wallet/backup_caution', name: 'WalletBackupCaution', element: <WalletBackupCaution /> },
  { path: '/wallet/backup', name: 'WalletBackup', element: <WalletBackup /> },
  { path: '/wallet/delete', name: 'WalletDelete', element: <WalletDelete /> },
  { path: '/wallet/detail', name: 'WalletDetail', element: <WalletDetail /> },
  { path: '/wallet/pin-required', name: 'WalletPinRequired', element: <WalletPinRequired /> },
  { path: '/account/create', name: 'AccountCreate', element: <AccountCreate /> },
  { path: '/account/import', name: 'AccountImport', element: <AccountImport /> },
  { path: '/account/complete', name: 'AccountComplete', element: <AccountComplete /> },
  { path: '/qrlab/amount', name: 'QRGeneratorAmount', element: <QRGeneratorAmount /> },
  { path: '/qrlab/collect', name: 'QRGeneratorCollect', element: <QRGeneratorCollect /> },
  { path: '/qrlab/pending', name: 'QRGeneratorPending', element: <QRGeneratorPending /> },
  { path: '/qrlab/split', name: 'QRGeneratorSplit', element: <QRGeneratorSplit /> },
  { path: '/qrlab/register', name: 'QRRegister', element: <QRRegister /> },
  { path: '/qrlab/register/pending', name: 'QRRegisterPending', element: <QRRegisterPending /> },
  { path: '/send/amount', name: 'SendAmount', element: <SendAmount /> },
  { path: '/send/confirmation', name: 'SendConfirmation', element: <SendConfirmation /> },
  // 送金完了画面は廃止。送金後はホームへ戻りバナーで知らせる(SendConfirmation 参照)。
  // 古いリンク等で来ても完了画面は出さず、ホームへ転送する。
  { path: '/send/complete', name: 'SendComplete', element: <Navigate to="/top?tab=home" replace /> },
  { path: '/about', name: 'About', element: <About /> },
  { path: '/jpyc/exchange', name: 'JpycExchange', element: <JpycExchange /> },
  { path: '/swap', name: 'SwapTop', element: <SwapTop /> },
  { path: '/swap/confirmation', name: 'SwapConfirmation', element: <SwapConfirmation /> },
  { path: '/swap/complete', name: 'SwapComplete', element: <SwapComplete /> },
  { path: '/donation/top', name: 'DonationTop', element: <DonationTop /> },
  { path: '/donation/detail', name: 'DonationDetail', element: <DonationDetail /> },
  { path: '/settings/top', name: 'SettingsTop', element: <SettingsTop /> },
  { path: '/settings/asset_recovery', name: 'AssetRecoveryList', element: <AssetRecoveryList /> },
  { path: '/settings/asset_recovery/add', name: 'AssetRecoveryForm', element: <AssetRecoveryForm /> },
  { path: '/addressbook', name: 'AddressBookList', element: <AddressBookList /> },
  { path: '/addressbook/detail', name: 'AddressBookDetail', element: <AddressBookDetail /> },
  { path: '/addressbook/wallet', name: 'AddressBookWalletForm', element: <AddressBookWalletForm /> },
  { path: '/marketplace', name: 'MarketplaceList', element: <MarketplaceList /> },
  { path: '/marketplace/form', name: 'MarketplaceForm', element: <MarketplaceForm /> },
  { path: '/marketplace/detail', name: 'MarketplaceDetail', element: <MarketplaceDetail /> },
  { path: '/marketplace/collect', name: 'MarketplaceCollect', element: <MarketplaceCollect /> },
  { path: '/marketplace/history', name: 'MarketplaceSalesHistory', element: <MarketplaceSalesHistory /> },
  { path: '/invoice', name: 'InvoiceList', element: <InvoiceList /> },
  { path: '/invoice/form', name: 'InvoiceForm', element: <InvoiceForm /> },
  { path: '/invoice/detail', name: 'InvoiceDetail', element: <InvoiceDetail /> },
  { path: '/invoice/settings', name: 'InvoiceSettings', element: <InvoiceSettings /> },
  { path: '/scheduled', name: 'ScheduledList', element: <ScheduledList /> },
  { path: '/scheduled/form', name: 'ScheduledForm', element: <ScheduledForm /> },
  { path: '/scheduled/pay', name: 'ScheduledApprove', element: <ScheduledApprove /> },
  // 請求リンク(#/pay?d=...)の受け取り側。ウォレットを持たない相手も開くので、サイドメニュー無しで表示する。
  { path: '/pay', name: 'PayInvoice', element: <PayInvoice /> },
  { path: '/dapp', name: 'DappConnect', element: <DevFeatureGate><DappConnect /></DevFeatureGate> },
  { path: '/nft', name: 'NftList', element: <DevFeatureGate><NftList /></DevFeatureGate> },
];

// HashRouter (not BrowserRouter) so this works both when opened directly as a local
// file (file://index.html) and when hosted on GitHub Pages: routing state lives entirely
// in the URL fragment (#/top, #/wallet/select, ...), so no server-side rewrite rules are
// needed for a route to be requested directly or refreshed — the server (or filesystem)
// only ever sees a request for index.html itself.
// Onboarding / wallet-management flows run full-screen without the side menu (they
// happen before a wallet is active, or deliberately hide the rest of the app).
const NO_SIDE_MENU_PREFIXES = ['/welcome', '/wallet/creation', '/wallet/login', '/wallet/pin-required', '/account', '/pay'];

function withShell(path: string, element: ReactElement): ReactElement {
  const bare = NO_SIDE_MENU_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  return bare ? element : <AppShell>{element}</AppShell>;
}

export const router = createHashRouter([
  { path: '/', element: <RootRedirect /> },
  ...routeDefs.map(({ path, name, element }) => ({
    path,
    element: withShell(path, withGuard(withSuspense(element ?? <PlaceholderPage name={name} />))),
  })),
]);
