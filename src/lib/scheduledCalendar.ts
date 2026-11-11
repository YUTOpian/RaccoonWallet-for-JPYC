import type { TFunction } from 'i18next';
import { buildIcs } from './scheduledPayments';
import { defaultLinkBase, formatAmount } from './invoice';
import { downloadBlob } from './invoiceDocument';
import type { ScheduledPaymentRecord } from './storage';

/** Saves the given schedules as an .ics calendar file (opens in the OS calendar app). */
export async function exportScheduleCalendar(records: ScheduledPaymentRecord[], t: TFunction): Promise<void> {
  const base = defaultLinkBase();
  const ics = buildIcs(records, {
    appUrl: base !== '' ? `${base}#/scheduled` : '',
    summary: (r) => t('scheduled.ics_summary', { label: r.label, amount: formatAmount(Number(r.amount)) }),
    description: t('scheduled.ics_description'),
  });
  downloadBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), 'raccoon-wallet-scheduled.ics');
}
