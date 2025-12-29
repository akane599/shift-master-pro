export interface Staff {
  id: string;
  name: string;
  monthlyHours?: number; // Bireysel aylık mesai saati (yıllık izin vs. için)
  unavailableDates: DateRange[];
  preferTogether: string[]; // staff IDs
  preferNotTogether: string[]; // staff IDs
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface Shift {
  date: Date;
  staffIds: string[];
  duration: 16 | 24;
}

export interface ScheduleConfig {
  month: number;
  year: number;
  totalMonthlyHours: number;
  minStaffPerShift: number;
}

export interface ScheduleResult {
  shifts: Shift[];
  staffStats: StaffStats[];
  inequalityScore: number;
  suggestions: string[];
}

export interface StaffStats {
  staffId: string;
  name: string;
  totalHours: number;
  shiftCount: number;
  shift24Count: number;
  shift16Count: number;
  preferencesSatisfied: number;
  preferencesTotal: number;
}
