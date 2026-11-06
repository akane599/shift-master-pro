import type { ScheduleConfig, Shift, Staff } from '@/types/schedule';

/**
 * Shared scheduling rules used by the generator, the statistics and the manual edit dialog,
 * so all three agree on what "available", "target hours" and "conflict" mean.
 */

export const LONG_SHIFT = 24;
export const SHORT_SHIFT = 16;

/** Local calendar-day key (yyyymmdd). Compare days with this, never with timestamps or ISO strings. */
export function dayKey(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

type MonthRef = Pick<ScheduleConfig, 'month' | 'year'>;

/** Every day of the configured month, as local midnight dates. */
export function getMonthDays(config: MonthRef): Date[] {
  const count = new Date(config.year, config.month + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => new Date(config.year, config.month, i + 1));
}

/** Storage key of a month: `yyyy-MM` (month 1-based). */
export function monthKey(ref: MonthRef): string {
  return `${ref.year}-${String(ref.month + 1).padStart(2, '0')}`;
}

export function previousMonth(ref: MonthRef): MonthRef {
  return ref.month === 0 ? { month: 11, year: ref.year - 1 } : { month: ref.month - 1, year: ref.year };
}

/** Staff on duty on the given day of a roster. */
export function staffOnDay(shifts: Shift[], date: Date): string[] {
  const key = dayKey(date);
  return shifts.find((s) => dayKey(s.date) === key)?.assignments.map((a) => a.staffId) ?? [];
}

/**
 * What the month's rules need to know from outside the month.
 * `workedPreviousDay`: staff on duty on the last day of the previous month. The rest rule keeps them off day 1.
 */
export interface MonthContext {
  workedPreviousDay?: string[];
}

/** Per-day availability for the month (`days` from getMonthDays): leave, unavailable ranges and the carry-in rest day. */
export function availableDays(staff: Staff, days: Date[], context: MonthContext = {}): boolean[] {
  const restsOnFirstDay = (context.workedPreviousDay ?? []).includes(staff.id);
  return days.map((date, d) => !(d === 0 && restsOnFirstDay) && !isStaffUnavailable(staff, date));
}

/** Vacation day or inside an unavailable range (inclusive, tolerant of ranges entered backwards). */
export function isStaffUnavailable(staff: Staff, date: Date): boolean {
  const key = dayKey(date);
  if ((staff.vacationDays ?? []).some((d) => dayKey(d) === key)) return true;
  return (staff.unavailableDates ?? []).some((range) => {
    const a = dayKey(range.start);
    const b = dayKey(range.end);
    return key >= Math.min(a, b) && key <= Math.max(a, b);
  });
}

/** The hours the user asked for: personal value if set, otherwise the per-person default. */
export function getTargetHours(staff: Staff, config: Pick<ScheduleConfig, 'totalMonthlyHours'>): number {
  return Math.max(0, staff.monthlyHours ?? config.totalMonthlyHours ?? 0);
}

/**
 * Largest total ≤ `hours` that 24h and 16h shifts can add up to exactly.
 * Every multiple of 8 from 16 upwards is reachable (16, 24, 32 = 16+16, 40 = 24+16, …); 8 is not.
 */
export function achievableHours(hours: number): number {
  const rounded = Math.floor(Math.max(0, hours) / 8) * 8;
  return rounded < SHORT_SHIFT ? 0 : rounded;
}

/** Shift counts that can make up exactly `hours` (an achievable value) with 24h/16h shifts. */
export function shiftCountRange(hours: number): { min: number; max: number } {
  return { min: Math.ceil(hours / LONG_SHIFT), max: Math.floor(hours / SHORT_SHIFT) };
}

/** How many of `count` shifts must be 24h so the total is `hours` (the rest are 16h). */
export function longShiftCount(hours: number, count: number): number {
  return Math.min(count, Math.max(0, (hours - SHORT_SHIFT * count) / 8));
}

/** Most shifts someone can take on these days under the post-shift rest rule (no two days in a row). */
export function maxShiftsWithRest(available: boolean[]): number {
  let count = 0;
  for (let d = 0; d < available.length; d++) {
    if (available[d]) {
      count++;
      d++; // the next day must stay free
    }
  }
  return count;
}

/*
 * Real workload ("gerçek yük"). A 24h shift runs 08:30–08:30 and a 16h shift 08:30–00:00, so from 00:00 to
 * 08:30 only the 24h staff are on duty. Every hour of the day is shared by everyone on duty at that hour: with
 * four people on 24h each carries 24 / 4 = 6 hours of the day, with five 4.8. Whoever lands on crowded days
 * more often does less real work for the same hours.
 */

/** 00:00–08:30: only the 24h staff are on duty. */
export const NIGHT_HOURS = 8.5;
/** 08:30–00:00: everyone on duty that day is there. */
export const SHARED_HOURS = LONG_SHIFT - NIGHT_HOURS;

/**
 * One person's share of a day's work, in hours. `onDuty`: everyone on duty that day; `onNight`: how many of
 * them work 24h. The shares of a day add up to 24 (or 15.5 if nobody works 24h and the night is uncovered).
 */
export function workShare(duration: number, onDuty: number, onNight: number): number {
  if (onDuty <= 0) return 0;
  const night = duration === LONG_SHIFT && onNight > 0 ? NIGHT_HOURS / onNight : 0;
  return SHARED_HOURS / onDuty + night;
}

export type PairRelation = 'none' | 'soft' | 'strict';

/** "Birlikte çalışmak istemediği" between two people, from either side. Strict means never on the same day. */
export function notTogetherRelation(a: Staff, b: Staff): PairRelation {
  const aListsB = (a.preferNotTogether ?? []).includes(b.id);
  const bListsA = (b.preferNotTogether ?? []).includes(a.id);
  if ((aListsB && a.preferNotTogetherStrict) || (bListsA && b.preferNotTogetherStrict)) return 'strict';
  return aListsB || bListsA ? 'soft' : 'none';
}

export interface StaffPlan {
  staffId: string;
  /** What the user asked for. */
  targetHours: number;
  /** What will actually be scheduled: target rounded down to a 24/16 combination and capped by availability. */
  plannedHours: number;
  /** Most shifts the rest rule and availability allow this month. */
  capacity: number;
  minShifts: number;
  maxShifts: number;
}

/** Per-person shift-count window that hits the hour target exactly (when the month allows it). */
export function planStaff(staff: Staff, config: ScheduleConfig, days: Date[], context: MonthContext = {}): StaffPlan {
  const targetHours = getTargetHours(staff, config);
  const capacity = maxShiftsWithRest(availableDays(staff, days, context));
  const exact = achievableHours(targetHours);
  const range = shiftCountRange(exact);
  const maxShifts = Math.min(range.max, capacity);
  const minShifts = Math.min(range.min, maxShifts);
  const plannedHours = range.min > capacity ? LONG_SHIFT * capacity : exact;
  return { staffId: staff.id, targetHours, plannedHours, capacity, minShifts, maxShifts };
}
