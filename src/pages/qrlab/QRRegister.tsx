import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Card, Typography, Button, IconButton, Avatar, Menu,
  List, ListItem, ListItemText, MenuItem, Divider, CircularProgress, Dialog, DialogTitle, DialogContent,
  DialogActions, LinearProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import DownloadIcon from '@mui/icons-material/Download';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Scanner } from '@yudiel/react-qr-scanner';
import { QRCodeCanvas } from 'qrcode.react';
import { Decimal } from 'decimal.js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import { ProductsHelper, SalesHelper, InsufficientStockError, WalletsHelper, PendingCheckoutsHelper } from '../../lib/storage';
import type { ProductRecord } from '../../lib/storage';
import { parseProductTag } from '../../lib/productTag';
import { CHAINS, getUsdcTokenInfo } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { CHAIN_ICONS } from '../../lib/chainIcons';
import { buildJpycPaymentUri } from '../../lib/jpycPayment';
import { useJpycPaymentWatcher } from '../../hooks/useJpycPaymentWatcher';
import PaymentReceivedBanner from '../../components/PaymentReceivedBanner';
import type { WatchedToken } from '../../hooks/useJpycPaymentWatcher';
import { downloadPaymentReceiptImage } from '../../lib/paymentReceiptImage';
import { useAppStore } from '../../store/appStore';

const CHAIN_KEYS = Object.keys(CHAINS) as ChainKey[];
type RegisterCurrency = 'JPY' | 'USD';

// One row in the register's running cart. `productId` is set for anything scanned or picked
// from 売り物リスト (so checkout can decrement its stock via SalesHelper.sell); it's null for
// a manually-entered "その他" amount that isn't tracked as inventory (SalesHelper.sellMisc).
interface CartLine {
  key: string;
  productId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
}

type Phase = 'cart' | 'waiting' | 'done';

/**
 * QRレジスター: turns the phone/tablet into a register by scanning each item's QR tag (see
 * MarketplaceDetail's QRコード button / lib/productTag.ts) to add it to a running cart —
 * same idea as a barcode scanner at a real checkout counter — then generates a single JPYC
 * payment QR for the total and watches for it, exactly like 売り物リスト's own 会計 flow
 * (MarketplaceCollect). Deliberately shares that flow's payment plumbing (jpycPayment.ts,
 * useJpycPaymentWatcher) and inventory plumbing (ProductsHelper/SalesHelper) rather than
 * re-implementing either, since the two features are really the same "手動会計" idea with
 * two different ways of building up what's being sold — one item at a time from a fixed
 * product list, or as a scanned/mixed cart.
 *
 * Once a payment QR has been generated, the checkout is persisted as a PendingCheckoutRecord
 * (lib/storage.ts) so leaving this screen — via the toolbar's back arrow, the browser/PWA
 * back gesture, or just switching tabs — does NOT cancel it. It shows up in 入金待ち一覧
 * (QRRegisterPending.tsx) and can be reopened from there (via ?pendingId=) to keep checking
 * for payment, exactly where it left off. Only the explicit "Cancel" button actually
 * cancels a checkout.
 */
export default function QRRegister() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeChain = useAppStore((s) => s.activeChain);
  const displayCurrency = useAppStore((s) => s.displayCurrency);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [chain, setChain] = useState<ChainKey>(activeChain as ChainKey);
  const [address, setAddress] = useState('');
  const [phase, setPhase] = useState<Phase>('cart');
  const [errorMessage, setErrorMessage] = useState('');
  // null while still building the cart - the register just follows 設定 > 表示通貨 live (see
  // `currency` below) so switching it updates the cart-phase preview immediately. Set once a
  // checkout is proceeded to (or resumed from a PendingCheckoutRecord) so the payment QR/
  // watcher/receipt keep using the same token even if 表示通貨 is changed again afterwards.
  const [frozenCurrency, setFrozenCurrency] = useState<RegisterCurrency | null>(null);
  const currency: RegisterCurrency = frozenCurrency ?? displayCurrency;
  // USDC token info for `chain`, when currency is USD - undefined (JPYC default) otherwise,
  // or if this chain has no known USDC contract (e.g. debug/testnet mode).
  const usdcInfo = currency === 'USD' ? getUsdcTokenInfo(chain) : undefined;
  const watchedToken: WatchedToken | undefined = usdcInfo
    ? { address: usdcInfo.address, decimals: usdcInfo.decimals, symbol: usdcInfo.symbol }
    : undefined;
  const currencyUnit = usdcInfo ? usdcInfo.symbol : t('marketplace.price_unit');

  // Anchor for the chain-picker menu below - same tappable-pill-plus-Menu pattern SwapTop/
  // QRGeneratorAmount use for their own chain selectors, in place of the old
  // ToggleButtonGroup row.
  const [chainMenuAnchor, setChainMenuAnchor] = useState<null | HTMLElement>(null);

  const [scanning, setScanning] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerProducts, setPickerProducts] = useState<ProductRecord[]>([]);

  const [manualConfirmOpen, setManualConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  // Set once this checkout's payment QR has been generated and saved as a
  // PendingCheckoutRecord (or loaded back from one via ?pendingId=) - see the class doc
  // comment above. Non-null exactly while there's a persisted record to keep in sync/clean
  // up (removed once the sale finalizes or is explicitly cancelled).
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Set by the ?pendingId= resume path once the record's chain/cart/address are loaded, to
  // hand its saved starting block to useJpycPaymentWatcher on the next render — see the
  // effect below for why this can't just call startWatching() immediately inline.
  const [resumeStartBlock, setResumeStartBlock] = useState<number | null>(null);

  // Dedupes rapid-fire re-decodes of the same still-visible QR code (the camera reports a
  // fresh onScan roughly every frame while a tag stays in view) so holding a tag up for a
  // second doesn't silently add a dozen units of it.
  const lastScanRef = useRef<{ value: string; time: number } | null>(null);
  const finalizingRef = useRef(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  // Runs once on mount: reads the active wallet's address, and if we were opened as
  // /qrlab/register?pendingId=... (from 入金待ち一覧), loads that checkout's saved cart/
  // chain/address and jumps straight to the waiting screen instead of starting a fresh cart.
  useEffect(() => {
    (async () => {
      const wallet = await WalletsHelper.getActive();
      setAddress(wallet?.address ?? '');

      const resumeId = searchParams.get('pendingId');
      if (!resumeId) return;
      const record = await PendingCheckoutsHelper.get(resumeId);
      if (!record) {
        setErrorMessage(t('register.pending_not_found'));
        return;
      }
      setCart(record.cart);
      setChain(record.chain as ChainKey);
      setAddress(record.address);
      setFrozenCurrency(record.currency ?? 'JPY');
      setPendingId(record.id);
      setResumeStartBlock(record.startBlock);
      setPhase('waiting');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = cart.reduce((sum, line) => sum.add(new Decimal(line.unitPrice).mul(line.quantity)), new Decimal(0));

  const addProductToCart = useCallback((product: ProductRecord) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.productId === product.id);
      const currentQty = idx >= 0 ? prev[idx].quantity : 0;
      if (currentQty + 1 > product.stock) {
        setErrorMessage(t('marketplace.insufficient_stock'));
        return prev;
      }
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { key: `p:${product.id}`, productId: product.id, name: product.name, unitPrice: product.price, quantity: 1 }];
    });
  }, [t]);

  const onOpenScanner = () => {
    lastScanRef.current = null;
    setScanning(true);
  };

  const onDecode = async (decodedString: string) => {
    const now = Date.now();
    if (lastScanRef.current && lastScanRef.current.value === decodedString && now - lastScanRef.current.time < 1500) {
      return;
    }
    lastScanRef.current = { value: decodedString, time: now };

    const productId = parseProductTag(decodedString);
    if (!productId) {
      setErrorMessage(t('register.unsupported_qr'));
      return;
    }
    const product = await ProductsHelper.get(productId);
    if (!product) {
      setErrorMessage(t('register.product_not_found_for_tag'));
      return;
    }
    addProductToCart(product);
  };

  const onScanError = (error: unknown) => {
    setErrorMessage('Camera is not available: ' + (error instanceof Error ? error.message : 'Unknown'));
  };

  const onOpenPicker = async () => {
    setPickerProducts(await ProductsHelper.list());
    setPickerOpen(true);
  };

  const onChangeQuantity = (key: string, delta: number) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx < 0) return prev;
      const line = prev[idx];
      const nextQty = line.quantity + delta;
      if (nextQty <= 0) {
        return prev.filter((l) => l.key !== key);
      }
      const next = prev.slice();
      next[idx] = { ...line, quantity: nextQty };
      return next;
    });
  };

  const onRemoveLine = (key: string) => {
    setCart((prev) => prev.filter((l) => l.key !== key));
  };

  const finalizeSale = useCallback(async (note: string) => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    const failedNames: string[] = [];
    for (const line of cart) {
      try {
        if (line.productId) {
          await SalesHelper.sell(line.productId, line.quantity, note);
        } else {
          await SalesHelper.sellMisc(line.name, line.unitPrice, line.quantity, note);
        }
      } catch (e) {
        if (e instanceof InsufficientStockError) {
          failedNames.push(line.name);
        } else {
          console.error('Failed to record register sale line', line, e);
          failedNames.push(line.name);
        }
      }
    }
    if (failedNames.length > 0) {
      setErrorMessage(t('register.sell_failed_message', { names: failedNames.join(', ') }));
    }
    setPendingId((id) => {
      if (id) PendingCheckoutsHelper.remove(id);
      return null;
    });
    setPhase('done');
  }, [cart, t]);

  const { receivedAmount, pollError, jpycDecimals, startWatching } = useJpycPaymentWatcher(
    chain,
    address,
    total,
    phase === 'waiting',
    () => finalizeSale(t('marketplace.payment_detected_message')),
    watchedToken,
  );

  // Resumes watching a checkout reopened from 入金待ち一覧, once its chain/address have been
  // loaded into state by the mount effect above and reflected in this render (startWatching
  // is bound to the `chain` this render was called with, so this can't run any earlier -
  // calling it directly from that effect would still be using the *previous* render's chain).
  useEffect(() => {
    if (resumeStartBlock === null) return;
    startWatching(resumeStartBlock);
    setResumeStartBlock(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeStartBlock, chain]);

  const onProceedToCheckout = async () => {
    if (cart.length === 0 || total.lessThanOrEqualTo(0)) {
      setErrorMessage(t('register.cart_is_empty_error'));
      return;
    }
    const checkoutCurrency = currency;
    setFrozenCurrency(checkoutCurrency);
    const startBlock = await startWatching();
    const record = await PendingCheckoutsHelper.add({ chain, address, total: total.toString(), startBlock, cart, currency: checkoutCurrency });
    setPendingId(record.id);
    setPhase('waiting');
  };

  const onManualComplete = () => {
    finalizeSale(t('marketplace.complete_manually'));
    setManualConfirmOpen(false);
  };

  const onBackToCart = async () => {
    if (pendingId) {
      await PendingCheckoutsHelper.remove(pendingId);
      setPendingId(null);
    }
    navigate('/qrlab/register', { replace: true });
    setFrozenCurrency(null);
    setPhase('cart');
  };

  const onConfirmCancelCheckout = async () => {
    setCancelConfirmOpen(false);
    if (pendingId) {
      await PendingCheckoutsHelper.remove(pendingId);
      setPendingId(null);
    }
    navigate('/qrlab/register', { replace: true });
    setCart([]);
    setFrozenCurrency(null);
    setPhase('cart');
  };

  const onStartNewSale = () => {
    finalizingRef.current = false;
    navigate('/qrlab/register', { replace: true });
    setCart([]);
    setFrozenCurrency(null);
    setPhase('cart');
  };

  const onDownloadReceipt = () => {
    if (!qrCanvasRef.current) return;
    downloadPaymentReceiptImage({
      qrCanvas: qrCanvasRef.current,
      title: t('register.receipt_title'),
      totalLabel: `${total.toString()} ${currencyUnit}`,
      chainLabel: CHAINS[chain].name,
      addressLabel: t('register.receipt_address_label'),
      address,
      itemsLabel: t('register.receipt_items_label'),
      itemLines: cart.map((line) => `${line.name} × ${line.quantity} = ${(line.unitPrice * line.quantity).toLocaleString()} ${currencyUnit}`),
    });
  };

  return (
    <Box>
      <AppToolBar back="/top?tab=qrlab" title={t('register.title')} />

      <Box sx={{ p: 2 }}>
        {phase === 'cart' && (
          <>
            {/* 3つの操作ボタンを1行に(アイコン上・文字下のコンパクト形式) */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mb: 2 }}>
              <Button
                variant="contained"
                onClick={onOpenScanner}
                sx={{ flexDirection: 'column', gap: 0.5, py: 1, px: 0.5, fontSize: 12, lineHeight: 1.3 }}
              >
                <QrCodeScannerIcon />
                {t('register.scan_button')}
              </Button>
              <Button
                variant="outlined"
                onClick={onOpenPicker}
                sx={{ flexDirection: 'column', gap: 0.5, py: 1, px: 0.5, fontSize: 12, lineHeight: 1.3 }}
              >
                <PlaylistAddIcon />
                {t('register.add_from_list')}
              </Button>
              <Button
                variant="outlined"
                onClick={() => navigate('/qrlab/register/pending')}
                sx={{ flexDirection: 'column', gap: 0.5, py: 1, px: 0.5, fontSize: 12, lineHeight: 1.3 }}
              >
                <HourglassTopIcon />
                {t('register.pending_view')}
              </Button>
            </Box>

            {scanning && (
              <Card sx={{ mb: 2, overflow: 'hidden' }}>
                <Scanner
                  onScan={(results) => { if (results[0]) onDecode(results[0].rawValue); }}
                  onError={onScanError}
                />
                <Button fullWidth onClick={() => setScanning(false)}>{t('register.close_scan')}</Button>
              </Card>
            )}

            {cart.length === 0 ? (
              <Typography align="center" color="text.secondary" sx={{ mt: 4, mb: 4 }}>
                {t('register.cart_empty_message')}
              </Typography>
            ) : (
              <Card sx={{ mb: 2 }}>
                <List sx={{ py: 0 }}>
                  {cart.map((line, i) => (
                    <Box key={line.key}>
                      <ListItem
                        secondaryAction={
                          <IconButton edge="end" aria-label={t('common.delete')} onClick={() => onRemoveLine(line.key)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        }
                      >
                        <ListItemText
                          primary={line.name}
                          secondary={`${line.unitPrice.toLocaleString()} ${currencyUnit} × ${line.quantity} = ${(line.unitPrice * line.quantity).toLocaleString()} ${currencyUnit}`}
                        />
                        <IconButton size="small" onClick={() => onChangeQuantity(line.key, -1)}>
                          <RemoveIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={() => onChangeQuantity(line.key, 1)}>
                          <AddIcon fontSize="small" />
                        </IconButton>
                      </ListItem>
                      {i < cart.length - 1 && <Divider />}
                    </Box>
                  ))}
                </List>
              </Card>
            )}

            <Typography sx={{ fontSize: 'x-large', fontWeight: 'bold', textAlign: 'right' }}>
              {t('register.total_label')}: {total.toString()} {currencyUnit}
            </Typography>

            {/* 受け取りチェーン(コンパクトなピル)と会計ボタンを1行に */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mt: 2 }}>
              <Box
                onClick={(e) => setChainMenuAnchor(e.currentTarget)}
                aria-label={t('marketplace.collect_chain_label')}
                sx={{
                  bgcolor: 'grey.100', borderRadius: 6, pl: 1, pr: 1.5, height: 44, cursor: 'pointer', minWidth: 0,
                  display: 'inline-flex', alignItems: 'center', gap: 1,
                }}
              >
                <Avatar src={CHAIN_ICONS[chain]} sx={{ width: 28, height: 28 }} />
                <Typography noWrap sx={{ fontWeight: 'bold' }}>{CHAINS[chain].name}</Typography>
                <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              </Box>
              <Button
                variant="contained"
                sx={{ flexShrink: 0, px: 3, height: 44 }}
                disabled={cart.length === 0}
                onClick={onProceedToCheckout}
              >
                {t('register.proceed_to_checkout')}
              </Button>
            </Box>
            <Menu anchorEl={chainMenuAnchor} open={!!chainMenuAnchor} onClose={() => setChainMenuAnchor(null)}>
              {CHAIN_KEYS.map((key) => (
                <MenuItem
                  key={key}
                  selected={key === chain}
                  onClick={() => { setChain(key); setChainMenuAnchor(null); }}
                >
                  <Avatar src={CHAIN_ICONS[key]} sx={{ width: 24, height: 24, mr: 1.5 }} />
                  {CHAINS[key].name}
                </MenuItem>
              ))}
            </Menu>

          </>
        )}

        {phase === 'waiting' && (
          <Card sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <QRCodeCanvas ref={qrCanvasRef} value={buildJpycPaymentUri(chain, address, total, jpycDecimals, usdcInfo?.address)} size={200} />
              <Typography sx={{ mt: 2, color: 'text.secondary', fontSize: 12, textAlign: 'center' }}>
                {t('marketplace.qr_hint')}
              </Typography>

              <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadIcon />}
                sx={{ mt: 2 }}
                onClick={onDownloadReceipt}
              >
                {t('register.download_qr')}
              </Button>

              <Typography sx={{ mt: 3, fontSize: 'x-large', fontWeight: 'bold' }}>
                {total.toString()} {currencyUnit}
              </Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>{CHAINS[chain].name}</Typography>
              <Typography align="center" sx={{ wordBreak: 'break-all', mx: 2, mt: 1, fontSize: 12 }}>{address}</Typography>

              <Box sx={{ width: '100%', mt: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('marketplace.received_amount_label')}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('marketplace.required_amount_label')}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography sx={{ fontSize: 'large' }}>{receivedAmount.toString()}</Typography>
                  <Typography sx={{ fontSize: 'large' }}>{total.toString()}</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, total.greaterThan(0) ? receivedAmount.div(total).mul(100).toNumber() : 0)}
                />
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
                <CircularProgress size={16} />
                <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>{t('marketplace.waiting_for_payment')}</Typography>
              </Box>
              {pollError && (
                <Typography sx={{ fontSize: 12, color: 'error.main', mt: 1 }}>{t('marketplace.poll_error')}</Typography>
              )}
            </Box>

            <Button variant="text" fullWidth sx={{ mt: 2 }} onClick={onBackToCart}>
              {t('register.back_to_cart')}
            </Button>
            <Button variant="outlined" fullWidth sx={{ mt: 1 }} onClick={() => setManualConfirmOpen(true)}>
              {t('marketplace.complete_manually')}
            </Button>
            <Button variant="text" color="error" fullWidth sx={{ mt: 1 }} onClick={() => setCancelConfirmOpen(true)}>
              {t('common.cancel')}
            </Button>
          </Card>
        )}

        {phase === 'done' && (
          <Card sx={{ p: 3, textAlign: 'center' }}>
            <PaymentReceivedBanner />
            <Typography sx={{ fontSize: 'large', fontWeight: 'bold', mb: 1 }}>
              {total.toString()} {currencyUnit}
            </Typography>
            <Typography color="text.secondary">{t('register.done_message')}</Typography>
            <Button variant="contained" fullWidth sx={{ mt: 3 }} onClick={onStartNewSale}>
              {t('register.start_new_sale')}
            </Button>
            <Button variant="text" fullWidth sx={{ mt: 1 }} onClick={() => navigate('/top?tab=qrlab')}>
              {t('register.back_to_qrlab')}
            </Button>
          </Card>
        )}
      </Box>

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} fullWidth>
        <DialogTitle>{t('register.add_from_list')}</DialogTitle>
        <DialogContent>
          {pickerProducts.length === 0 ? (
            <Typography color="text.secondary">{t('register.add_from_list_empty')}</Typography>
          ) : (
            <List sx={{ py: 0 }}>
              {pickerProducts.map((product, i) => (
                <Box key={product.id}>
                  <ListItem
                    component="div"
                    onClick={() => addProductToCart(product)}
                    sx={{ cursor: 'pointer' }}
                    secondaryAction={<AddIcon color="primary" />}
                  >
                    <ListItemText
                      primary={product.name}
                      secondary={`${product.price.toLocaleString()} ${currencyUnit} ・ ${t('marketplace.stock')}: ${product.stock}${t('marketplace.stock_unit')}`}
                    />
                  </ListItem>
                  {i < pickerProducts.length - 1 && <Divider />}
                </Box>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickerOpen(false)}>{t('common.done')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={manualConfirmOpen} onClose={() => setManualConfirmOpen(false)}>
        <DialogTitle sx={{ whiteSpace: 'pre-line' }}>{t('marketplace.complete_manually_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setManualConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={onManualComplete} variant="contained">{t('marketplace.complete_manually')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={cancelConfirmOpen} onClose={() => setCancelConfirmOpen(false)}>
        <DialogTitle sx={{ whiteSpace: 'pre-line' }}>{t('register.cancel_confirm')}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setCancelConfirmOpen(false)}>{t('marketplace.keep_waiting')}</Button>
          <Button onClick={onConfirmCancelCheckout} color="error">{t('register.confirm_cancel')}</Button>
        </DialogActions>
      </Dialog>

      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
