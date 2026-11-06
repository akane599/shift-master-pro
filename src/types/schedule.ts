export interface Staff {
  id: string;
  name: string;
  monthlyHours?: number; // Bireysel aylık mesai saati (yıllık izin vs. için)
  vacationDays: Date[]; // Yıllık izin günleri
  unavailableDates: DateRange[];
  preferTogether: string[]; // staff IDs
  preferNotTogether: string[]; // staff IDs
  preferTogetherStrict: boolean; // %100 birlikte olma zorunluluğu
  preferNotTogetherStrict: boolean; // %100 ayrı olma zorunluluğu
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface StaffAssignment {
  staffId: string;
  duration: 16 | 24;
}

export interface Shift {
  date: Date;
  assignments: StaffAssignment[];
}

export interface ScheduleConfig {
  month: number;
  year: number;
  /** Per-person default monthly hours, used when a staff member has no `monthlyHours` of their own. */
  totalMonthlyHours: number;
  minStaffPerShift: number;
}

/**
 * A roster saved for one month. Only the shifts are stored: stats and warnings are always recomputed from the
 * current staff with `evaluateSchedule`, so they can't go stale.
 */
export interface SavedRoster {
  month: number;
  year: number;
  shifts: Shift[];
  /** Seed the roster was generated with (manual edits come on top of it). */
  seed?: number;
}

/** Everything persisted in localStorage. */
export interface AppData {
  staff: Staff[];
  config: ScheduleConfig;
  /** Saved rosters by month key (`yyyy-MM`, see `monthKey`). */
  rosters: Record<string, SavedRoster>;
  /**
   * Hand-entered "worked the last day of the previous month" lists, keyed by the month they apply to.
   * Only used when that previous month has no saved roster to read it from.
   */
  carryIn: Record<string, string[]>;
}

export interface ScheduleResult {
  shifts: Shift[];
  staffStats: StaffStats[];
  /** Average deviation from each person's target hours, in percent (0 = everyone exactly on target). */
  targetDeviation: number;
  suggestions: string[];
}

export interface StaffStats {
  staffId: string;
  name: string;
  targetHours: number;
  totalHours: number;
  shiftCount: number;
  shift24Count: number;
  shift16Count: number;
  preferencesSatisfied: number;
  preferencesTotal: number;
}
