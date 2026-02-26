import { Staff, Shift, ScheduleConfig, ScheduleResult, StaffStats, DateRange, StaffAssignment } from '@/types/schedule';
import { addDays, isSameDay, isWithinInterval, getDaysInMonth, startOfMonth, format } from 'date-fns';

function isDateUnavailable(date: Date, unavailableDates: DateRange[], vacationDays: Date[]): boolean {
  const inRange = unavailableDates.some(range => 
    isWithinInterval(date, { start: range.start, end: range.end })
  );
  if (inRange) return true;
  return vacationDays.some(vd => isSameDay(date, vd));
}

function getStaffIdsFromShift(shift: Shift): string[] {
  return shift.assignments.map(a => a.staffId);
}

function getStaffHoursFromShift(staffId: string, shift: Shift): number {
  const assignment = shift.assignments.find(a => a.staffId === staffId);
  return assignment ? assignment.duration : 0;
}

function calculateStaffHours(staffId: string, shifts: Shift[]): number {
  return shifts.reduce((total, shift) => total + getStaffHoursFromShift(staffId, shift), 0);
}

function checkPreferNotTogether(staff1: Staff, staff2: Staff): { preferred: boolean; strict: boolean } {
  const preferred = staff1.preferNotTogether.includes(staff2.id) || staff2.preferNotTogether.includes(staff1.id);
  const strict = (staff1.preferNotTogether.includes(staff2.id) && staff1.preferNotTogetherStrict) ||
                 (staff2.preferNotTogether.includes(staff1.id) && staff2.preferNotTogetherStrict);
  return { preferred, strict };
}

function getTargetHours(s: Staff, defaultHours: number): number {
  return s.monthlyHours ?? defaultHours;
}

export function generateSchedule(
  staff: Staff[],
  config: ScheduleConfig
): ScheduleResult {
  const shifts: Shift[] = [];
  const daysInMonth = getDaysInMonth(new Date(config.year, config.month));
  const monthStart = startOfMonth(new Date(config.year, config.month));
  
  const staffHours: Map<string, number> = new Map();
  staff.forEach(s => staffHours.set(s.id, 0));
  
  const staffTargets: Map<string, number> = new Map();
  staff.forEach(s => staffTargets.set(s.id, getTargetHours(s, config.totalMonthlyHours)));
  
  const canWorkOnDate = (s: Staff, date: Date, workedYesterday: Set<string>): boolean => {
    if (isDateUnavailable(date, s.unavailableDates, s.vacationDays || [])) return false;
    if (workedYesterday.has(s.id)) return false;
    return true;
  };
  
  const canAddHours = (staffId: string, hours: number): boolean => {
    const current = staffHours.get(staffId) || 0;
    const target = staffTargets.get(staffId) || config.totalMonthlyHours;
    return current + hours <= target;
  };
  
  const getRemainingNeeded = (staffId: string): number => {
    const current = staffHours.get(staffId) || 0;
    const target = staffTargets.get(staffId) || config.totalMonthlyHours;
    return Math.max(0, target - current);
  };
  
  const smartPickDuration = (staffId: string): 16 | 24 | null => {
    const remaining = getRemainingNeeded(staffId);
    if (remaining >= 24 && (remaining - 24) !== 8) return 24;
    if (remaining >= 16 && (remaining - 16) !== 8) return 16;
    return null;
  };

  let assignedYesterday: Set<string> = new Set();

  // First pass: assign at least `minStaffPerShift` people to each day
  for (let day = 0; day < daysInMonth; day++) {
    const currentDate = addDays(monthStart, day);

    const pickDuration = (s: Staff): 16 | 24 | null => {
      return smartPickDuration(s.id);
    };

    const classifyConflict = (
      candidate: Staff,
      currentAssignments: StaffAssignment[]
    ): 'none' | 'soft' | 'strict' => {
      let hasSoft = false;
      for (const a of currentAssignments) {
        const other = staff.find(st => st.id === a.staffId);
        if (!other) continue;
        const notTogether = checkPreferNotTogether(candidate, other);
        if (!notTogether.preferred) continue;
        if (notTogether.strict) return 'strict';
        hasSoft = true;
      }
      return hasSoft ? 'soft' : 'none';
    };

    const candidates = staff
      .filter((s) => canWorkOnDate(s, currentDate, assignedYesterday))
      .sort((a, b) => getRemainingNeeded(b.id) - getRemainingNeeded(a.id));

    const assignments: StaffAssignment[] = [];
    const softPool: StaffAssignment[] = [];

    // 1) Prefer no-conflict picks
    for (const s of candidates) {
      if (assignments.length >= config.minStaffPerShift) break;

      const duration = pickDuration(s);
      if (!duration) continue;

      const conflict = classifyConflict(s, assignments);
      if (conflict === 'strict') continue;
      if (conflict === 'soft') {
        softPool.push({ staffId: s.id, duration });
        continue;
      }

      assignments.push({ staffId: s.id, duration });
    }

    // 2) If we still can't hit min staff, allow soft conflicts (but still respect strict)
    if (assignments.length < config.minStaffPerShift) {
      for (const a of softPool) {
        if (assignments.length >= config.minStaffPerShift) break;
        if (!assignments.some(x => x.staffId === a.staffId)) {
          assignments.push(a);
        }
      }
    }

    // If day can't be filled, leave it empty (and reset yesterday set)
    if (assignments.length < config.minStaffPerShift) {
      assignedYesterday = new Set();
      continue;
    }

    shifts.push({ date: currentDate, assignments });
    assignments.forEach((a) => {
      staffHours.set(a.staffId, (staffHours.get(a.staffId) || 0) + a.duration);
    });
    assignedYesterday = new Set(assignments.map((a) => a.staffId));
  }
  
  // Second pass: Fill remaining hours with smart duration selection
  // Sort by deficit descending so we prioritize those who need more hours
  const staffByDeficit = [...staff].sort((a, b) => getRemainingNeeded(b.id) - getRemainingNeeded(a.id));

  staffByDeficit.forEach(s => {
    let deficit = getRemainingNeeded(s.id);

    while (deficit >= 16) {
      const duration = smartPickDuration(s.id);
      if (!duration) break;

      let bestDay: Date | null = null;
      let bestDayPeopleCount = Infinity;

      for (let day = 0; day < daysInMonth; day++) {
        const currentDate = addDays(monthStart, day);

        if (isDateUnavailable(currentDate, s.unavailableDates, s.vacationDays || [])) continue;

        const existingShift = shifts.find(shift => isSameDay(shift.date, currentDate));

        const alreadyOnShift = existingShift
          ? existingShift.assignments.some(a => a.staffId === s.id)
          : false;
        if (alreadyOnShift) continue;

        // Cannot work if worked yesterday (post-shift rest rule)
        const yesterday = addDays(currentDate, -1);
        const workedYesterday = shifts.some(shift =>
          isSameDay(shift.date, yesterday) && shift.assignments.some(a => a.staffId === s.id)
        );
        if (workedYesterday) continue;

        // Cannot work if working tomorrow (because tomorrow would violate post-shift rest)
        const tomorrow = addDays(currentDate, 1);
        const hasTomorrowShift = shifts.some(shift =>
          isSameDay(shift.date, tomorrow) && shift.assignments.some(a => a.staffId === s.id)
        );
        if (hasTomorrowShift) continue;

        // Only check strict conflicts for existing shifts
        const hasConflict = existingShift
          ? existingShift.assignments.some(a => {
              const other = staff.find(st => st.id === a.staffId);
              if (!other) return false;
              return checkPreferNotTogether(s, other).strict;
            })
          : false;
        if (hasConflict) continue;

        // Prefer existing shifts over empty days (empty days as last resort)
        const peopleCount = existingShift
          ? existingShift.assignments.length
          : Number.MAX_SAFE_INTEGER;

        if (peopleCount < bestDayPeopleCount) {
          bestDay = currentDate;
          bestDayPeopleCount = peopleCount;
        }
      }

      if (bestDay) {
        const shiftIndex = shifts.findIndex(shift => isSameDay(shift.date, bestDay!));
        if (shiftIndex !== -1) {
          shifts[shiftIndex].assignments.push({ staffId: s.id, duration });
        } else {
          // Create a new shift for this day
          shifts.push({ date: bestDay, assignments: [{ staffId: s.id, duration }] });
        }
        staffHours.set(s.id, (staffHours.get(s.id) || 0) + duration);
        deficit = getRemainingNeeded(s.id);
      } else {
        break;
      }
    }
  });

  // Third pass: close remaining 8h gaps by upgrading 16h -> 24h assignments
  staff.forEach(s => {
    const remaining = getRemainingNeeded(s.id);
    if (remaining !== 8) return;

    for (const shift of shifts) {
      const assignment = shift.assignments.find(
        a => a.staffId === s.id && a.duration === 16
      );
      if (assignment && canAddHours(s.id, 8)) {
        assignment.duration = 24;
        staffHours.set(s.id, (staffHours.get(s.id) || 0) + 8);
        break;
      }
    }
  });

  const staffStats = calculateStats(staff, shifts);
  const inequalityScore = calculateInequalityScore(staffStats, staff, config.totalMonthlyHours);
  const suggestions = generateSuggestions(staffStats, inequalityScore, staff, config.totalMonthlyHours);

  const maxShiftsPerStaff = Math.ceil(daysInMonth / 2);
  const maxStaffSlots = staff.length * maxShiftsPerStaff;
  const requiredSlots = daysInMonth * config.minStaffPerShift;
  if (requiredSlots > maxStaffSlots) {
    const minStaffNeeded = Math.ceil(requiredSlots / maxShiftsPerStaff);
    suggestions.unshift(
      `Uyarı: Mevcut kurallarla (nöbet ertesi boş) ayın tüm günlerini ${config.minStaffPerShift}+ kişiyle doldurmak matematiksel olarak zor/İmkansız olabilir. Bu ay için en az ~${minStaffNeeded} personel gerekir.`
    );
  }

  return { shifts, staffStats, inequalityScore, suggestions };
}

function calculateStats(staff: Staff[], shifts: Shift[]): StaffStats[] {
  return staff.map(s => {
    const staffShifts = shifts.filter(shift => shift.assignments.some(a => a.staffId === s.id));
    const totalHours = staffShifts.reduce((sum, shift) => {
      const assignment = shift.assignments.find(a => a.staffId === s.id);
      return sum + (assignment?.duration || 0);
    }, 0);
    const shift24Count = staffShifts.filter(shift => {
      const assignment = shift.assignments.find(a => a.staffId === s.id);
      return assignment?.duration === 24;
    }).length;
    const shift16Count = staffShifts.filter(shift => {
      const assignment = shift.assignments.find(a => a.staffId === s.id);
      return assignment?.duration === 16;
    }).length;
    
    let preferencesSatisfied = 0;
    let preferencesTotal = 0;
    
    staffShifts.forEach(shift => {
      const staffIds = shift.assignments.map(a => a.staffId);
      s.preferTogether.forEach(partnerId => {
        preferencesTotal++;
        if (staffIds.includes(partnerId)) {
          preferencesSatisfied++;
        }
      });
    });
    
    return {
      staffId: s.id,
      name: s.name,
      totalHours,
      shiftCount: staffShifts.length,
      shift24Count,
      shift16Count,
      preferencesSatisfied,
      preferencesTotal
    };
  });
}

function calculateInequalityScore(stats: StaffStats[], staff: Staff[], defaultTargetHours: number): number {
  if (stats.length === 0) return 0;
  
  const deviations = stats.map(s => {
    const staffMember = staff.find(st => st.id === s.staffId);
    const target = staffMember?.monthlyHours ?? defaultTargetHours;
    return Math.abs(s.totalHours - target);
  });
  
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  const maxDeviation = Math.max(...deviations);
  
  return (avgDeviation * 0.5 + maxDeviation * 0.5);
}

function generateSuggestions(stats: StaffStats[], score: number, staff: Staff[], defaultTargetHours: number): string[] {
  const suggestions: string[] = [];
  
  stats.forEach(s => {
    const staffMember = staff.find(st => st.id === s.staffId);
    const target = staffMember?.monthlyHours ?? defaultTargetHours;
    const diff = Math.abs(s.totalHours - target);
    
    if (diff > 24) {
      if (s.totalHours > target) {
        suggestions.push(`${s.name} hedef saatinden ${s.totalHours - target} saat fazla çalışıyor.`);
      } else {
        suggestions.push(`${s.name} hedef saatine ${target - s.totalHours} saat eksik.`);
      }
    }
  });
  
  if (score > 20) {
    suggestions.push("Eşitsizlik skoru yüksek. Bazı kişilerin müsaitlik kısıtlamalarını gevşetmeyi düşünün.");
  }
  
  const lowSatisfaction = stats.filter(s => s.preferencesTotal > 0 && (s.preferencesSatisfied / s.preferencesTotal) < 0.5);
  if (lowSatisfaction.length > 0) {
    suggestions.push(`${lowSatisfaction.map(s => s.name).join(', ')} için birlikte çalışma tercihleri düşük oranda karşılandı.`);
  }
  
  if (suggestions.length === 0) {
    suggestions.push("Dağılım dengeli görünüyor. Hedef saatler tutturuldu!");
  }
  
  return suggestions;
}
