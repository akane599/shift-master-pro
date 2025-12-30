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

export function generateSchedule(
  staff: Staff[],
  config: ScheduleConfig
): ScheduleResult {
  const shifts: Shift[] = [];
  const daysInMonth = getDaysInMonth(new Date(config.year, config.month));
  const monthStart = startOfMonth(new Date(config.year, config.month));
  
  // Calculate target hours per person (use individual hours if set, otherwise use default)
  const getTargetHours = (s: Staff) => s.monthlyHours ?? config.totalMonthlyHours;
  
  // Track hours per staff
  const staffHours: Map<string, number> = new Map();
  staff.forEach(s => staffHours.set(s.id, 0));
  
  // Track who worked yesterday
  let assignedYesterday: Set<string> = new Set();
  
  // Process each day of the month
  for (let day = 0; day < daysInMonth; day++) {
    const currentDate = addDays(monthStart, day);
    const availableStaff = getAvailableStaff(currentDate, staff, assignedYesterday);
    
    if (availableStaff.length < config.minStaffPerShift) {
      // Not enough staff, skip or assign whoever is available
      if (availableStaff.length > 0) {
        const selectedStaff = selectStaffForShift(
          availableStaff,
          staff,
          staffHours,
          config.totalMonthlyHours,
          config.minStaffPerShift
        );
        
        const duration = 24; // Prefer 24-hour shifts
        shifts.push({
          date: currentDate,
          staffIds: selectedStaff.map(s => s.id),
          duration
        });
        
        selectedStaff.forEach(s => {
          const currentHours = staffHours.get(s.id) || 0;
          staffHours.set(s.id, currentHours + duration);
        });
        
        assignedYesterday = new Set(selectedStaff.map(s => s.id));
      } else {
        assignedYesterday = new Set();
      }
      continue;
    }
    
    // Select staff for this shift
    const selectedStaff = selectStaffForShift(
      availableStaff,
      staff,
      staffHours,
      config.totalMonthlyHours,
      config.minStaffPerShift
    );
    
    // Determine shift duration (prefer 24)
    const duration = 24;
    
    shifts.push({
      date: currentDate,
      staffIds: selectedStaff.map(s => s.id),
      duration
    });
    
    // Update hours
    selectedStaff.forEach(s => {
      const currentHours = staffHours.get(s.id) || 0;
      staffHours.set(s.id, currentHours + duration);
    });
    
    // Update yesterday's staff
    assignedYesterday = new Set(selectedStaff.map(s => s.id));
  }
  
  // Calculate statistics
  const staffStats = calculateStats(staff, shifts);
  const inequalityScore = calculateInequalityScore(staffStats);
  const suggestions = generateSuggestions(staffStats, inequalityScore, staff);
  
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
  minStaff: number
): Staff[] {
  // Sort by percentage of target hours completed (ascending) to prioritize those with more room
  const sortedStaff = [...availableStaff].sort((a, b) => {
    const hoursA = staffHours.get(a.id) || 0;
    const hoursB = staffHours.get(b.id) || 0;
    const targetA = a.monthlyHours ?? defaultTargetHours;
    const targetB = b.monthlyHours ?? defaultTargetHours;
    const percentA = targetA > 0 ? hoursA / targetA : 1;
    const percentB = targetB > 0 ? hoursB / targetB : 1;
    return percentA - percentB;
  });
  
  const selected: Staff[] = [];
  
  // First, add staff with lowest hours
  for (const s of sortedStaff) {
    if (selected.length >= minStaff) break;
    
    // Check if this person conflicts with already selected (strict = always block, non-strict = block)
    const hasConflict = selected.some(sel => {
      const notTogether = checkPreferNotTogether(s, sel);
      return notTogether.preferred; // Both strict and non-strict block selection
    });
    if (hasConflict) continue;
    
    selected.push(s);
  }
  
  // Handle "prefer together" preferences
  for (const s of selected) {
    const preferredPartners = sortedStaff.filter(candidate => {
      if (selected.includes(candidate)) return false;
      
      const together = checkPreferTogether(s, candidate);
      if (!together.preferred) return false;
      
      // Check conflicts with already selected
      const hasConflict = selected.some(sel => checkPreferNotTogether(candidate, sel).preferred);
      if (hasConflict) return false;
      
      return true;
    });
    
    for (const partner of preferredPartners) {
      const together = checkPreferTogether(s, partner);
      
      // If strict, always add; if not strict, 60-70% chance
      if (together.strict || Math.random() < 0.65) {
        if (selected.length < minStaff + 1) {
          selected.push(partner);
        }
      }
    }
  }
  
  return selected.slice(0, Math.max(minStaff, selected.length));
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

function calculateInequalityScore(stats: StaffStats[]): number {
  if (stats.length === 0) return 0;
  
  const hours = stats.map(s => s.totalHours);
  const mean = hours.reduce((a, b) => a + b, 0) / hours.length;
  const variance = hours.reduce((sum, h) => sum + Math.pow(h - mean, 2), 0) / hours.length;
  const stdDev = Math.sqrt(variance);
  
  // Return coefficient of variation as percentage
  return mean > 0 ? (stdDev / mean) * 100 : 0;
}

function generateSuggestions(stats: StaffStats[], score: number, staff: Staff[]): string[] {
  const suggestions: string[] = [];
  
  if (score > 15) {
    suggestions.push("Eşitsizlik skoru yüksek. Bazı kişilerin müsaitlik kısıtlamalarını gevşetmeyi düşünün.");
  }
  
  const maxHours = Math.max(...stats.map(s => s.totalHours));
  const minHours = Math.min(...stats.map(s => s.totalHours));
  const diff = maxHours - minHours;
  
  if (diff > 48) {
    const maxPerson = stats.find(s => s.totalHours === maxHours);
    const minPerson = stats.find(s => s.totalHours === minHours);
    suggestions.push(`${maxPerson?.name} ile ${minPerson?.name} arasında ${diff} saat fark var. Manuel ayarlama yapabilirsiniz.`);
  }
  
  // Check preference satisfaction
  const lowSatisfaction = stats.filter(s => s.preferencesTotal > 0 && (s.preferencesSatisfied / s.preferencesTotal) < 0.5);
  if (lowSatisfaction.length > 0) {
    suggestions.push(`${lowSatisfaction.map(s => s.name).join(', ')} için birlikte çalışma tercihleri düşük oranda karşılandı.`);
  }
  
  if (suggestions.length === 0) {
    suggestions.push("Dağılım dengeli görünüyor. İyi bir çizelge oluşturuldu!");
  }
  
  return suggestions;
}
