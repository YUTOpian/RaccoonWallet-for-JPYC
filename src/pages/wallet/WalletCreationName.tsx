import { useState } from 'react';
import { Box, TextField, Button, Typography, Link as MuiLink } from '@mui/material';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import PasswordDialog from '../../components/PasswordDialog';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { PinCodeHelper, WalletsHelper, Wallet } from '../../lib/storage';
import { MnemonicHelper } from '../../lib/mnemonic';
import { findNextAccountIndex } from '../../lib/nextAccount';
import heroNewLarge from '../../assets/heroimage_new_large.png';

export default function WalletCreationName() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [walletName, setWalletName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [pinMode, setPinMode] = useState<'check' | 'register'>('check');

  // Finds a wallet whose recovery phrase can actually be recovered with the PIN just
  // entered (see onPinReady) *and* is a well-formed BIP39 phrase once decrypted. A
  // wallet's `hasMnemonic()` only tells us it has an encryptedMnemonic blob - it says
  // nothing about which password that blob was encrypted with. The still-encrypted-with-
  // AES-GCM check below guards against a wrong PIN either way, but the isValid() check
  // stays as defense in depth against the rare case of a corrupted-but-still-authenticating
  // legacy (pre-AES-GCM) blob decrypting to non-BIP39 bytes.
  const findReusablePhrase = async (wallets: Wallet[], pin: string): Promise<string | null> => {
    for (const wallet of wallets) {
      if (!wallet.hasMnemonic()) {
        continue;
      }
      const phrase = await WalletsHelper.decryptMnemonic(wallet.id, pin);
      if (phrase != null && MnemonicHelper.isValid(phrase)) {
        return phrase;
      }
    }
    return null;
  };

  const persistAndContinue = async (
    address: string,
    publicKey: string,
    privateKey: string,
    phrase: string,
    // Skip showing the recovery-phrase backup screen when reusing an already-backed-up
    // phrase - there's nothing new for the person to write down in that case.
    skipMnemonicScreen: boolean,
    pin: string,
    derivationIndex: number,
  ) => {
    const wallet = await WalletsHelper.createWithMnemonic(
      walletName,
      address,
      publicKey,
      privateKey,
      phrase,
      pin
    );
    wallet.derivationIndex = derivationIndex;
    await WalletsHelper.add(wallet);
    await WalletsHelper.setActive(wallet.id);
    // `pin` is passed along via router state (not the URL) so WalletCreationMnemonic can
    // decrypt this wallet's freshly-generated phrase with it directly, instead of prompting
    // for the PIN a third time - by spec, the person only ever enters/confirms the PIN
    // twice per wallet-creation/login flow (see PasswordDialog's register mode above); nothing
    // afterward should ask again.
    navigate(
      skipMnemonicScreen ? '/wallet/creation/new' : `/wallet/creation/mnemonic?id=${wallet.id}`,
      skipMnemonicScreen ? undefined : { state: { pin } },
    );
  };

  // Called once a PIN has been verified (mode="check", an existing PIN) or freshly set
  // (mode="register", no PIN existed yet) - see createWallet. Either way `pin` is the
  // real PIN protecting this device's wallets, so it's what every new wallet's secret
  // gets encrypted with, and what's used to try decrypting an existing recovery phrase
  // to reuse (deriving the next BIP44 account index) instead of generating a new one.
  const onPinReady = async (pin: string) => {
    try {
      const allWallets = await WalletsHelper.gets();
      const phrase = await findReusablePhrase(allWallets, pin);

      if (phrase != null) {
        const nextIndex = findNextAccountIndex(phrase, allWallets);
        const account = MnemonicHelper.accountFromMnemonic(phrase, nextIndex);
        await persistAndContinue(account.address, account.publicKey, account.privateKey, phrase, true, pin, nextIndex);
        return;
      }

      // No existing wallet has a recovery phrase we can decrypt with this PIN (either
      // this is the very first wallet, or every existing one is a private-key-only
      // import with no phrase at all) - fall back to generating a brand new phrase, same
      // as before. This IS a new phrase, so it still needs to be shown/confirmed for
      // backup.
      const { phrase: newPhrase, account } = MnemonicHelper.createNew();
      await persistAndContinue(account.address, account.publicKey, account.privateKey, newPhrase, false, pin, 0);
    } catch (e) {
      // Never let an unexpected error leave the OK button looking like it did nothing.
      setErrorMessage(t('wallet.creation_failed'));
    } finally {
      setShowPasswordDialog(false);
    }
  };

  const createWallet = async () => {
    // No PIN protecting this device yet - force setting one now (mode="register") rather
    // than silently falling back to encrypting the new wallet with a fixed default PIN.
    // If a PIN already exists, just confirm it (mode="check") before using it.
    setPinMode((await PinCodeHelper.hasSavedCode()) ? 'check' : 'register');
    setShowPasswordDialog(true);
  };

  return (
    <div>
      <AppToolBar back="/wallet/creation/type" title={t('wallet.name_title')} />
      <Box component="img" src={heroNewLarge} sx={{ width: '100%' }} />
      <Box sx={{ px: 2 }}>
        <Typography align="center">
          {t('wallet.name_message_0')}<br />{t('wallet.name_message_1')}<br />{t('wallet.name_message_2')}
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <TextField
            id="walletName"
            label={t('wallet.name_input')}
            value={walletName}
            onChange={(e) => setWalletName(e.target.value)}
            sx={{ width: '66%' }}
          />
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 2 }}>
          <Button variant="contained" color="primary" disabled={walletName.length === 0} onClick={createWallet}>OK</Button>
        </Box>

        <Typography align="center" variant="caption" sx={{ display: 'block', mt: 4 }}>
          {t('common.privacy_policy_caution')}<br />
          <MuiLink component={Link} to="/" underline="always">{t('common.privacy_policy')}</MuiLink>
        </Typography>
      </Box>
      <PasswordDialog
        open={showPasswordDialog}
        mode={pinMode}
        // Left as a no-op deliberately: PasswordDialog calls onClose() on every successful
        // round *and* on a genuine cancel (see its cancel()/closeView() internals), and
        // onPass (below) already fires right alongside it on success. If onClose also hid
        // this dialog immediately, it would close the instant the PIN is confirmed - i.e.
        // right before onPinReady's several awaited storage calls (create/add/setActive/
        // unlock) run - exposing this wallet-naming screen underneath for that whole
        // stretch, until navigate() at the end of onPinReady finally swaps the route. Only
        // a genuine cancel (onCancel below) should actually dismiss the dialog; a
        // successful PIN entry should stay covered by it right up until the next screen
        // takes over.
        onClose={() => {}}
        onCancel={() => setShowPasswordDialog(false)}
        onPass={onPinReady}
      />
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </div>
  );
}
