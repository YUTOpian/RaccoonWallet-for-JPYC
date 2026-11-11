import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, Typography } from '@mui/material';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import { useTranslation } from 'react-i18next';
import { chunkAddress, diffSegments } from '../lib/addressSafety';
import type { SafetyAssessment } from '../lib/addressSafety';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** アドレスを4文字ずつに区切って表示する。`against` を渡すと、そちらと違う文字を赤くする。 */
export function AddressChunks({ address, against }: { address: string; against?: string }) {
  if (against !== undefined) {
    return (
      <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.9rem', lineHeight: 1.7, wordBreak: 'break-all' }}>
        {diffSegments(address, against).map((seg, i) => (
          <Box key={i} component="span" sx={seg.differs ? { color: 'error.main', fontWeight: 800, bgcolor: 'rgba(211,47,47,0.10)', borderRadius: 0.5 } : undefined}>
            {seg.text}
          </Box>
        ))}
      </Typography>
    );
  }
  const chunks = chunkAddress(address);
  return (
    <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.92rem', lineHeight: 1.7, wordBreak: 'break-all' }}>
      {chunks.map((c, i) => (
        <Box key={i} component="span" sx={{ mr: 0.8, display: 'inline-block', fontWeight: i === 1 || i === chunks.length - 1 ? 800 : 500 }}>
          {c}
        </Box>
      ))}
    </Typography>
  );
}

/** 宛先の横に置く目印(アドレス帳に登録済み / 送ったことがある / 初めて / 似たアドレス)。 */
export function AddressBadges({ assessment }: { assessment: SafetyAssessment | null }) {
  const { t } = useTranslation();
  if (assessment === null) return null;
  const chips: { label: string; color: 'success' | 'info' | 'warning' | 'error' | 'default'; icon?: boolean }[] = [];
  if (assessment.reasons.includes('lookalike')) chips.push({ label: t('safety.badge_lookalike'), color: 'error' });
  if (assessment.contactName !== null) chips.push({ label: t('safety.badge_contact', { name: assessment.contactName }), color: 'success', icon: true });
  else if (assessment.sentBefore) chips.push({ label: t('safety.badge_sent'), color: 'info', icon: true });
  else if (!assessment.reasons.includes('self') && !assessment.reasons.includes('lookalike')) chips.push({ label: t('safety.badge_first'), color: 'warning' });
  if (assessment.reasons.includes('self')) chips.push({ label: t('safety.badge_self'), color: 'default' });
  if (assessment.reasons.includes('chain_mismatch')) chips.push({ label: t('safety.badge_chain'), color: 'warning' });
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
      {chips.map((c) => (
        <Chip
          key={c.label}
          size="small"
          color={c.color}
          variant={c.color === 'default' ? 'outlined' : 'filled'}
          icon={c.icon ? <VerifiedUserOutlinedIcon /> : undefined}
          label={c.label}
          sx={{ fontWeight: 700 }}
        />
      ))}
    </Box>
  );
}

interface Props {
  assessment: SafetyAssessment | null;
  to: string;
  /** 送ろうとしているネットワークの表示名と、通貨名。 */
  networkName: string;
  tokenLabel: string;
  /** JPYC・ネイティブ通貨以外のトークンのコントラクト(あれば表示して確認させる)。 */
  tokenAddress?: string | null;
  /** 登録済み/送信済みの正しい(はずの)アドレスに切り替える。 */
  onUseKnownAddress?: (address: string) => void;
  /** 確認のチェック(requiresAck の時だけ表示)。 */
  ack: boolean;
  onAckChange: (value: boolean) => void;
  /** 住所を大きく表示するか(確認画面用)。短い一覧では false。 */
  compact?: boolean;
}

/**
 * 宛先まわりの警告をまとめて出す。危険度が高いほど先に・強く出し、確認のチェックを入れるまで
 * 親は送信ボタンを止める(requiresAck)。何も問題がなければ「アドレス帳の相手」などの目印だけ。
 */
export default function AddressSafetyBlock({ assessment, to, networkName, tokenLabel, tokenAddress, onUseKnownAddress, ack, onAckChange }: Props) {
  const { t } = useTranslation();
  if (assessment === null) return null;
  const has = (r: SafetyAssessment['reasons'][number]) => assessment.reasons.includes(r);
  const severity = assessment.level === 'danger' ? 'error' : assessment.level === 'warn' ? 'warning' : 'info';
  const lookalike = assessment.lookalike;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {has('burn_address') && (
        <Alert severity="error">
          <Typography sx={{ fontWeight: 700 }}>{t('safety.burn_title')}</Typography>
          <Typography sx={{ fontSize: '0.85rem', mt: 0.5 }}>{t('safety.burn_body')}</Typography>
        </Alert>
      )}
      {has('token_contract') && (
        <Alert severity="error">
          <Typography sx={{ fontWeight: 700 }}>{t('safety.contract_title')}</Typography>
          <Typography sx={{ fontSize: '0.85rem', mt: 0.5 }}>{t('safety.contract_body')}</Typography>
        </Alert>
      )}

      {has('lookalike') && lookalike && (
        <Alert severity="error" sx={{ alignItems: 'flex-start' }}>
          <Typography sx={{ fontWeight: 700 }}>{t('safety.lookalike_title')}</Typography>
          <Typography sx={{ fontSize: '0.85rem', mt: 0.5 }}>
            {lookalike.label !== null
              ? t('safety.lookalike_body_contact', { name: lookalike.label })
              : t('safety.lookalike_body_sent')}
          </Typography>
          <Box sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary' }}>
              {lookalike.label !== null ? t('safety.lookalike_known_contact', { name: lookalike.label }) : t('safety.lookalike_known_sent')}
            </Typography>
            <AddressChunks address={lookalike.address} against={to} />
          </Box>
          <Box sx={{ mt: 1 }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary' }}>{t('safety.lookalike_current')}</Typography>
            <AddressChunks address={to} against={lookalike.address} />
          </Box>
          <Typography sx={{ fontSize: '0.78rem', mt: 1, color: 'text.secondary' }}>{t('safety.lookalike_hint')}</Typography>
          {onUseKnownAddress && (
            <Button
              size="small"
              variant="contained"
              color="success"
              onClick={() => onUseKnownAddress(lookalike.address)}
              sx={{ mt: 1.5, textTransform: 'none', fontWeight: 700 }}
            >
              {t('safety.use_known')}
            </Button>
          )}
        </Alert>
      )}

      {has('chain_mismatch') && (
        <Alert severity="warning">
          <Typography sx={{ fontWeight: 700 }}>{t('safety.chain_title')}</Typography>
          <Typography sx={{ fontSize: '0.85rem', mt: 0.5 }}>
            {t('safety.chain_body', { name: assessment.contactName ?? '', registered: assessment.contactChains.join(' / '), selected: networkName })}
          </Typography>
        </Alert>
      )}

      {has('dust_sender') && (
        <Alert severity="warning">
          <Typography sx={{ fontWeight: 700 }}>{t('safety.dust_title')}</Typography>
          <Typography sx={{ fontSize: '0.85rem', mt: 0.5 }}>{t('safety.dust_body')}</Typography>
        </Alert>
      )}

      {has('first_time') && !has('lookalike') && (
        <Alert severity="warning">
          <Typography sx={{ fontWeight: 700 }}>{t('safety.first_title')}</Typography>
          <Typography sx={{ fontSize: '0.85rem', mt: 0.5 }}>{t('safety.first_body')}</Typography>
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, fontSize: '0.82rem', color: 'text.secondary' }}>
            {(t('safety.first_tips', { returnObjects: true }) as string[]).map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </Box>
        </Alert>
      )}

      {has('self') && <Alert severity="info">{t('safety.self_body')}</Alert>}

      {/* ネットワークとトークンの照合: 送金先が「この鎖のこのトークン」を受け取れるか、人の目で確かめる。 */}
      <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', px: 2, py: 1.5 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: '0.75rem', fontWeight: 600 }}>{t('safety.network_token')}</Typography>
        <Typography sx={{ fontWeight: 700, mt: 0.25 }}>{t('safety.network_token_value', { network: networkName, token: tokenLabel })}</Typography>
        {tokenAddress && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem', color: 'text.secondary', wordBreak: 'break-all' }}>
            {t('safety.token_contract_label')}: {tokenAddress}
          </Typography>
        )}
        <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mt: 0.5 }}>{t('safety.network_note', { network: networkName, token: tokenLabel })}</Typography>
      </Box>

      {assessment.requiresAck && (
        <Box sx={{ borderRadius: 3, border: '2px solid', borderColor: `${severity}.main`, px: 1.5, py: 0.5 }}>
          <FormControlLabel
            control={<Checkbox checked={ack} onChange={(e) => onAckChange(e.target.checked)} color={severity === 'info' ? 'primary' : severity} />}
            label={
              <Typography sx={{ fontSize: '0.88rem', fontWeight: 600 }}>
                {assessment.level === 'danger' ? t('safety.ack_danger') : has('chain_mismatch') ? t('safety.ack_chain', { registered: assessment.contactChains.join(' / ') }) : t('safety.ack_first')}
              </Typography>
            }
          />
        </Box>
      )}
    </Box>
  );
}

/**
 * 入力欄の下に出す短いヒント(目印+いちばん重い警告の1行)。詳しい比較と確認は、送金確認・承認画面で出す。
 * 貼り付けた直後に気づけるようにするためのもの。
 */
export function AddressSafetyHint({ assessment }: { assessment: SafetyAssessment | null }) {
  const { t } = useTranslation();
  if (assessment === null) return null;
  const order: SafetyAssessment['reasons'][number][] = ['burn_address', 'token_contract', 'lookalike', 'chain_mismatch', 'dust_sender'];
  const top = order.find((r) => assessment.reasons.includes(r));
  return (
    <Box sx={{ mt: 0.5 }}>
      <AddressBadges assessment={assessment} />
      {top !== undefined && (
        <Typography sx={{ mt: 0.75, fontSize: '0.8rem', fontWeight: 600, color: assessment.level === 'danger' ? 'error.main' : 'warning.dark' }}>
          {t(`safety.hint_${top}`)}
        </Typography>
      )}
    </Box>
  );
}
