import { useRef, useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ethers } from 'ethers';
import { useAppStore } from '../../store/appStore';
import { InvoiceData } from '../../lib/invoiceData';
import { parseEip681PaymentUri } from '../../lib/jpycPayment';
import { CHAINS, getJpycDecimals, fetchTokenMetadata } from '../../lib/chains';
import ErrorSnackbar from '../../components/ErrorSnackbar';

interface ScanProps {
  isActive: boolean;
}

// Ported from src/components/pages/top/Scan.vue.
export default function Scan({ isActive }: ScanProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const activeChain = useAppStore((s) => s.activeChain);
  const setActiveChain = useAppStore((s) => s.setActiveChain);
  const setReceiverAddress = useAppStore((s) => s.setReceiverAddress);
  const setSendCurrency = useAppStore((s) => s.setSendCurrency);
  const setSendTokenMeta = useAppStore((s) => s.setSendTokenMeta);
  const setSendCustomChainId = useAppStore((s) => s.setSendCustomChainId);
  const setCalculatorFormula = useAppStore((s) => s.setCalculatorFormula);
  const setCalculatorValue = useAppStore((s) => s.setCalculatorValue);
  const [errorMessage, setErrorMessage] = useState('');
  // Guards against the scanner firing onDecode again (e.g. a second camera frame of the
  // same code) while an earlier decode is still awaiting an RPC call below.
  const processingRef = useRef(false);

  const onDecode = async (decodedString: string) => {
    if (processingRef.current) return;
    // Every path below (legacy invoice, EIP-681 request, bare address) only ever resolves
    // to one of CHAINS's curated chains - none of them can express a hand-added 設定 >
    // カスタムEVM network - so any leftover custom-chain selection from a previous visit to
    // SendAmount is cleared up front rather than silently carrying over into this scan.
    setSendCustomChainId(null);

    // A legacy invoice QR (lib/invoiceData.ts's JSON format) carries both the recipient
    // address and a requested JPYC amount — when recognized, prefill both on the Send
    // screen instead of just the address, so scanning someone else's invoice takes you
    // straight to a ready-to-confirm send.
    const invoice = InvoiceData.fromJsonString(decodedString);
    if (invoice !== null && ethers.isAddress(invoice.address)) {
      setReceiverAddress(invoice.address);
      if (invoice.amount > 0) {
        setSendCurrency('jpyc');
        setCalculatorFormula(String(invoice.amount));
        setCalculatorValue(invoice.amount);
      }
      navigate('/send/amount');
      return;
    }

    // Otherwise, try to parse it as an EIP-681 payment request URI - the format the app's
    // own JPYC-collection screens (MarketplaceCollect, QRGeneratorCollect, QRRegister,
    // Receive) generate via buildJpycPaymentUri, and the same format other EVM wallets
    // (MetaMask, etc.) use for "request payment" QR codes. This carries the amount and
    // chain along with the address, unlike a bare address.
    const parsed = parseEip681PaymentUri(decodedString);
    if (parsed !== null) {
      processingRef.current = true;
      try {
        const chain = parsed.chain ?? activeChain;
        if (parsed.chain && parsed.chain !== activeChain) setActiveChain(parsed.chain);
        setReceiverAddress(parsed.recipientAddress);

        if (parsed.rawAmount === null) {
          // Address-only payment request (no amount encoded) - same as a bare address scan.
          navigate('/send/amount');
          return;
        }

        if (parsed.isNative) {
          setSendCurrency('native');
          const amount = Number(ethers.formatUnits(parsed.rawAmount, CHAINS[chain].nativeCurrency.decimals));
          setCalculatorFormula(String(amount));
          setCalculatorValue(amount);
        } else if (parsed.tokenAddress) {
          const isJpyc = parsed.tokenAddress.toLowerCase() === CHAINS[chain].jpycAddress.toLowerCase();
          let decimals: number;
          if (isJpyc) {
            setSendCurrency('jpyc');
            setSendTokenMeta(null);
            decimals = await getJpycDecimals(chain);
          } else {
            const meta = await fetchTokenMetadata(chain, parsed.tokenAddress);
            setSendCurrency(meta.address);
            setSendTokenMeta({ address: meta.address, symbol: meta.symbol, decimals: meta.decimals });
            decimals = meta.decimals;
          }
          const amount = Number(ethers.formatUnits(parsed.rawAmount, decimals));
          setCalculatorFormula(String(amount));
          setCalculatorValue(amount);
        }

        navigate('/send/amount');
      } catch (e) {
        console.error('Failed to resolve scanned payment request, falling back to address only', e);
        setReceiverAddress(parsed.recipientAddress);
        navigate('/send/amount');
      } finally {
        processingRef.current = false;
      }
      return;
    }

    // Last resort: accept a bare EVM address (or any string with one embedded in it).
    const match = decodedString.match(/0x[a-fA-F0-9]{40}/);
    const address = match ? match[0] : decodedString.trim();

    if (!ethers.isAddress(address)) {
      setErrorMessage(t('common.invalid_address'));
      return;
    }

    setReceiverAddress(address);
    navigate('/send/amount');
  };

  const onError = (error: unknown) => {
    setErrorMessage('Camera is not available: ' + (error instanceof Error ? error.message : 'Unknown'));
  };

  if (!isActive) {
    return null;
  }

  return (
    <>
      <Scanner
        onScan={(results) => { if (results[0]) void onDecode(results[0].rawValue); }}
        onError={onError}
      />
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </>
  );
}
