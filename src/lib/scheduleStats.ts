import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { ScheduleConfig, ScheduleResult, Shift, Staff, StaffStats } from '@/types/schedule';
import {
  achievableHours,
  dayKey,
  getMonthDays,
  isStaffUnavailable,
  LONG_SHIFT,
  notTogetherRelation,
  planStaff,
  workShare,
  type MonthContext,
} from './scheduleRules';

export type ScheduleEvaluation = Omit<ScheduleResult, 'shifts'>;

/**
 * Largest gap, in hours, between the most and least loaded person (each measured against their fair share)
 * before a warning is shown. One crowded day more or less is 1.2 hours with 4–5 people on 24h, so 3 hours
 * means crowded days were clearly not shared evenly.
 */
export const WORKLOAD_TOLERANCE = 3;

/** Hours with one decimal, Turkish style ("37,2"). */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return (rounded === 0 ? 0 : rounded).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Stats, target deviation and warnings for any schedule — generated or manually edited.
 * This is the only place these are computed, so the numbers mean the same thing before and after an edit.
 * Shifts outside `config`'s month are ignored.
 */
export function evaluateSchedule(
  staff: Staff[],
  allShifts: Shift[],
  config: ScheduleConfig,
  context: MonthContext = {}
): ScheduleEvaluation {
  const days = getMonthDays(config);
  const monthDays = new Set(days.map(dayKey));
  const shifts = allShifts.filter((s) => monthDays.has(dayKey(s.date)));
  const minPerDay = Math.max(0, config.minStaffPerShift || 0);
  const shiftByDay = new Map(shifts.map((s) => [dayKey(s.date), s]));
  const staffIds = new Set(staff.map((s) => s.id));
  const worksOn = (staffId: string, date: Date) =>
    shiftByDay.get(dayKey(date))?.assignments.some((a) => a.staffId === staffId) ?? false;
  /** People on duty that day who still exist (assignments of deleted staff don't cover anything). */
  const onDuty = (date: Date) =>
    shiftByDay.get(dayKey(date))?.assignments.filter((a) => staffIds.has(a.staffId)).length ?? 0;
  const dayLabel = (date: Date) => format(date, 'd MMMM', { locale: tr });

  const plans = staff.map((s) => planStaff(s, config, days, context));

  /** Who shares each day's work: known staff only, like coverage. */
  const crew = new Map(
    shifts.map((s) => {
      const known = s.assignments.filter((a) => staffIds.has(a.staffId));
      return [s, { onDuty: known.length, onNight: known.filter((a) => a.duration === LONG_SHIFT).length }];
    })
  );

  const staffStats: StaffStats[] = staff.map((s, i) => {
    let totalHours = 0;
    let shiftCount = 0;
    let shift24Count = 0;
    let shift16Count = 0;
    let workload = 0;
    let preferencesSatisfied = 0;
    let preferencesTotal = 0;
    for (const shift of shifts) {
      const assignment = shift.assignments.find((a) => a.staffId === s.id);
      if (!assignment) continue;
      totalHours += assignment.duration;
      shiftCount++;
      if (assignment.duration === 24) shift24Count++;
      else shift16Count++;
      const { onDuty, onNight } = crew.get(shift)!;
      workload += workShare(assignment.duration, onDuty, onNight);
      for (const partnerId of s.preferTogether ?? []) {
        if (!staffIds.has(partnerId)) continue;
        preferencesTotal++;
        if (shift.assignments.some((a) => a.staffId === partnerId)) preferencesSatisfied++;
      }
    }
    return {
      staffId: s.id,
      name: s.name,
      targetHours: plans[i].targetHours,
      totalHours,
      shiftCount,
      shift24Count,
      shift16Count,
      workload,
      fairWorkload: 0,
      preferencesSatisfied,
      preferencesTotal,
    };
  });

  // Fair share: the month's real work divided in proportion to the hours each person works.
  const allHours = staffStats.reduce((sum, st) => sum + st.totalHours, 0);
  const allWork = staffStats.reduce((sum, st) => sum + st.workload, 0);
  for (const st of staffStats) st.fairWorkload = allHours ? (st.totalHours * allWork) / allHours : 0;

  const deviations = staffStats.map((st) =>
    st.targetHours > 0 ? Math.abs(st.totalHours - st.targetHours) / st.targetHours : st.totalHours > 0 ? 1 : 0
  );
  const targetDeviation = deviations.length
    ? (deviations.reduce((a, b) => a + b, 0) / deviations.length) * 100
    : 0;

  const suggestions: string[] = [];

  // Targets the month can't satisfy, whatever the schedule.
  staff.forEach((s, i) => {
    const plan = plans[i];
    const exact = achievableHours(plan.targetHours);
    if (exact !== plan.targetHours) {
      suggestions.push(
        `${s.name}: ${plan.targetHours} saat, 24 ve 16 saatlik nöbetlerle tam yazılamaz (hedef 8'in katı olmalı, 8 hariç). En fazla ${exact} saat planlanır.`
      );
    }
    if (plan.plannedHours < exact) {
      suggestions.push(
        `${s.name}: hedef ${exact} saat, ancak müsait günleri ve nöbet ertesi izin kuralıyla bu ay en fazla ${plan.capacity} nöbet (${plan.plannedHours} saat) yazılabilir.`
      );
    }
  });

  const requiredSlots = days.length * minPerDay;
  const maxSlots = plans.reduce((sum, p) => sum + p.maxShifts, 0);
  if (maxSlots < requiredSlots) {
    suggestions.push(
      `Hedef saatlerle en fazla ${maxSlots} kişi-nöbet yazılabiliyor; ayın her gününe en az ${minPerDay} kişi için ${requiredSlots} gerekiyor. Personel ekleyin, hedef saatleri artırın veya minimum personel sayısını düşürün.`
    );
  }

  const understaffed = days.filter((d) => onDuty(d) < minPerDay);
  if (understaffed.length) {
    suggestions.push(
      `En az ${minPerDay} nöbetçi şartını sağlamayan günler: ${understaffed.map((d) => d.getDate()).join(', ')}.`
    );
  }

  // Hard-rule violations. The generator never produces these; they come from manual edits (or from leave,
  // staff or previous-month changes made after the roster was generated).
  const orphanDays = days.filter((d) => shiftByDay.get(dayKey(d))?.assignments.some((a) => !staffIds.has(a.staffId)));
  if (orphanDays.length) {
    suggestions.push(
      `Silinmiş personele ait nöbetler var: ${orphanDays.map(dayLabel).join(', ')}. Günü açıp kaldırabilirsiniz.`
    );
  }

  const workedPreviousDay = new Set(context.workedPreviousDay ?? []);
  for (const s of staff) {
    if (days.length && workedPreviousDay.has(s.id) && worksOn(s.id, days[0])) {
      suggestions.push(
        `${s.name}: önceki ayın son günü nöbetçiydi, ${dayLabel(days[0])} nöbeti art arda olur (nöbet ertesi gün boş olmalı).`
      );
    }
  }

  for (const s of staff) {
    const unavailable = days.filter((d) => worksOn(s.id, d) && isStaffUnavailable(s, d));
    if (unavailable.length) {
      suggestions.push(`${s.name} izinli/müsait değilken nöbete yazılmış: ${unavailable.map(dayLabel).join(', ')}.`);
    }
    const backToBack: string[] = [];
    for (let d = 1; d < days.length; d++) {
      if (worksOn(s.id, days[d - 1]) && worksOn(s.id, days[d])) {
        backToBack.push(`${days[d - 1].getDate()}-${dayLabel(days[d])}`);
      }
    }
    if (backToBack.length) {
      suggestions.push(`${s.name}: art arda nöbet (nöbet ertesi gün boş olmalı): ${backToBack.join(', ')}.`);
    }
  }

  for (let i = 0; i < staff.length; i++) {
    for (let j = i + 1; j < staff.length; j++) {
      const relation = notTogetherRelation(staff[i], staff[j]);
      if (relation === 'none') continue;
      const together = days.filter((d) => worksOn(staff[i].id, d) && worksOn(staff[j].id, d));
      if (!together.length) continue;
      suggestions.push(
        relation === 'strict'
          ? `${staff[i].name} ve ${staff[j].name} kesinlikle ayrı olmalı, ama birlikte nöbette: ${together.map(dayLabel).join(', ')}.`
          : `${staff[i].name} ve ${staff[j].name}, ayrı tutma tercihine rağmen ${together.length} nöbette birlikte.`
      );
    }
  }

  for (const st of staffStats) {
    const diff = st.totalHours - st.targetHours;
    if (diff !== 0) {
      suggestions.push(
        `${st.name}: ${st.totalHours} / ${st.targetHours} saat (${Math.abs(diff)} saat ${diff < 0 ? 'eksik' : 'fazla'}).`
      );
    }
  }

  const working = staffStats.filter((st) => st.totalHours > 0);
  if (working.length > 1) {
    const gap = (st: StaffStats) => st.workload - st.fairWorkload;
    const most = working.reduce((a, b) => (gap(b) > gap(a) ? b : a));
    const least = working.reduce((a, b) => (gap(b) < gap(a) ? b : a));
    if (gap(most) - gap(least) > WORKLOAD_TOLERANCE) {
      suggestions.push(
        `Gerçek yük dengesiz: ${most.name} adil payından ${formatHours(gap(most))} saat fazla, ${least.name} ${formatHours(-gap(least))} saat az çalışıyor. Kalabalık günler eşit paylaşılmamış.`
      );
    }
  }

  staffStats.forEach((st, i) => {
    if (!st.preferencesTotal) return;
    const ratio = st.preferencesSatisfied / st.preferencesTotal;
    if (staff[i].preferTogetherStrict && ratio < 1) {
      suggestions.push(
        `${st.name}: zorunlu birlikte çalışma tercihi ${st.preferencesSatisfied}/${st.preferencesTotal} nöbette sağlanabildi.`
      );
    } else if (!staff[i].preferTogetherStrict && ratio < 0.6) {
      suggestions.push(`${st.name}: birlikte çalışma tercihi düşük oranda sağlandı (%${Math.round(ratio * 100)}).`);
    }
  });

  if (!suggestions.length) {
    suggestions.push('Tüm kurallar sağlandı: herkes tam hedef saatinde ve her gün yeterli nöbetçi var.');
  }

  return { staffStats, targetDeviation, suggestions };
}
