import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControlLabel, IconButton, Paper, TextField, Typography,
} from '@mui/material';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { Scanner } from '@yudiel/react-qr-scanner';
import { ethers } from 'ethers';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import PasswordDialog from '../../components/PasswordDialog';
import { AddressChunks } from '../../components/AddressSafetyBlock';
import { CHAINS, extractRpcMessage, getGasOverrides, getProvider } from '../../lib/chains';
import { parseTxParams, summarizeTx } from '../../lib/dappTx';
import type { DappTxParams, TxSummary } from '../../lib/dappTx';
import { chainTargetFromKey, getExternalSigner, isExternalWalletError } from '../../lib/externalWallet';
import { trackTxForNfts } from '../../lib/nfts';
import { unlockSounds, playSentSound } from '../../lib/sounds';
import { WalletsHelper } from '../../lib/storage';
import type { Wallet as WalletRecord } from '../../lib/storage';
import {
  approveProposal, buildNamespacesFor, chainFromCaip, disconnectSession, getWalletKit,
  isWalletConnectConfigured, isWalletConnectOriginUsable, listSessions, onSessionsChanged,
  pairWithUri, rejectProposal, respondFailure, respondResult, respondSdkError,
} from '../../lib/walletConnect';
import type { DappSession, SdkErrorKey, SupportedChain } from '../../lib/walletConnect';
import { notify } from '../../store/notificationStore';
import { useDappStore } from '../../store/dappStore';
import type { DappRequestView, DappValidation } from '../../store/dappStore';

const column = { width: '100%', maxWidth: 560, mx: 'auto', px: 2, boxSizing: 'border-box' } as const;
const labelSx = { color: 'text.secondary', fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.04em' } as const;

// ------------------------------------------------------------------ 接続元の表示

function OriginBlock({ name, url, validation, isScam }: { name: string; url: string; validation: DappValidation; isScam: boolean }) {
  const { t } = useTranslation();
  const blocked = isScam || validation === 'INVALID';
  return (
    <Box>
      <Typography sx={labelSx}>{t('dapp.site')}</Typography>
      <Typography sx={{ mt: 0.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{name || '—'}</Typography>
      <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', overflowWrap: 'anywhere' }}>{url}</Typography>
      <Box sx={{ mt: 1 }}>
        {isScam ? (
          <Chip size="small" color="error" label={t('dapp.verify_scam')} />
        ) : validation === 'VALID' ? (
          <Chip size="small" color="success" label={t('dapp.verify_valid')} />
        ) : validation === 'INVALID' ? (
          <Chip size="small" color="error" label={t('dapp.verify_invalid')} />
        ) : (
          <Chip size="small" color="warning" label={t('dapp.verify_unknown')} />
        )}
      </Box>
      {blocked && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {isScam ? t('dapp.verify_scam_body') : t('dapp.verify_invalid_body')}
        </Alert>
      )}
      {!blocked && validation === 'UNKNOWN' && (
        <Alert severity="warning" sx={{ mt: 1 }}>{t('dapp.verify_unknown_body')}</Alert>
      )}
    </Box>
  );
}

// ------------------------------------------------------------------ リクエストの振り分け

type Classified =
  | { type: 'auto_result'; result: null }
  | { type: 'auto_reject'; key: SdkErrorKey; noteKey?: string }
  | { type: 'tx'; chain: SupportedChain; tx: DappTxParams; summary: TxSummary }
  | { type: 'sign'; chain: SupportedChain; bytes: Uint8Array; text: string | null };

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function classifyRequest(req: DappRequestView, walletAddress: string): Classified {
  if (req.method === 'wallet_switchEthereumChain') {
    // 接続時に対応チェーンをすべて承認済みなので、対応しているチェーンなら画面を出さずに成功を返す。
    try {
      const first = (Array.isArray(req.params) ? req.params[0] : null) as { chainId?: string } | null;
      const id = first?.chainId ? Number(BigInt(first.chainId)) : NaN;
      return chainFromCaip(`eip155:${id}`) ? { type: 'auto_result', result: null } : { type: 'auto_reject', key: 'UNSUPPORTED_CHAINS' };
    } catch {
      return { type: 'auto_reject', key: 'UNSUPPORTED_CHAINS' };
    }
  }

  const chain = chainFromCaip(req.chainId);

  if (req.method === 'personal_sign') {
    if (!chain) return { type: 'auto_reject', key: 'UNSUPPORTED_CHAINS' };
    const p = Array.isArray(req.params) ? (req.params as unknown[]) : [];
    const a = typeof p[0] === 'string' ? p[0] : '';
    const b = typeof p[1] === 'string' ? p[1] : '';
    // 標準は [メッセージ, アドレス]。引数の順が逆の古い dApp にも対応する。
    const [message, signerAddress] = ethers.isAddress(a) && !ethers.isAddress(b) ? [b, a] : [a, b];
    if (!ethers.isAddress(signerAddress) || !sameAddress(signerAddress, walletAddress)) {
      return { type: 'auto_reject', key: 'UNSUPPORTED_ACCOUNTS', noteKey: 'dapp.notice_wrong_account' };
    }
    let bytes: Uint8Array;
    let text: string | null;
    try {
      if (!ethers.isHexString(message)) throw new Error('not hex');
      bytes = ethers.getBytes(message);
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        text = null;
      }
    } catch {
      bytes = ethers.toUtf8Bytes(message);
      text = message;
    }
    return { type: 'sign', chain, bytes, text };
  }

  if (req.method === 'eth_sendTransaction') {
    if (!chain) return { type: 'auto_reject', key: 'UNSUPPORTED_CHAINS' };
    const tx = parseTxParams(req.params);
    if (!tx) return { type: 'auto_reject', key: 'WC_METHOD_UNSUPPORTED', noteKey: 'dapp.notice_unsupported_tx' };
    if (tx.from && !sameAddress(tx.from, walletAddress)) {
      return { type: 'auto_reject', key: 'UNSUPPORTED_ACCOUNTS', noteKey: 'dapp.notice_wrong_account' };
    }
    return { type: 'tx', chain, tx, summary: summarizeTx(tx, walletAddress) };
  }

  return { type: 'auto_reject', key: 'WC_METHOD_UNSUPPORTED' };
}

// ------------------------------------------------------------------ 署名・送信の承認ダイアログ

function RequestDialog({ req, classified, wallet }: {
  req: DappRequestView;
  classified: Extract<Classified, { type: 'tx' | 'sign' }>;
  wallet: WalletRecord;
}) {
  const { t } = useTranslation();
  const [ack, setAck] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const chainKey = classified.chain.key;
  const chainConfig = CHAINS[chainKey];
  const blocked = req.isScam || req.validation === 'INVALID';
  const isTx = classified.type === 'tx';
  const summary = classified.type === 'tx' ? classified.summary : null;
  const needsAck = summary?.risk === 'danger';
  const unreadableSign = classified.type === 'sign' && classified.text === null;

  const reject = async () => {
    if (busy) return;
    try {
      await respondSdkError(req, 'USER_REJECTED');
    } catch (e) {
      console.warn('Failed to send rejection', e);
      useDappStore.getState().removeRequest(req.id);
    }
  };

  // 署名・送信そのものは済んでいるのに dApp への返信だけ失敗した場合(セッション切れなど)は、
  // 失敗扱いにせず、リクエストを片付けるだけにする(取引を送ったのに「失敗」と出さないため)。
  const answer = async (result: unknown) => {
    try {
      await respondResult(req, result);
    } catch (e) {
      console.warn('Could not answer the dApp (the session may have expired)', e);
      useDappStore.getState().removeRequest(req.id);
    }
  };

  // password === null: MetaMask / Bitget Wallet で接続中のウォレット(署名は拡張側で承認する)。
  const execute = async (password: string | null) => {
    setBusy(true);
    setError('');
    let respondedOk = false;
    try {
      let privateKey: string | null = null;
      if (!wallet.externalProvider) {
        privateKey = password == null ? null : await WalletsHelper.decryptKey(wallet.id, password);
        if (privateKey == null) {
          setError(t('wallet.invalid_key'));
          return;
        }
      }

      if (classified.type === 'sign') {
        const signer = wallet.externalProvider
          ? await getExternalSigner(wallet.externalProvider, wallet.address, chainTargetFromKey(chainKey))
          : new ethers.Wallet(privateKey as string);
        const signature = await signer.signMessage(classified.bytes);
        await answer(signature);
        respondedOk = true;
        notify({ severity: 'success', message: t('dapp.notice_signed') });
        return;
      }

      const { tx } = classified;
      const base: ethers.TransactionRequest = { to: tx.to, data: tx.data, value: tx.value };
      if (tx.gas !== undefined) base.gasLimit = tx.gas;

      let hash: string;
      if (wallet.externalProvider) {
        // 手数料・nonce は拡張側に任せる(chains.ts の signAndSend と同じ扱い)。
        const signer = await getExternalSigner(wallet.externalProvider, wallet.address, chainTargetFromKey(chainKey));
        hash = (await signer.sendTransaction(base)).hash;
      } else {
        const provider = getProvider(chainKey);
        const signer = new ethers.Wallet(privateKey as string, provider);
        // 通常の送金と同じ手数料ポリシー(Polygon の priority fee 下限など)を使う。
        const overrides = await getGasOverrides(chainKey, provider);
        hash = (await signer.sendTransaction({ ...base, ...overrides })).hash;
      }
      await answer(hash);
      respondedOk = true;
      notify({
        severity: 'info',
        message: t('dapp.notice_sent'),
        explorerUrl: `${chainConfig.blockExplorerUrl}/tx/${hash}`,
      });
      playSentSound();
      // 取り込まれたら、自分宛てに届いたNFTを保有一覧に追加する。
      void trackTxForNfts(chainKey, hash, wallet.address).catch((e) => console.warn('trackTxForNfts failed', e));
    } catch (e) {
      const message = isExternalWalletError(e)
        ? t(`external.error_${e.code}`)
        : (e as { code?: string } | null)?.code === 'ACTION_REJECTED'
          ? t('external.error_rejected')
          : extractRpcMessage(e);
      if (respondedOk) {
        // 応答は済んでいるのに後処理で失敗した場合は、dApp には何も返さない。
        console.warn('Post-response step failed', e);
        return;
      }
      setError(message);
      try {
        await respondFailure(req, message);
      } catch (respondError) {
        console.warn('Failed to send failure response', respondError);
        useDappStore.getState().removeRequest(req.id);
      }
    } finally {
      setBusy(false);
    }
  };

  const onApprove = async () => {
    unlockSounds();
    if (wallet.externalProvider) {
      await execute(null);
    } else {
      setShowPassword(true);
    }
  };

  const canApprove = !blocked && !busy && (!needsAck || ack);

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={() => { /* 外側のタップでは閉じない(誤操作防止) */ }}>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {isTx ? t('dapp.req_tx_title') : t('dapp.req_sign_title')}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <OriginBlock name={req.peerName} url={req.origin} validation={req.validation} isScam={req.isScam} />
          <Divider />
          <Box>
            <Typography sx={labelSx}>{t('dapp.network')}</Typography>
            <Typography sx={{ mt: 0.5, fontWeight: 600 }}>{chainConfig.name}</Typography>
          </Box>

          {classified.type === 'tx' && summary && (
            <>
              <Box>
                <Typography sx={labelSx}>{t('dapp.action')}</Typography>
                <Typography sx={{ mt: 0.5, fontWeight: 600 }}>{t(`dapp.kind_${summary.kind}`)}</Typography>
                {summary.kind === 'set_approval_for_all' && summary.approved === false && (
                  <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>{t('dapp.revoke_note')}</Typography>
                )}
              </Box>
              <Box>
                <Typography sx={labelSx}>{t('dapp.to')}</Typography>
                <Box sx={{ mt: 0.5 }}><AddressChunks address={classified.tx.to} /></Box>
              </Box>
              {classified.tx.value > 0n && (
                <Box>
                  <Typography sx={labelSx}>{t('dapp.value')}</Typography>
                  <Typography sx={{ mt: 0.5, fontWeight: 700, fontSize: '1.3rem' }}>
                    {ethers.formatUnits(classified.tx.value, chainConfig.nativeCurrency.decimals)} {chainConfig.nativeCurrency.symbol}
                  </Typography>
                </Box>
              )}
              {summary.spender && (
                <Box>
                  <Typography sx={labelSx}>{t('dapp.spender')}</Typography>
                  <Box sx={{ mt: 0.5 }}><AddressChunks address={summary.spender} /></Box>
                </Box>
              )}
              {summary.recipient && summary.kind !== 'native_transfer' && (
                <Box>
                  <Typography sx={labelSx}>{t('dapp.recipient')}</Typography>
                  <Box sx={{ mt: 0.5 }}><AddressChunks address={summary.recipient} /></Box>
                </Box>
              )}
              {summary.amountRaw !== undefined && summary.kind !== 'native_transfer' && (
                <Box>
                  <Typography sx={labelSx}>{t('dapp.amount_raw')}</Typography>
                  <Typography sx={{ mt: 0.5, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                    {summary.unlimited ? t('dapp.unlimited') : summary.amountRaw.toString()}
                  </Typography>
                </Box>
              )}
              {summary.kind === 'unknown' && (
                <Typography sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'text.secondary', overflowWrap: 'anywhere' }}>
                  {summary.selector || '0x'} ({Math.max(0, (classified.tx.data.length - 2) / 2)} bytes)
                </Typography>
              )}
              {summary.risk !== 'info' && (
                <Alert severity={summary.risk === 'danger' ? 'error' : 'warning'}>
                  {summary.kind === 'unknown' && t('dapp.risk_unknown')}
                  {summary.kind === 'approve' && (summary.unlimited ? t('dapp.risk_approve_unlimited') : t('dapp.risk_approve'))}
                  {summary.kind === 'set_approval_for_all' && t('dapp.risk_set_approval_all')}
                  {summary.kind === 'move_from' && t('dapp.risk_move')}
                </Alert>
              )}
              {needsAck && (
                <FormControlLabel
                  control={<Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} />}
                  label={t('dapp.danger_ack')}
                />
              )}
            </>
          )}

          {classified.type === 'sign' && (
            <>
              <Box>
                <Typography sx={labelSx}>{t('dapp.sign_message')}</Typography>
                <Paper
                  variant="outlined"
                  sx={{ mt: 0.5, p: 1.5, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: '0.85rem' }}
                >
                  {classified.text ?? ethers.hexlify(classified.bytes)}
                </Paper>
              </Box>
              <Alert severity={unreadableSign ? 'error' : 'info'}>
                {unreadableSign ? t('dapp.sign_unreadable') : t('dapp.sign_caution')}
              </Alert>
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button onClick={reject} disabled={busy} color="inherit">{t('dapp.reject')}</Button>
        <Button variant="contained" onClick={onApprove} disabled={!canApprove} sx={{ borderRadius: 999, fontWeight: 700 }}>
          {busy ? t('dapp.approving') : wallet.externalProvider ? t('dapp.approve_external') : t('dapp.approve_pin')}
        </Button>
      </DialogActions>

      <PasswordDialog
        open={showPassword}
        mode="check"
        onClose={() => setShowPassword(false)}
        onPass={(password) => {
          setShowPassword(false);
          void execute(password);
        }}
      />
      <ErrorSnackbar message={error} onClose={() => setError('')} />
    </Dialog>
  );
}

// ------------------------------------------------------------------ 画面本体

export default function DappConnect() {
  const { t } = useTranslation();
  const proposal = useDappStore((s) => s.proposal);
  const requests = useDappStore((s) => s.requests);

  const configured = isWalletConnectConfigured();
  const originUsable = isWalletConnectOriginUsable();

  const [wallet, setWallet] = useState<WalletRecord | null>(null);
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [sessions, setSessions] = useState<DappSession[]>([]);
  const [uri, setUri] = useState('');
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const pairingRef = useRef(false);

  useEffect(() => {
    void (async () => {
      setWallet(await WalletsHelper.getActive());
      setWalletLoaded(true);
    })();
  }, []);

  const refreshSessions = async () => {
    try {
      setSessions(await listSessions());
    } catch (e) {
      console.warn('Failed to list sessions', e);
    }
  };

  // 画面を開いたら WalletConnect を起動する(未処理のリクエストはここで届く)。
  useEffect(() => {
    if (!configured || !originUsable) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        await getWalletKit();
        if (cancelled) return;
        await refreshSessions();
        unsubscribe = await onSessionsChanged(() => { void refreshSessions(); });
      } catch (e) {
        console.error('WalletConnect init failed', e);
        if (!cancelled) setErrorMessage(t('dapp.error_init', { detail: extractRpcMessage(e) }));
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, originUsable]);

  const connect = async (value: string) => {
    if (pairingRef.current) return;
    if (!value.trim().startsWith('wc:')) {
      setErrorMessage(t('dapp.error_invalid_uri'));
      return;
    }
    pairingRef.current = true;
    setConnecting(true);
    try {
      await pairWithUri(value);
      setUri('');
    } catch (e) {
      setErrorMessage(t('dapp.error_pair', { detail: extractRpcMessage(e) }));
    } finally {
      pairingRef.current = false;
      setConnecting(false);
    }
  };

  // ---- 接続の申し込み
  const namespaceCheck = useMemo(
    () => (proposal && wallet ? buildNamespacesFor(proposal.raw, wallet.address) : null),
    [proposal, wallet],
  );
  const [proposalBusy, setProposalBusy] = useState(false);

  const onApproveProposal = async () => {
    if (!proposal || !wallet) return;
    setProposalBusy(true);
    try {
      await approveProposal(proposal.raw, wallet.address);
      notify({ severity: 'success', message: t('dapp.notice_connected', { name: proposal.view.peerName }) });
      await refreshSessions();
    } catch (e) {
      setErrorMessage(extractRpcMessage(e));
    } finally {
      setProposalBusy(false);
    }
  };

  const onRejectProposal = async () => {
    if (!proposal) return;
    try {
      await rejectProposal(proposal.raw);
    } catch (e) {
      console.warn('Failed to reject proposal', e);
      useDappStore.getState().setProposal(null);
    }
  };

  // ---- 署名・送信リクエスト
  const handledRef = useRef<Set<number>>(new Set());
  const classifiedList = useMemo(
    () => (wallet ? requests.map((req) => ({ req, classified: classifyRequest(req, wallet.address) })) : []),
    [requests, wallet],
  );

  // 画面を出さずに処理できるもの(チェーン切り替え・未対応メソッド・別アドレス宛て)はここで返答する。
  useEffect(() => {
    for (const { req, classified } of classifiedList) {
      if (classified.type === 'tx' || classified.type === 'sign') continue;
      if (handledRef.current.has(req.id)) continue;
      handledRef.current.add(req.id);
      void (async () => {
        try {
          if (classified.type === 'auto_result') {
            await respondResult(req, classified.result);
          } else {
            await respondSdkError(req, classified.key);
            if (classified.noteKey) notify({ severity: 'error', message: t(classified.noteKey) });
          }
        } catch (e) {
          console.warn('Failed to answer a request automatically', e);
          useDappStore.getState().removeRequest(req.id);
        }
      })();
    }
  }, [classifiedList, t]);

  const current = classifiedList.find(
    (c): c is { req: DappRequestView; classified: Extract<Classified, { type: 'tx' | 'sign' }> } =>
      c.classified.type === 'tx' || c.classified.type === 'sign',
  );

  const onDisconnect = async (topic: string) => {
    try {
      await disconnectSession(topic);
    } catch (e) {
      console.warn('Failed to disconnect', e);
    }
    await refreshSessions();
  };

  const ready = configured && originUsable && wallet !== null;

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: '#f7f9f9' }}>
      <AppToolBar title={t('dapp.title')} back="/top?tab=home" />

      <Box sx={{ flex: 1, ...column, pt: 2, pb: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>{t('dapp.intro')}</Typography>

        {!configured && <Alert severity="warning">{t('dapp.not_configured')}</Alert>}
        {configured && !originUsable && <Alert severity="warning">{t('dapp.bad_origin')}</Alert>}
        {walletLoaded && wallet === null && <Alert severity="info">{t('dapp.no_wallet')}</Alert>}

        {ready && wallet && (
          <>
            <Paper sx={{ p: 2.5, borderRadius: 4 }}>
              <Typography sx={labelSx}>{t('dapp.wallet')}</Typography>
              <Typography sx={{ mt: 0.5, fontWeight: 600 }}>{wallet.name}</Typography>
              <Box sx={{ mt: 0.5 }}><AddressChunks address={wallet.address} /></Box>
            </Paper>

            <Paper sx={{ p: 2.5, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <TextField
                label={t('dapp.uri_label')}
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                size="small"
                fullWidth
                autoComplete="off"
                slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
              />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  disabled={connecting || uri.trim().length === 0}
                  onClick={() => void connect(uri)}
                  sx={{ borderRadius: 999, fontWeight: 700, flex: 1 }}
                >
                  {connecting ? t('dapp.connecting') : t('dapp.connect')}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<QrCodeScannerIcon />}
                  onClick={() => setScanning((v) => !v)}
                  sx={{ borderRadius: 999, flex: 1 }}
                >
                  {scanning ? t('dapp.scan_close') : t('dapp.scan')}
                </Button>
              </Box>
              {scanning && (
                <Box sx={{ borderRadius: 2, overflow: 'hidden' }}>
                  <Scanner
                    onScan={(results) => {
                      const value = results[0]?.rawValue ?? '';
                      if (value.startsWith('wc:')) {
                        setScanning(false);
                        void connect(value);
                      }
                    }}
                    onError={() => setErrorMessage(t('dapp.error_camera'))}
                  />
                </Box>
              )}
              <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{t('dapp.keep_open_note')}</Typography>
            </Paper>

            <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
              <Box sx={{ px: 2.5, py: 1.5 }}>
                <Typography sx={{ fontWeight: 700 }}>{t('dapp.sessions_title')}</Typography>
              </Box>
              <Divider />
              {sessions.length === 0 ? (
                <Typography sx={{ px: 2.5, py: 2, color: 'text.secondary', fontSize: '0.9rem' }}>{t('dapp.sessions_empty')}</Typography>
              ) : (
                sessions.map((s) => {
                  const meta = s.peer?.metadata;
                  return (
                    <Box key={s.topic} sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                      <Avatar src={meta?.icons?.[0]} sx={{ width: 36, height: 36 }}>{(meta?.name ?? '?').slice(0, 1)}</Avatar>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography noWrap sx={{ fontWeight: 600 }}>{meta?.name ?? '—'}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{meta?.url}</Typography>
                      </Box>
                      <IconButton aria-label={t('dapp.disconnect')} onClick={() => void onDisconnect(s.topic)}>
                        <LinkOffIcon />
                      </IconButton>
                    </Box>
                  );
                })
              )}
            </Paper>
          </>
        )}
      </Box>

      {/* 接続の申し込み */}
      <Dialog open={proposal !== null && wallet !== null} fullWidth maxWidth="sm" onClose={() => { /* 外側のタップでは閉じない */ }}>
        {proposal && wallet && (
          <>
            <DialogTitle sx={{ fontWeight: 700 }}>
              {namespaceCheck && !namespaceCheck.ok ? t('dapp.unsupported_title') : t('dapp.proposal_title')}
            </DialogTitle>
            <DialogContent dividers>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <OriginBlock
                  name={proposal.view.peerName}
                  url={proposal.view.origin}
                  validation={proposal.view.validation}
                  isScam={proposal.view.isScam}
                />
                {namespaceCheck && !namespaceCheck.ok ? (
                  <Alert severity="error">
                    {t('dapp.unsupported_body', { name: proposal.view.peerName })}
                    <Box sx={{ mt: 1, fontFamily: 'monospace', fontSize: '0.8rem', overflowWrap: 'anywhere' }}>{namespaceCheck.message}</Box>
                  </Alert>
                ) : (
                  <>
                    <Typography sx={{ fontSize: '0.9rem' }}>{t('dapp.proposal_body', { name: proposal.view.peerName })}</Typography>
                    <Box>
                      <Typography sx={labelSx}>{t('dapp.wallet')}</Typography>
                      <Box sx={{ mt: 0.5 }}><AddressChunks address={wallet.address} /></Box>
                    </Box>
                  </>
                )}
              </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
              <Button onClick={() => void onRejectProposal()} disabled={proposalBusy} color="inherit">{t('dapp.reject')}</Button>
              <Button
                variant="contained"
                onClick={() => void onApproveProposal()}
                disabled={
                  proposalBusy || !namespaceCheck?.ok || proposal.view.isScam || proposal.view.validation === 'INVALID'
                }
                sx={{ borderRadius: 999, fontWeight: 700 }}
              >
                {t('dapp.approve_connect')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* 署名・送信の承認(1件ずつ) */}
      {wallet && current && !proposal && (
        <RequestDialog key={current.req.id} req={current.req} classified={current.classified} wallet={wallet} />
      )}

      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}
