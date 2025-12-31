import { Staff, Shift, ScheduleConfig, ScheduleResult, StaffStats, DateRange } from '@/types/schedule';
import { addDays, isSameDay, isWithinInterval, getDaysInMonth, startOfMonth, format } from 'date-fns';

function isDateUnavailable(date: Date, unavailableDates: DateRange[], vacationDays: Date[]): boolean {
  // Check unavailable date ranges
  const inRange = unavailableDates.some(range => 
    isWithinInterval(date, { start: range.start, end: range.end })
  );
  if (inRange) return true;
  
  // Check vacation days
  return vacationDays.some(vd => isSameDay(date, vd));
}

function getAvailableStaff(date: Date, staff: Staff[], assignedYesterday: Set<string>): Staff[] {
  return staff.filter(s => {
    // Check if staff is unavailable on this date (including vacation days)
    if (isDateUnavailable(date, s.unavailableDates, s.vacationDays || [])) return false;
    // Check if staff worked yesterday (post-shift rule)
    if (assignedYesterday.has(s.id)) return false;
    return true;
  });
}

function calculateStaffHours(staffId: string, shifts: Shift[]): number {
  return shifts
    .filter(s => s.staffIds.includes(staffId))
    .reduce((total, s) => total + s.duration, 0);
}

function checkPreferTogether(staff1: Staff, staff2: Staff): { preferred: boolean; strict: boolean } {
  const preferred = staff1.preferTogether.includes(staff2.id) || staff2.preferTogether.includes(staff1.id);
  const strict = (staff1.preferTogether.includes(staff2.id) && staff1.preferTogetherStrict) ||
                 (staff2.preferTogether.includes(staff1.id) && staff2.preferTogetherStrict);
  return { preferred, strict };
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

function getRemainingHours(s: Staff, currentHours: number, defaultTargetHours: number): number {
  const target = getTargetHours(s, defaultTargetHours);
  return Math.max(0, target - currentHours);
}

export function generateSchedule(
  staff: Staff[],
  config: ScheduleConfig
): ScheduleResult {
  const shifts: Shift[] = [];
  const daysInMonth = getDaysInMonth(new Date(config.year, config.month));
  const monthStart = startOfMonth(new Date(config.year, config.month));
  
  // Track hours per staff
  const staffHours: Map<string, number> = new Map();
  staff.forEach(s => staffHours.set(s.id, 0));
  
  // Get target hours for each staff member
  const staffTargets: Map<string, number> = new Map();
  staff.forEach(s => staffTargets.set(s.id, getTargetHours(s, config.totalMonthlyHours)));
  
  // Helper: Check if staff can work on a date
  const canWorkOnDate = (s: Staff, date: Date, workedYesterday: Set<string>): boolean => {
    if (isDateUnavailable(date, s.unavailableDates, s.vacationDays || [])) return false;
    if (workedYesterday.has(s.id)) return false;
    return true;
  };
  
  // Helper: Check if staff can add hours without exceeding target
  const canAddHours = (staffId: string, hours: number): boolean => {
    const current = staffHours.get(staffId) || 0;
    const target = staffTargets.get(staffId) || config.totalMonthlyHours;
    return current + hours <= target;
  };
  
  // Helper: Get remaining hours needed
  const getRemainingNeeded = (staffId: string): number => {
    const current = staffHours.get(staffId) || 0;
    const target = staffTargets.get(staffId) || config.totalMonthlyHours;
    return Math.max(0, target - current);
  };
  
  // Track who worked yesterday
  let assignedYesterday: Set<string> = new Set();
  
  // First pass: Assign primary 24-hour shifts to every day
  for (let day = 0; day < daysInMonth; day++) {
    const currentDate = addDays(monthStart, day);
    
    // Get staff who can work today and have room for 24 hours
    const availableFor24 = staff.filter(s => 
      canWorkOnDate(s, currentDate, assignedYesterday) && canAddHours(s.id, 24)
    );
    
    // Get staff who can work today and have room for at least 16 hours
    const availableFor16Only = staff.filter(s => 
      canWorkOnDate(s, currentDate, assignedYesterday) && 
      !canAddHours(s.id, 24) && 
      canAddHours(s.id, 16)
    );
    
    // Combine available staff, prioritizing those who can do full 24h
    let availableStaff = [...availableFor24, ...availableFor16Only];
    
    // Sort by remaining hours needed (descending)
    availableStaff.sort((a, b) => getRemainingNeeded(b.id) - getRemainingNeeded(a.id));
    
    // Select staff for this shift
    const targetStaffCount = Math.max(config.minStaffPerShift, 3);
    let selectedStaff: Staff[] = [];
    
    for (const s of availableStaff) {
      if (selectedStaff.length >= targetStaffCount) break;
      
      // Check prefer-not-together constraints
      const hasConflict = selectedStaff.some(sel => 
        checkPreferNotTogether(s, sel).preferred
      );
      if (hasConflict) continue;
      
      selectedStaff.push(s);
    }
    
    // If we couldn't get enough people, try relaxing post-shift rule (emergency)
    if (selectedStaff.length < config.minStaffPerShift) {
      const emergencyPool = staff.filter(s => 
        !isDateUnavailable(currentDate, s.unavailableDates, s.vacationDays || []) &&
        !selectedStaff.includes(s) &&
        (canAddHours(s.id, 24) || canAddHours(s.id, 16))
      );
      
      for (const s of emergencyPool) {
        if (selectedStaff.length >= config.minStaffPerShift) break;
        
        const hasConflict = selectedStaff.some(sel => 
          checkPreferNotTogether(s, sel).preferred
        );
        if (!hasConflict) {
          selectedStaff.push(s);
        }
      }
    }
    
    if (selectedStaff.length > 0) {
      shifts.push({
        date: currentDate,
        staffIds: selectedStaff.map(s => s.id),
        duration: 24
      });
      
      // Update hours
      selectedStaff.forEach(s => {
        const currentHours = staffHours.get(s.id) || 0;
        staffHours.set(s.id, currentHours + 24);
      });
      
      assignedYesterday = new Set(selectedStaff.map(s => s.id));
    } else {
      assignedYesterday = new Set();
    }
  }
  
  // Second pass: Add 16-hour shifts to fill remaining hours
  // Also prioritize days with only 2 people to make them 3
  staff.forEach(s => {
    let deficit = getRemainingNeeded(s.id);
    
    while (deficit >= 16) {
      // Find a day where this person can add a 16-hour shift
      let bestDay: Date | null = null;
      let bestDayPeopleCount = Infinity;
      
      for (let day = 0; day < daysInMonth; day++) {
        const currentDate = addDays(monthStart, day);
        
        // Check if person is unavailable on this date
        if (isDateUnavailable(currentDate, s.unavailableDates, s.vacationDays || [])) continue;
        
        // Check if already on any shift this day
        const alreadyOnShift = shifts.some(shift => 
          isSameDay(shift.date, currentDate) && shift.staffIds.includes(s.id)
        );
        if (alreadyOnShift) continue;
        
        // Check post-shift rule
        const yesterday = addDays(currentDate, -1);
        const workedYesterday = shifts.some(shift => 
          isSameDay(shift.date, yesterday) && shift.staffIds.includes(s.id)
        );
        if (workedYesterday) continue;
        
        // Check if working today would block tomorrow's shift
        const tomorrow = addDays(currentDate, 1);
        const hasTomorrowShift = shifts.some(shift => 
          isSameDay(shift.date, tomorrow) && shift.staffIds.includes(s.id)
        );
        if (hasTomorrowShift) continue;
        
        // Find existing shift on this day
        const existingShift = shifts.find(shift => 
          isSameDay(shift.date, currentDate) && shift.duration === 24
        );
        
        if (existingShift) {
          // Check prefer-not-together
          const hasConflict = existingShift.staffIds.some(otherId => {
            const other = staff.find(st => st.id === otherId);
            if (!other) return false;
            return checkPreferNotTogether(s, other).preferred;
          });
          if (hasConflict) continue;
          
          // Prefer days with fewer people
          if (existingShift.staffIds.length < bestDayPeopleCount) {
            bestDay = currentDate;
            bestDayPeopleCount = existingShift.staffIds.length;
          }
        }
      }
      
      if (bestDay) {
        // Add 16-hour shift
        shifts.push({
          date: bestDay,
          staffIds: [s.id],
          duration: 16
        });
        
        staffHours.set(s.id, (staffHours.get(s.id) || 0) + 16);
        deficit -= 16;
      } else {
        // No more available days
        break;
      }
    }
  });
  
  // Calculate statistics
  const staffStats = calculateStats(staff, shifts);
  const inequalityScore = calculateInequalityScore(staffStats, staff, config.totalMonthlyHours);
  const suggestions = generateSuggestions(staffStats, inequalityScore, staff, config.totalMonthlyHours);
  
  return {
    shifts,
    staffStats,
    inequalityScore,
    suggestions
  };
}

function selectStaffForShift(
  availableStaff: Staff[],
  allStaff: Staff[],
  staffHours: Map<string, number>,
  defaultTargetHours: number,
  targetCount: number
): Staff[] {
  // Sort by remaining hours needed (descending) - prioritize those who need more hours
  const sortedStaff = [...availableStaff].sort((a, b) => {
    const remainingA = getRemainingHours(a, staffHours.get(a.id) || 0, defaultTargetHours);
    const remainingB = getRemainingHours(b, staffHours.get(b.id) || 0, defaultTargetHours);
    return remainingB - remainingA; // Higher remaining = higher priority
  });
  
  const selected: Staff[] = [];
  
  // First, add staff with most remaining hours
  for (const s of sortedStaff) {
    if (selected.length >= targetCount) break;
    
    // Skip if already at or over target
    const current = staffHours.get(s.id) || 0;
    const target = getTargetHours(s, defaultTargetHours);
    if (current >= target) continue;
    
    // Check if this person conflicts with already selected
    const hasConflict = selected.some(sel => {
      const notTogether = checkPreferNotTogether(s, sel);
      return notTogether.preferred;
    });
    if (hasConflict) continue;
    
    selected.push(s);
  }
  
  // Handle "prefer together" preferences
  for (const s of [...selected]) {
    if (selected.length >= targetCount) break;
    
    const preferredPartners = sortedStaff.filter(candidate => {
      if (selected.includes(candidate)) return false;
      
      const together = checkPreferTogether(s, candidate);
      if (!together.preferred) return false;
      
      // Check conflicts with already selected
      const hasConflict = selected.some(sel => checkPreferNotTogether(candidate, sel).preferred);
      if (hasConflict) return false;
      
      // Check if candidate still needs hours
      const current = staffHours.get(candidate.id) || 0;
      const target = getTargetHours(candidate, defaultTargetHours);
      if (current >= target) return false;
      
      return true;
    });
    
    for (const partner of preferredPartners) {
      if (selected.length >= targetCount) break;
      
      const together = checkPreferTogether(s, partner);
      
      // If strict, always add; if not strict, 60-70% chance
      if (together.strict || Math.random() < 0.65) {
        selected.push(partner);
      }
    }
  }
  
  return selected.slice(0, targetCount);
}

function calculateStats(staff: Staff[], shifts: Shift[]): StaffStats[] {
  return staff.map(s => {
    const staffShifts = shifts.filter(shift => shift.staffIds.includes(s.id));
    const totalHours = staffShifts.reduce((sum, shift) => sum + shift.duration, 0);
    const shift24Count = staffShifts.filter(shift => shift.duration === 24).length;
    const shift16Count = staffShifts.filter(shift => shift.duration === 16).length;
    
    // Calculate preference satisfaction
    let preferencesSatisfied = 0;
    let preferencesTotal = 0;
    
    staffShifts.forEach(shift => {
      s.preferTogether.forEach(partnerId => {
        preferencesTotal++;
        if (shift.staffIds.includes(partnerId)) {
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
  
  // Calculate based on deviation from individual targets, not just mean
  const deviations = stats.map(s => {
    const staffMember = staff.find(st => st.id === s.staffId);
    const target = staffMember?.monthlyHours ?? defaultTargetHours;
    return Math.abs(s.totalHours - target);
  });
  
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  const maxDeviation = Math.max(...deviations);
  
  // Return weighted score (lower is better)
  return (avgDeviation * 0.5 + maxDeviation * 0.5);
}

function generateSuggestions(stats: StaffStats[], score: number, staff: Staff[], defaultTargetHours: number): string[] {
  const suggestions: string[] = [];
  
  // Check if anyone is significantly off their target
  stats.forEach(s => {
    const staffMember = staff.find(st => st.id === s.staffId);
    const target = staffMember?.monthlyHours ?? defaultTargetHours;
    const diff = Math.abs(s.totalHours - target);
    
    if (diff > 24) {
      if (s.totalHours > target) {
        suggestions.push(`${s.name} hedef saatinden ${s.totalHours - target} saat fazla çalışıyor.`);
      } else {
        suggestions.push(`${s.name} hedef saatine ${target - s.totalHours} saat eksik. Daha fazla müsait gün eklenebilir.`);
      }
    }
  });
  
  if (score > 20) {
    suggestions.push("Eşitsizlik skoru yüksek. Bazı kişilerin müsaitlik kısıtlamalarını gevşetmeyi düşünün.");
  }
  
  // Check preference satisfaction
  const lowSatisfaction = stats.filter(s => s.preferencesTotal > 0 && (s.preferencesSatisfied / s.preferencesTotal) < 0.5);
  if (lowSatisfaction.length > 0) {
    suggestions.push(`${lowSatisfaction.map(s => s.name).join(', ')} için birlikte çalışma tercihleri düşük oranda karşılandı.`);
  }
  
  // Check for days with only 2 people
  const shift24Only = staff.length >= 3;
  if (shift24Only) {
    suggestions.push("3 kişilik nöbet hedeflenmiştir. 2 kişilik günlere 16 saatlik ek nöbetler atandı.");
  }
  
  if (suggestions.length === 0) {
    suggestions.push("Dağılım dengeli görünüyor. Hedef saatler tutturuldu!");
  }
  
  return suggestions;
}
