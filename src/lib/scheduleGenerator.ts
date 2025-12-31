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
  
  // Track who worked yesterday
  let assignedYesterday: Set<string> = new Set();
  
  // First pass: Assign 24-hour shifts to fill most of the hours
  for (let day = 0; day < daysInMonth; day++) {
    const currentDate = addDays(monthStart, day);
    const availableStaff = getAvailableStaff(currentDate, staff, assignedYesterday);
    
    // Filter to staff who still need hours
    const staffNeedingHours = availableStaff.filter(s => {
      const current = staffHours.get(s.id) || 0;
      const target = getTargetHours(s, config.totalMonthlyHours);
      return current + 24 <= target; // Can fit a 24-hour shift
    });
    
    if (staffNeedingHours.length < config.minStaffPerShift) {
      // Try with staff who can at least fit a 16-hour shift
      const staffFor16 = availableStaff.filter(s => {
        const current = staffHours.get(s.id) || 0;
        const target = getTargetHours(s, config.totalMonthlyHours);
        return current + 16 <= target;
      });
      
      if (staffFor16.length >= config.minStaffPerShift) {
        const selectedStaff = selectStaffForShift(
          staffFor16,
          staff,
          staffHours,
          config.totalMonthlyHours,
          config.minStaffPerShift
        );
        
        shifts.push({
          date: currentDate,
          staffIds: selectedStaff.map(s => s.id),
          duration: 24
        });
        
        selectedStaff.forEach(s => {
          const currentHours = staffHours.get(s.id) || 0;
          staffHours.set(s.id, currentHours + 24);
        });
        
        assignedYesterday = new Set(selectedStaff.map(s => s.id));
      } else if (availableStaff.length > 0) {
        // Assign whoever is available with appropriate duration
        const selectedStaff = selectStaffForShift(
          availableStaff,
          staff,
          staffHours,
          config.totalMonthlyHours,
          Math.min(config.minStaffPerShift, availableStaff.length)
        );
        
        shifts.push({
          date: currentDate,
          staffIds: selectedStaff.map(s => s.id),
          duration: 24
        });
        
        selectedStaff.forEach(s => {
          const currentHours = staffHours.get(s.id) || 0;
          staffHours.set(s.id, currentHours + 24);
        });
        
        assignedYesterday = new Set(selectedStaff.map(s => s.id));
      } else {
        assignedYesterday = new Set();
      }
      continue;
    }
    
    // Select staff for this shift (prefer 3 people for better coverage)
    const targetStaffCount = Math.max(config.minStaffPerShift, 3);
    const selectedStaff = selectStaffForShift(
      staffNeedingHours,
      staff,
      staffHours,
      config.totalMonthlyHours,
      targetStaffCount
    );
    
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
    
    // Update yesterday's staff
    assignedYesterday = new Set(selectedStaff.map(s => s.id));
  }
  
  // Second pass: Add 16-hour shifts to reach exact target hours
  // Check who needs more hours to reach their target
  const hoursDeficit: { staffId: string; deficit: number; staff: Staff }[] = [];
  staff.forEach(s => {
    const current = staffHours.get(s.id) || 0;
    const target = getTargetHours(s, config.totalMonthlyHours);
    const deficit = target - current;
    if (deficit > 0) {
      hoursDeficit.push({ staffId: s.id, deficit, staff: s });
    }
  });
  
  // Sort by deficit (largest first)
  hoursDeficit.sort((a, b) => b.deficit - a.deficit);
  
  // Try to add 16-hour shifts to days where we have only 2 people (to make it 3)
  for (const { staffId, deficit, staff: targetStaff } of hoursDeficit) {
    if (deficit < 16) continue; // Can't fit even one 16-hour shift
    
    let shiftsToAdd = Math.floor(deficit / 16);
    
    for (let day = 0; day < daysInMonth && shiftsToAdd > 0; day++) {
      const currentDate = addDays(monthStart, day);
      const existingShift = shifts.find(s => isSameDay(s.date, currentDate));
      
      if (!existingShift) continue;
      
      // Check if this person is already on this shift
      if (existingShift.staffIds.includes(staffId)) continue;
      
      // Check if person is available on this date
      if (isDateUnavailable(currentDate, targetStaff.unavailableDates, targetStaff.vacationDays || [])) continue;
      
      // Check post-shift rule (didn't work yesterday)
      const yesterday = addDays(currentDate, -1);
      const yesterdayShift = shifts.find(s => isSameDay(s.date, yesterday));
      if (yesterdayShift && yesterdayShift.staffIds.includes(staffId)) continue;
      
      // Check prefer-not-together conflicts
      const hasConflict = existingShift.staffIds.some(otherId => {
        const other = staff.find(s => s.id === otherId);
        if (!other) return false;
        return checkPreferNotTogether(targetStaff, other).preferred;
      });
      if (hasConflict) continue;
      
      // Prefer days with only 2 people to boost to 3
      if (existingShift.staffIds.length === 2) {
        // Add a 16-hour shift for this person
        const shift16Index = shifts.findIndex(s => 
          isSameDay(s.date, currentDate) && s.duration === 16 && s.staffIds.includes(staffId)
        );
        
        if (shift16Index === -1) {
          shifts.push({
            date: currentDate,
            staffIds: [staffId],
            duration: 16
          });
          
          staffHours.set(staffId, (staffHours.get(staffId) || 0) + 16);
          shiftsToAdd--;
        }
      }
    }
    
    // Second priority: any day where person can work
    for (let day = 0; day < daysInMonth && shiftsToAdd > 0; day++) {
      const currentDate = addDays(monthStart, day);
      
      // Check if person is available on this date
      if (isDateUnavailable(currentDate, targetStaff.unavailableDates, targetStaff.vacationDays || [])) continue;
      
      // Check if already has a shift (16 or 24) on this day
      const alreadyOnShift = shifts.some(s => 
        isSameDay(s.date, currentDate) && s.staffIds.includes(staffId)
      );
      if (alreadyOnShift) continue;
      
      // Check post-shift rule
      const yesterday = addDays(currentDate, -1);
      const yesterdayShift = shifts.find(s => isSameDay(s.date, yesterday));
      if (yesterdayShift && yesterdayShift.staffIds.includes(staffId)) continue;
      
      // Check tomorrow rule (if we add today, can't work tomorrow)
      const tomorrow = addDays(currentDate, 1);
      const tomorrowShift = shifts.find(s => isSameDay(s.date, tomorrow));
      if (tomorrowShift && tomorrowShift.staffIds.includes(staffId)) {
        // Would conflict with tomorrow's shift
        continue;
      }
      
      // Add 16-hour shift
      shifts.push({
        date: currentDate,
        staffIds: [staffId],
        duration: 16
      });
      
      staffHours.set(staffId, (staffHours.get(staffId) || 0) + 16);
      shiftsToAdd--;
    }
  }
  
  // Third pass: Check for any remaining deficit and try to fill with more creative solutions
  staff.forEach(s => {
    const current = staffHours.get(s.id) || 0;
    const target = getTargetHours(s, config.totalMonthlyHours);
    const deficit = target - current;
    
    if (deficit >= 16) {
      // Still need hours - try harder
      for (let day = daysInMonth - 1; day >= 0 && deficit >= 16; day--) {
        const currentDate = addDays(monthStart, day);
        
        if (isDateUnavailable(currentDate, s.unavailableDates, s.vacationDays || [])) continue;
        
        const alreadyOnShift = shifts.some(shift => 
          isSameDay(shift.date, currentDate) && shift.staffIds.includes(s.id)
        );
        if (alreadyOnShift) continue;
        
        const yesterday = addDays(currentDate, -1);
        const yesterdayShifts = shifts.filter(shift => isSameDay(shift.date, yesterday));
        const workedYesterday = yesterdayShifts.some(shift => shift.staffIds.includes(s.id));
        if (workedYesterday) continue;
        
        shifts.push({
          date: currentDate,
          staffIds: [s.id],
          duration: 16
        });
        
        staffHours.set(s.id, (staffHours.get(s.id) || 0) + 16);
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
