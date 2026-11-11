import { ScheduledPaymentsHelper, WalletsHelper } from './storage';
import type { ScheduledPaymentRecord } from './storage';
import { classify } from './scheduledPayments';
import { todayString } from './invoice';

export interface DueSnapshot {
  /** Date has come (or passed): waiting for approval. Oldest first. */
  due: ScheduledPaymentRecord[];
  /** Not due yet but inside the schedule's reminder window. Soonest first. */
  upcoming: ScheduledPaymentRecord[];
}

/** What needs attention today for the active wallet (empty if there is no active wallet). */
export async function loadDueSnapshot(today: string = todayString()): Promise<DueSnapshot> {
  const wallet = await WalletsHelper.getActive();
  if (!wallet) return { due: [], upcoming: [] };
  const mine = await ScheduledPaymentsHelper.listFor(wallet.address);
  const due: ScheduledPaymentRecord[] = [];
  const upcoming: ScheduledPaymentRecord[] = [];
  for (const record of mine) {
    const { state } = classify(record, today);
    if (state === 'due') due.push(record);
    else if (state === 'upcoming') upcoming.push(record);
  }
  return { due, upcoming };
}
