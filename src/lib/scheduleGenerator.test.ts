import { describe, expect, it } from 'vitest';
import type { ScheduleConfig, ScheduleResult, Staff } from '@/types/schedule';
import { generateSchedule } from './scheduleGenerator';
import {
  achievableHours,
  dayKey,
  getMonthDays,
  isStaffUnavailable,
  maxShiftsWithRest,
  notTogetherRelation,
  planStaff,
  shiftCountRange,
  staffOnDay,
  workShare,
} from './scheduleRules';
import { WORKLOAD_TOLERANCE, evaluateSchedule } from './scheduleStats';

const person = (name: string, extra: Partial<Staff> = {}): Staff => ({
  id: name,
  name,
  vacationDays: [],
  unavailableDates: [],
  preferTogether: [],
  preferNotTogether: [],
  preferTogetherStrict: false,
  preferNotTogetherStrict: false,
  ...extra,
});

const NOVEMBER_2026: ScheduleConfig = { month: 10, year: 2026, totalMonthlyHours: 168, minStaffPerShift: 2 };

const hoursOf = (result: ScheduleResult, id: string) =>
  result.shifts.reduce((sum, s) => sum + (s.assignments.find((a) => a.staffId === id)?.duration ?? 0), 0);

const daysOf = (result: ScheduleResult, id: string) =>
  result.shifts.filter((s) => s.assignments.some((a) => a.staffId === id)).map((s) => dayKey(s.date));

/** Rules the generator must never break. */
function expectHardRules(result: ScheduleResult, staff: Staff[], config: ScheduleConfig) {
  const days = getMonthDays(config);
  for (const s of staff) {
    const worked = new Set(daysOf(result, s.id));
    days.forEach((date, d) => {
      if (!worked.has(dayKey(date))) return;
      expect(isStaffUnavailable(s, date), `${s.name} unavailable on ${date.getDate()}`).toBe(false);
      if (d + 1 < days.length) {
        expect(worked.has(dayKey(days[d + 1])), `${s.name} back-to-back on ${date.getDate()}`).toBe(false);
      }
    });
  }
  for (const shift of result.shifts) {
    const ids = shift.assignments.map((a) => a.staffId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of staff) for (const b of staff) {
      if (a.id < b.id && ids.includes(a.id) && ids.includes(b.id)) {
        expect(notTogetherRelation(a, b), `${a.name}+${b.name} on ${shift.date.getDate()}`).not.toBe('strict');
      }
    }
  }
}

function expectFullCoverage(result: ScheduleResult, config: ScheduleConfig) {
  for (const date of getMonthDays(config)) {
    const shift = result.shifts.find((s) => dayKey(s.date) === dayKey(date));
    expect(shift?.assignments.length ?? 0, `day ${date.getDate()}`).toBeGreaterThanOrEqual(config.minStaffPerShift);
  }
}

describe('scheduleRules', () => {
  it('knows which totals 24h/16h shifts can reach', () => {
    expect([0, 8, 16, 24, 32, 40, 150, 176].map(achievableHours)).toEqual([0, 0, 16, 24, 32, 40, 144, 176]);
    expect(shiftCountRange(176)).toEqual({ min: 8, max: 11 });
  });

  it('counts the most shifts possible under the rest rule', () => {
    expect(maxShiftsWithRest(Array(30).fill(true))).toBe(15);
    expect(maxShiftsWithRest(Array(31).fill(true))).toBe(16);
    expect(maxShiftsWithRest([true, true, false, true, true])).toBe(2);
  });

  it('treats a backwards unavailable range like a forwards one', () => {
    const s = person('A', { unavailableDates: [{ start: new Date(2026, 10, 25), end: new Date(2026, 10, 20) }] });
    expect(isStaffUnavailable(s, new Date(2026, 10, 22))).toBe(true);
    expect(isStaffUnavailable(s, new Date(2026, 10, 26))).toBe(false);
  });
});

describe('generateSchedule', () => {
  it('gives everyone exactly their hours and covers every day, even when capacity is exactly tight', () => {
    // 6 × 168h in 30 days with 2 per day needs every person on ten 16h shifts: no slack at all.
    const staff = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => person(n));
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = generateSchedule(staff, NOVEMBER_2026, { seed });
      for (const s of staff) expect(hoursOf(result, s.id), `${s.name} seed ${seed}`).toBe(168);
      expectHardRules(result, staff, NOVEMBER_2026);
      expectFullCoverage(result, NOVEMBER_2026);
      expect(result.targetDeviation).toBe(0);
    }
  });

  it('hits mixed personal targets (incl. 176h, which used to end 8h short) around leave', () => {
    const vacation = [10, 11, 12, 13, 14].map((d) => new Date(2026, 10, d));
    const staff = [
      person('Ayşe', { monthlyHours: 176 }),
      person('Burak', { monthlyHours: 160 }),
      person('Cem', { monthlyHours: 152, vacationDays: vacation }),
      person('Deniz', { monthlyHours: 96 }),
      person('Ece'),
      person('Fatih', { unavailableDates: [{ start: new Date(2026, 10, 25), end: new Date(2026, 10, 20) }] }),
      person('Gül', { monthlyHours: 120 }),
    ];
    for (const seed of [11, 12, 13]) {
      const result = generateSchedule(staff, NOVEMBER_2026, { seed });
      expect(staff.map((s) => hoursOf(result, s.id))).toEqual([176, 160, 152, 96, 168, 168, 120]);
      expectHardRules(result, staff, NOVEMBER_2026);
      expectFullCoverage(result, NOVEMBER_2026);
      expect(result.suggestions).toHaveLength(1); // only the "all good" line
    }
  });

  it('works for 31- and 28-day months', () => {
    const staff = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => person(n));
    for (const config of [
      { ...NOVEMBER_2026, month: 11, totalMonthlyHours: 160 },
      { ...NOVEMBER_2026, month: 1, year: 2027, totalMonthlyHours: 144 },
    ]) {
      const result = generateSchedule(staff, config, { seed: 7 });
      for (const s of staff) expect(hoursOf(result, s.id)).toBe(config.totalMonthlyHours);
      expectHardRules(result, staff, config);
      expectFullCoverage(result, config);
    }
  });

  it('rounds a target that 24h/16h shifts cannot reach down, and says so', () => {
    const staff = [person('A', { monthlyHours: 150 }), ...['B', 'C', 'D', 'E', 'F'].map((n) => person(n))];
    const result = generateSchedule(staff, NOVEMBER_2026, { seed: 3 });
    expect(hoursOf(result, 'A')).toBe(144);
    expect(result.suggestions.some((s) => s.includes('150 saat') && s.includes('144'))).toBe(true);
  });

  it('caps an impossible target at what the month allows instead of failing silently', () => {
    const staff = ['A', 'B', 'C'].map((n) => person(n));
    const config = { ...NOVEMBER_2026, totalMonthlyHours: 720, minStaffPerShift: 1 };
    const result = generateSchedule(staff, config, { seed: 1 });
    for (const s of staff) expect(hoursOf(result, s.id)).toBe(15 * 24);
    expectHardRules(result, staff, config);
    expect(result.suggestions.some((s) => s.includes('en fazla 15 nöbet'))).toBe(true);
  });

  it('never puts a strict "not together" pair on the same day', () => {
    const staff = [
      person('A', { preferNotTogether: ['B'], preferNotTogetherStrict: true }),
      ...['B', 'C', 'D', 'E', 'F', 'G'].map((n) => person(n, { monthlyHours: 144 })),
    ];
    const result = generateSchedule(staff, NOVEMBER_2026, { seed: 5 });
    expectHardRules(result, staff, NOVEMBER_2026);
    expectFullCoverage(result, NOVEMBER_2026);
    expect(hoursOf(result, 'A')).toBe(168);
  });

  it('keeps a strict "together" pair on the same shifts', () => {
    const staff = [
      person('A', { preferTogether: ['B'], preferTogetherStrict: true }),
      ...['B', 'C', 'D', 'E', 'F', 'G'].map((n) => person(n)),
    ];
    const result = generateSchedule(staff, NOVEMBER_2026, { seed: 9 });
    const bDays = new Set(daysOf(result, 'B'));
    expect(daysOf(result, 'A').every((d) => bDays.has(d))).toBe(true);
    for (const s of staff) expect(hoursOf(result, s.id)).toBe(168);
  });

  it('honours a soft "together" preference most of the time', () => {
    const staff = [
      person('A', { preferTogether: ['B'] }),
      ...['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n) => person(n, { monthlyHours: 144 })),
    ];
    const result = generateSchedule(staff, NOVEMBER_2026, { seed: 4 });
    const stat = result.staffStats.find((s) => s.staffId === 'A')!;
    expect(stat.preferencesSatisfied / stat.preferencesTotal).toBeGreaterThanOrEqual(0.6);
  });

  it('is reproducible with a seed', () => {
    const staff = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => person(n));
    const a = generateSchedule(staff, NOVEMBER_2026, { seed: 42 });
    const b = generateSchedule(staff, NOVEMBER_2026, { seed: 42 });
    expect(a.shifts).toEqual(b.shifts);
  });
});

describe('evaluateSchedule', () => {
  it('scores manual edits with the same metric and flags rule breaks', () => {
    const staff = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => person(n));
    const result = generateSchedule(staff, NOVEMBER_2026, { seed: 8 });
    expect(evaluateSchedule(staff, result.shifts, NOVEMBER_2026).targetDeviation).toBe(result.targetDeviation);

    // Put A on the day after one of their shifts.
    const aDay = result.shifts.findIndex((s) => s.assignments.some((a) => a.staffId === 'A') && s.date.getDate() < 30);
    const next = result.shifts[aDay + 1];
    const edited = result.shifts.map((s) =>
      s === next ? { ...s, assignments: [...s.assignments.filter((a) => a.staffId !== 'A'), { staffId: 'A', duration: 24 as const }] } : s
    );
    const evaluation = evaluateSchedule(staff, edited, NOVEMBER_2026);
    expect(evaluation.suggestions.some((s) => s.startsWith('A: art arda'))).toBe(true);
    expect(evaluation.targetDeviation).toBeGreaterThan(0);
  });
});

describe('month boundaries', () => {
  const staff = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => person(n, { monthlyHours: 144 }));
  const OCTOBER_2026: ScheduleConfig = { ...NOVEMBER_2026, month: 9 };

  it('keeps whoever worked the previous month\'s last day off day 1', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const october = generateSchedule(staff, OCTOBER_2026, { seed });
      const workedPreviousDay = staffOnDay(october.shifts, new Date(2026, 9, 31));
      expect(workedPreviousDay.length).toBeGreaterThan(0);
      const november = generateSchedule(staff, NOVEMBER_2026, { seed: seed + 1000, workedPreviousDay });
      const firstDay = staffOnDay(november.shifts, new Date(2026, 10, 1));
      expect(firstDay.filter((id) => workedPreviousDay.includes(id)), `seed ${seed}`).toEqual([]);
      expectHardRules(november, staff, NOVEMBER_2026);
      expectFullCoverage(november, NOVEMBER_2026);
      for (const s of staff) expect(hoursOf(november, s.id)).toBe(144);
    }
  });

  it('counts the blocked day 1 in capacity', () => {
    const days = getMonthDays(NOVEMBER_2026);
    const alone = person('A');
    expect(planStaff(alone, NOVEMBER_2026, days).capacity).toBe(15);
    // 30 days with day 1 blocked: days 2..30 still allow 15 (2, 4, …, 30).
    expect(planStaff(alone, NOVEMBER_2026, days, { workedPreviousDay: ['A'] }).capacity).toBe(15);
    const december = getMonthDays({ ...NOVEMBER_2026, month: 11 });
    expect(planStaff(alone, { ...NOVEMBER_2026, month: 11 }, december, { workedPreviousDay: ['A'] }).capacity).toBe(15);
    expect(planStaff(alone, { ...NOVEMBER_2026, month: 11 }, december).capacity).toBe(16);
  });

  it('warns when a manual edit breaks the rest rule across the month boundary', () => {
    const result = generateSchedule(staff, NOVEMBER_2026, { seed: 2 });
    const firstDay = staffOnDay(result.shifts, new Date(2026, 10, 1));
    const evaluation = evaluateSchedule(staff, result.shifts, NOVEMBER_2026, { workedPreviousDay: [firstDay[0]] });
    expect(evaluation.suggestions.some((s) => s.startsWith(`${firstDay[0]}: önceki ayın son günü nöbetçiydi`))).toBe(true);
  });
});

describe('evaluateSchedule robustness', () => {
  const staff = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => person(n));

  it('ignores shifts outside the evaluated month', () => {
    const result = generateSchedule(staff, NOVEMBER_2026, { seed: 1 });
    const withStray = [...result.shifts, { date: new Date(2026, 11, 5), assignments: [{ staffId: 'A', duration: 24 as const }] }];
    expect(evaluateSchedule(staff, withStray, NOVEMBER_2026)).toEqual(evaluateSchedule(staff, result.shifts, NOVEMBER_2026));
  });

  it('flags assignments of deleted staff and does not count them as coverage', () => {
    const result = generateSchedule(staff, NOVEMBER_2026, { seed: 1 });
    const day = result.shifts[0];
    const remaining = staff.filter((s) => !day.assignments.some((a) => a.staffId === s.id));
    const evaluation = evaluateSchedule(remaining, result.shifts, NOVEMBER_2026);
    expect(evaluation.suggestions.some((s) => s.startsWith('Silinmiş personele ait nöbetler var: 1 Kasım'))).toBe(true);
    expect(evaluation.suggestions.some((s) => s.startsWith('En az 2 nöbetçi şartını sağlamayan günler: 1'))).toBe(true);
  });
});

describe('real workload', () => {
  const shift = (day: number, ...assignments: [string, 16 | 24][]) => ({
    date: new Date(2026, 10, day),
    assignments: assignments.map(([staffId, duration]) => ({ staffId, duration })),
  });

  it('splits every hour of the day among the people on duty then', () => {
    expect(workShare(24, 4, 4)).toBe(6);
    expect(workShare(24, 5, 5)).toBeCloseTo(4.8);
    // 3 × 24h + 2 × 16h: 08:30–00:00 shared by 5, 00:00–08:30 by the three 24h staff.
    expect(workShare(24, 5, 3)).toBeCloseTo(15.5 / 5 + 8.5 / 3);
    expect(workShare(16, 5, 3)).toBeCloseTo(3.1);
    expect(3 * workShare(24, 5, 3) + 2 * workShare(16, 5, 3)).toBeCloseTo(24);
    // Nobody on 24h: the 16h staff share their 15.5 hours, the night is uncovered.
    expect(workShare(16, 2, 0)).toBeCloseTo(7.75);
  });

  it('reports each person\'s workload against a fair share, and warns when crowded days are not shared', () => {
    const staff = ['A', 'B', 'C', 'D'].map((n) => person(n));
    // A, B and C always work together; D always alone. Same hours, very different real work.
    const shifts = [shift(1, ['A', 24], ['B', 24], ['C', 24]), shift(3, ['A', 24], ['B', 24], ['C', 24]), shift(5, ['D', 24]), shift(7, ['D', 24])];
    const { staffStats, suggestions } = evaluateSchedule(staff, shifts, NOVEMBER_2026);
    expect(staffStats.map((s) => s.workload)).toEqual([16, 16, 16, 48]);
    expect(staffStats.map((s) => s.fairWorkload)).toEqual([24, 24, 24, 24]);
    expect(suggestions).toContain('Gerçek yük dengesiz: D adil payından 24,0 saat fazla, A 8,0 saat az çalışıyor. Kalabalık günler eşit paylaşılmamış.');
  });

  it('counts the night for 24h staff only, and leaves deleted staff out of the crew', () => {
    const staff = ['A', 'B'].map((n) => person(n));
    const { staffStats } = evaluateSchedule(staff, [shift(1, ['A', 24], ['B', 16]), shift(3, ['A', 24], ['gone', 24])], NOVEMBER_2026);
    expect(staffStats[0].workload).toBeCloseTo(15.5 / 2 + 8.5 + 24);
    expect(staffStats[1].workload).toBeCloseTo(7.75);
  });

  it('shares crowded days evenly: 19 people on 168 hours, at least 4 a day', () => {
    // 133 shifts over 30 days: 13 days of 5 and 17 of 4. 65 places on 5-person days over 19 people is 3 or 4
    // each, so the best possible is 37.2–38.4 hours of real work. Without step 4 it was 33.6–42.
    const staff = Array.from({ length: 19 }, (_, i) => person(`P${i + 1}`));
    const config: ScheduleConfig = { ...NOVEMBER_2026, minStaffPerShift: 4 };
    for (const seed of [1, 2, 3]) {
      const result = generateSchedule(staff, config, { seed });
      expectHardRules(result, staff, config);
      expectFullCoverage(result, config);
      for (const s of staff) expect(hoursOf(result, s.id)).toBe(168);
      const loads = result.staffStats.map((s) => s.workload);
      expect(Math.max(...loads) - Math.min(...loads), `seed ${seed}`).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(result.suggestions.some((s) => s.startsWith('Gerçek yük'))).toBe(false);
    }
  });

  it('keeps workload in proportion to hours with mixed targets, 16h shifts and leave', () => {
    const leave = [new Date(2026, 10, 10), new Date(2026, 10, 11)];
    const staff = Array.from({ length: 19 }, (_, i) =>
      person(`P${i + 1}`, i % 3 === 0 ? { monthlyHours: 160 } : i % 5 === 0 ? { monthlyHours: 120, vacationDays: leave } : {})
    );
    const config: ScheduleConfig = { ...NOVEMBER_2026, minStaffPerShift: 4 };
    const result = generateSchedule(staff, config, { seed: 4 });
    expectHardRules(result, staff, config);
    expect(result.staffStats.some((s) => s.shift16Count > 0)).toBe(true);
    const gaps = result.staffStats.map((s) => s.workload - s.fairWorkload);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(WORKLOAD_TOLERANCE / 2);
  });
});
