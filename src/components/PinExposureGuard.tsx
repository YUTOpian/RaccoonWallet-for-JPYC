import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { WalletsHelper, PinCodeHelper } from '../lib/storage';

// The one screen this guard must never redirect away from - it's where the exposure it
// detects actually gets fixed. Every other route is fair game to redirect from.
const PIN_REQUIRED_PATH = '/wallet/pin-required';

/**
 * Since the fix in WalletCreationName.tsx/LessonBeginner.tsx, no *new* wallet is ever
 * created without a real PIN already confirmed - PinCodeHelper.defaultPin (a fixed,
 * publicly-known placeholder baked into the shipped source) is only ever used to migrate
 * a wallet left over from an older build that still predates that fix.
 *
 * But until now, that migration only happened if the person happened to land on a screen
 * that offers to set a PIN (Settings, the beginner lesson's backup-end screen, etc.) -
 * nothing stopped them from using the app itself (viewing balances, generating a receive
 * QR, ...) with that wallet still sitting behind the known constant. This guard closes
 * that gap at the routing layer: on every navigation, it checks whether the active wallet
 * has no real PIN behind it yet and, if so, redirects to a dedicated screen that forces
 * PIN registration (see WalletPinRequired.tsx) before letting the person reach anything
 * else, no matter which URL they land on.
 *
 * Deliberately fails open (renders children) on a storage read error - this is a
 * defense-in-depth backstop for a state that normal usage no longer produces, not the
 * only thing standing between an attacker and the wallet, so a transient storage glitch
 * shouldn't lock the person out of their own app.
 */
export default function PinExposureGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [exposed, setExposed] = useState(false);

  useEffect(() => {
    if (location.pathname === PIN_REQUIRED_PATH) {
      // Already headed to the fix - nothing to detect or redirect here.
      setExposed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [activeWallet, hasSavedCode] = await Promise.all([
          WalletsHelper.getActive(),
          PinCodeHelper.hasSavedCode(),
        ]);
        if (!cancelled) {
          // 外部ウォレット(MetaMask/Bitget)は端末に秘密情報が無いので PIN 不要。
          setExposed(activeWallet != null && !activeWallet.externalProvider && !hasSavedCode);
        }
      } catch (e) {
        console.error('PinExposureGuard: failed to check wallet/PIN state', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (exposed) {
    return <Navigate to={PIN_REQUIRED_PATH} replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
