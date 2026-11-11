import { addDaysString, formatAmount, isValidDate, todayString } from './invoice';
import type { ScheduledPaymentRecord } from './storage';

/**
 * 予約送金 (scheduled / recurring payments): rent, subscriptions, allowance.
 *
 * A PWA can't run in the background, and this wallet's keys are only ever unlocked by the
 * person (password, or an approval inside MetaMask/Bitget), so nothing here ever sends money
 * by itself. A schedule only tracks *when* a payment is due; on/after that day the app shows
 * it (Home banner, a notification on launch) and the person approves it with one tap. This
 * file is the pure part - date arithmetic, due classification and the calendar export - kept
 * free of storage/UI so it can be reasoned about (and tested) on its own.
 *
 * All dates are local calendar dates as "YYYY-MM-DD" strings, never timestamps: "the 25th" means
 * the 25th wherever the person is, and string comparison orders them correctly.
 */

export type Frequency = 'once' | 'weekly' | 'monthly' | 'yearly';
export const FREQUENCIES: Frequency[] = ['monthly', 'weekly', 'yearly', 'once'];
export const REMIND_DAY_OPTIONS = [0, 1, 3, 7] as const;

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // month is 1-based; day 0 of the next month = last day of this one
}

/** The date `months` months after `date`, on `anchorDay` or the month's last day if it has none. */
function addMonthsClamped(date: string, months: number, anchorDay: number): string {
  const { y, m } = parts(date);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(anchorDay, daysInMonth(year, month)))}`;
}

/**
 * The due date following `current`, or null for a one-off payment. Monthly/yearly payments are
 * computed from the *anchor day* (the day-of-month of the first due date), not from the previous
 * result, so "the 31st" goes Jan 31 → Feb 28 → Mar 31 instead of drifting to the 28th for good.
 */
export function nextDueAfter(current: string, frequency: Frequency, anchorDay: number): string | null {
  switch (frequency) {
    case 'once':
      return null;
    case 'weekly':
      return addDaysString(current, 7);
    case 'monthly':
      return addMonthsClamped(current, 1, anchorDay);
    case 'yearly':
      return addMonthsClamped(current, 12, anchorDay);
  }
}

/** Whole days from `from` to `to` (negative if `to` is earlier). Calendar days, DST-proof. */
export function daysBetween(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/**
 * What happens to a schedule once the occurrence due on `record.nextDue` has been paid or
 * skipped: it moves to the following date, or completes (one-off, or past the end date).
 */
export function advance(record: Pick<ScheduledPaymentRecord, 'nextDue' | 'frequency' | 'anchorDay' | 'endDate'>): {
  nextDue: string;
  status: 'active' | 'completed';
} {
  const next = nextDueAfter(record.nextDue, record.frequency, record.anchorDay);
  if (next === null || (record.endDate !== '' && next > record.endDate)) {
    return { nextDue: record.nextDue, status: 'completed' };
  }
  return { nextDue: next, status: 'active' };
}

export type DueState = 'due' | 'upcoming' | 'later';

/**
 * 'due': the date has come (or passed) and it needs approving. 'upcoming': not yet, but inside
 * the schedule's reminder window. 'later': nothing to show yet. Only active schedules count.
 */
export function classify(
  record: Pick<ScheduledPaymentRecord, 'status' | 'nextDue' | 'remindDays'>,
  today: string = todayString(),
): { state: DueState; days: number } {
  const days = daysBetween(today, record.nextDue);
  if (record.status !== 'active') return { state: 'later', days };
  if (days <= 0) return { state: 'due', days };
  if (days <= record.remindDays) return { state: 'upcoming', days };
  return { state: 'later', days };
}

export type ScheduleValidationError =
  | 'label_required'
  | 'address_invalid'
  | 'amount_invalid'
  | 'date_invalid'
  | 'end_before_start'
  | 'chain_required';

export interface ScheduleDraft {
  label: string;
  toAddress: string;
  amount: string;
  firstDue: string;
  endDate: string;
  frequency: Frequency;
  chainId: number | null;
}

/** Returns the first problem with a schedule about to be saved, or null if it's fine. */
export function validateDraft(draft: ScheduleDraft, isAddress: (value: string) => boolean): ScheduleValidationError | null {
  if (draft.label.trim() === '') return 'label_required';
  if (draft.chainId === null) return 'chain_required';
  if (!isAddress(draft.toAddress.trim())) return 'address_invalid';
  // JPYC amounts in yen: a positive number with at most 2 decimals is plenty and keeps the
  // string safe to hand to the send flow as-is.
  if (!/^\d+(\.\d{1,2})?$/.test(draft.amount.trim()) || Number(draft.amount) <= 0) return 'amount_invalid';
  if (!isValidDate(draft.firstDue)) return 'date_invalid';
  if (draft.endDate !== '' && !isValidDate(draft.endDate)) return 'date_invalid';
  if (draft.frequency !== 'once' && draft.endDate !== '' && draft.endDate < draft.firstDue) return 'end_before_start';
  return null;
}

/** The first few due dates from `firstDue`, for the form's "what will this look like" preview. */
export function previewDates(firstDue: string, frequency: Frequency, endDate: string, count = 4): string[] {
  if (!isValidDate(firstDue)) return [];
  const anchor = parts(firstDue).d;
  const out = [firstDue];
  let cur = firstDue;
  while (out.length < count) {
    const next = nextDueAfter(cur, frequency, anchor);
    if (next === null || (endDate !== '' && next > endDate)) break;
    out.push(next);
    cur = next;
  }
  return out;
}

// --- calendar export (.ics) -----------------------------------------------------------------
//
// The one reminder that fires while this app is closed: an all-day, repeating calendar event
// with an alarm at 9:00. Every calendar app (iOS, Google, Outlook) imports .ics files.

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 line folding: lines of at most 75 octets, continuation lines start with a space. */
function icsFold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    if (currentBytes + bytes > limit) {
      out.push(current);
      current = '';
      currentBytes = 0;
      limit = 74; // the leading space of the continuation line counts too
    }
    current += ch;
    currentBytes += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}

const compact = (date: string) => date.replace(/-/g, '');

function recurrenceRule(record: ScheduledPaymentRecord): string | null {
  const until = record.endDate !== '' ? `;UNTIL=${compact(record.endDate)}` : '';
  switch (record.frequency) {
    case 'once':
      return null;
    case 'weekly':
      return `FREQ=WEEKLY${until}`;
    case 'yearly':
      return `FREQ=YEARLY${until}`;
    case 'monthly':
      // "the 31st" means the last day of shorter months (as nextDueAfter does); calendars skip
      // months that lack the 29th/30th instead, which is the best plain RRULE can express.
      return `FREQ=MONTHLY${record.anchorDay === 31 ? ';BYMONTHDAY=-1' : ''}${until}`;
  }
}

export interface IcsOptions {
  /** Link to put in each event so tapping it from the calendar opens the app. '' = none. */
  appUrl: string;
  /** Event texts (UI language), so this file stays free of i18n. */
  summary: (record: ScheduledPaymentRecord) => string;
  description: string;
  now?: Date;
}

export function buildIcs(records: ScheduledPaymentRecord[], options: IcsOptions): string {
  const now = options.now ?? new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Raccoon Wallet//Scheduled payments//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const record of records) {
    const rule = recurrenceRule(record);
    const description = [
      options.description,
      `${formatAmount(Number(record.amount))} JPYC`,
      record.recipientName !== '' ? record.recipientName : record.toAddress,
      record.note,
      options.appUrl,
    ].filter((line) => line !== '').join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${record.id}@raccoon-wallet`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(record.nextDue)}`,
      `DTEND;VALUE=DATE:${compact(addDaysString(record.nextDue, 1))}`,
      ...(rule ? [`RRULE:${rule}`] : []),
      `SUMMARY:${icsEscape(options.summary(record))}`,
      `DESCRIPTION:${icsEscape(description)}`,
      ...(options.appUrl !== '' ? [`URL:${options.appUrl}`] : []),
      'TRANSP:TRANSPARENT',
      // 9:00 on the day...
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(options.summary(record))}`,
      'TRIGGER;RELATED=START:PT9H',
      'END:VALARM',
    );
    // ...and, if asked for, 9:00 N days before it as well.
    if (record.remindDays > 0) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsEscape(options.summary(record))}`,
        `TRIGGER;RELATED=START:-PT${record.remindDays * 24 - 9}H`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
