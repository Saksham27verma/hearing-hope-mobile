import type { Appointment } from '../types';

function parseStartToDate(start: unknown): Date | null {
  if (!start) return null;
  if (typeof start === 'string') {
    const d = new Date(start);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof start === 'object' && start !== null) {
    const o = start as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') return o.toDate();
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000);
  }
  return null;
}

function isAppointmentToday(start: unknown): boolean {
  const d = parseStartToDate(start);
  if (!d) return false;
  const today = new Date();
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

/** Today + scheduled (or unset) + not completed/cancelled — eligible for staff payment logging. */
export function isPayableAppointmentForPayment(a: Appointment): boolean {
  if (!isAppointmentToday(a.start)) return false;
  const s = (a.status || '').toLowerCase();
  if (s === 'completed' || s === 'cancelled') return false;
  if (s && s !== 'scheduled') return false;
  return true;
}

/** Same day/rules as payment + linked enquiry (required to write CRM visits). Network required (no offline queue). */
export function isEligibleForVisitServicesLogging(a: Appointment): boolean {
  return isPayableAppointmentForPayment(a) && Boolean((a.enquiryId || '').trim());
}
