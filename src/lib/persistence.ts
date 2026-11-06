import { format, startOfDay } from 'date-fns';
import type { AppData, DateRange, SavedRoster, ScheduleConfig, Shift, Staff, StaffAssignment } from '@/types/schedule';
import { monthKey } from './scheduleRules';

/**
 * localStorage persistence. Dates are stored as local `yyyy-MM-dd` strings and read back as local midnight,
 * so a picked day never moves with the time zone. Every record is checked on its own: a bad record is dropped
 * (and reported) instead of taking the rest of the data with it, and the raw text is kept under a backup key.
 */

export const STORAGE_KEY = 'hospital-shift-scheduler-data';
export const BACKUP_KEY_PREFIX = 'hospital-shift-scheduler-backup-';
const VERSION = 2;

export function defaultConfig(now = new Date()): ScheduleConfig {
  return { month: now.getMonth(), year: now.getFullYear(), totalMonthlyHours: 160, minStaffPerShift: 2 };
}

export function emptyAppData(now = new Date()): AppData {
  return { staff: [], config: defaultConfig(now), rosters: {}, carryIn: {} };
}

export const toDateOnly = (d: Date) => format(d, 'yyyy-MM-dd');

/**
 * A stored date as a local calendar day, or null if it isn't one.
 * - `yyyy-MM-dd` (current format): that local day.
 * - Full ISO timestamp (saves before 2026-01-01 used `JSON.stringify(Date)`, i.e. UTC): converted back to an
 *   instant and then to the local day. Taking the first 10 characters instead would move every date one day
 *   earlier in UTC+ zones such as Turkey (local midnight 31 Dec = 2025-12-30T21:00Z).
 */
export function parseStoredDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : startOfDay(value);
  if (typeof value !== 'string') return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [y, m, d] = dateOnly.slice(1).map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? null : startOfDay(instant);
  }
  return null;
}

// ---------- serialising ----------

export function serializeAppData(data: AppData): string {
  const rosters: Record<string, unknown> = {};
  for (const [key, roster] of Object.entries(data.rosters)) {
    rosters[key] = {
      ...roster,
      shifts: roster.shifts.map((s) => ({ date: toDateOnly(s.date), assignments: s.assignments })),
    };
  }
  return JSON.stringify({
    version: VERSION,
    staff: data.staff.map((s) => ({
      ...s,
      vacationDays: s.vacationDays.map(toDateOnly),
      unavailableDates: s.unavailableDates.map((r) => ({ start: toDateOnly(r.start), end: toDateOnly(r.end) })),
    })),
    config: data.config,
    rosters,
    carryIn: data.carryIn,
  });
}

// ---------- parsing ----------

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

class Problems {
  readonly list: string[] = [];
  add(message: string) {
    if (!this.list.includes(message)) this.list.push(message);
  }
}

/** Array field; missing → [], anything else that isn't an array → [] plus a problem. */
function arrayField(value: unknown, problems: Problems, what: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value !== undefined && value !== null) problems.add(`${what} okunamadı.`);
  return [];
}

function stringList(value: unknown, problems: Problems, what: string): string[] {
  return arrayField(value, problems, what).filter((v): v is string => typeof v === 'string');
}

function parseDates(value: unknown, problems: Problems, who: string): Date[] {
  const dates: Date[] = [];
  for (const raw of arrayField(value, problems, `${who}: izin günleri`)) {
    const date = parseStoredDate(raw);
    if (date) dates.push(date);
    else problems.add(`${who}: okunamayan bir izin günü atlandı.`);
  }
  return dates;
}

function parseRanges(value: unknown, problems: Problems, who: string): DateRange[] {
  const ranges: DateRange[] = [];
  for (const raw of arrayField(value, problems, `${who}: müsait olmama aralıkları`)) {
    const start = isRecord(raw) ? parseStoredDate(raw.start) : null;
    const end = isRecord(raw) ? parseStoredDate(raw.end) : null;
    if (start && end) ranges.push({ start, end });
    else problems.add(`${who}: okunamayan bir müsait olmama aralığı atlandı.`);
  }
  return ranges;
}

function parseStaff(value: unknown, problems: Problems): Staff[] {
  const staff: Staff[] = [];
  const seen = new Set<string>();
  for (const raw of arrayField(value, problems, 'Personel listesi')) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || seen.has(raw.id)) {
      problems.add('Okunamayan bir personel kaydı atlandı.');
      continue;
    }
    seen.add(raw.id);
    const who = raw.name || 'Personel';
    staff.push({
      id: raw.id,
      name: raw.name,
      monthlyHours: isFiniteNumber(raw.monthlyHours) ? raw.monthlyHours : undefined,
      vacationDays: parseDates(raw.vacationDays, problems, who),
      unavailableDates: parseRanges(raw.unavailableDates, problems, who),
      preferTogether: stringList(raw.preferTogether, problems, `${who}: birlikte tercihleri`),
      preferNotTogether: stringList(raw.preferNotTogether, problems, `${who}: ayrı tercihleri`),
      preferTogetherStrict: raw.preferTogetherStrict === true,
      preferNotTogetherStrict: raw.preferNotTogetherStrict === true,
    });
  }
  return staff;
}

function parseConfig(value: unknown, problems: Problems, now: Date): ScheduleConfig {
  const config = defaultConfig(now);
  if (value === undefined || value === null) return config;
  if (!isRecord(value)) {
    problems.add('Ayarlar okunamadı, varsayılanlar kullanıldı.');
    return config;
  }
  const take = <K extends keyof ScheduleConfig>(key: K, valid: (v: unknown) => v is ScheduleConfig[K]) => {
    if (value[key] === undefined) return;
    if (valid(value[key])) config[key] = value[key] as ScheduleConfig[K];
    else problems.add('Ayarlardan bazıları okunamadı, varsayılan değer kullanıldı.');
  };
  take('month', (v): v is number => isInt(v, 0, 11));
  take('year', (v): v is number => isInt(v, 1970, 9999));
  take('totalMonthlyHours', (v): v is number => isFiniteNumber(v) && v >= 0);
  take('minStaffPerShift', (v): v is number => isInt(v, 0, 1000));
  return config;
}

function parseAssignments(value: unknown, problems: Problems): StaffAssignment[] {
  const assignments: StaffAssignment[] = [];
  for (const raw of arrayField(value, problems, 'Bir nöbet günü')) {
    if (isRecord(raw) && typeof raw.staffId === 'string' && (raw.duration === 16 || raw.duration === 24)) {
      if (!assignments.some((a) => a.staffId === raw.staffId)) assignments.push({ staffId: raw.staffId, duration: raw.duration });
    } else {
      problems.add('Kayıtlı çizelgede okunamayan bir atama atlandı.');
    }
  }
  return assignments;
}

function parseRosters(value: unknown, problems: Problems): Record<string, SavedRoster> {
  const rosters: Record<string, SavedRoster> = {};
  if (value === undefined || value === null) return rosters;
  if (!isRecord(value)) {
    problems.add('Kayıtlı çizelgeler okunamadı.');
    return rosters;
  }
  for (const raw of Object.values(value)) {
    if (!isRecord(raw) || !isInt(raw.month, 0, 11) || !isInt(raw.year, 1970, 9999)) {
      problems.add('Okunamayan bir kayıtlı çizelge atlandı.');
      continue;
    }
    const ref = { month: raw.month, year: raw.year };
    const shifts: Shift[] = [];
    for (const rawShift of arrayField(raw.shifts, problems, 'Kayıtlı çizelge')) {
      const date = isRecord(rawShift) ? parseStoredDate(rawShift.date) : null;
      if (!date || date.getMonth() !== ref.month || date.getFullYear() !== ref.year) {
        problems.add('Kayıtlı çizelgede okunamayan bir gün atlandı.');
        continue;
      }
      const assignments = parseAssignments((rawShift as Json).assignments, problems);
      if (assignments.length && !shifts.some((s) => s.date.getTime() === date.getTime())) shifts.push({ date, assignments });
    }
    shifts.sort((a, b) => a.date.getTime() - b.date.getTime());
    rosters[monthKey(ref)] = { ...ref, shifts, seed: isFiniteNumber(raw.seed) ? raw.seed : undefined };
  }
  return rosters;
}

function parseCarryIn(value: unknown, problems: Problems): Record<string, string[]> {
  const carryIn: Record<string, string[]> = {};
  if (value === undefined || value === null) return carryIn;
  if (!isRecord(value)) {
    problems.add('Önceki ay bilgisi okunamadı.');
    return carryIn;
  }
  for (const [key, ids] of Object.entries(value)) {
    if (/^\d{4}-\d{2}$/.test(key)) carryIn[key] = stringList(ids, problems, 'Önceki ay bilgisi');
  }
  return carryIn;
}

export interface LoadResult {
  data: AppData;
  /** Turkish descriptions of what couldn't be read (empty when everything loaded cleanly). */
  problems: string[];
}

/** Parses saved text. Never throws: unreadable parts fall back to defaults and are listed in `problems`. */
export function parseAppData(raw: string | null, now = new Date()): LoadResult {
  if (raw === null) return { data: emptyAppData(now), problems: [] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { data: emptyAppData(now), problems: ['Kayıtlı veri okunamadı.'] };
  }
  if (!isRecord(json)) return { data: emptyAppData(now), problems: ['Kayıtlı veri okunamadı.'] };
  const problems = new Problems();
  const data: AppData = {
    staff: parseStaff(json.staff, problems),
    config: parseConfig(json.config, problems, now),
    rosters: parseRosters(json.rosters, problems),
    carryIn: parseCarryIn(json.carryIn, problems),
  };
  return { data, problems: problems.list };
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export interface LoadOutcome extends LoadResult {
  /** Where the original text was copied when something couldn't be read. */
  backupKey: string | null;
}

/** Loads saved data. If anything couldn't be read, the original text is first copied to a backup key. */
export function loadAppData(storage: Storage | undefined = browserStorage(), now = new Date()): LoadOutcome {
  let raw: string | null = null;
  try {
    raw = storage ? storage.getItem(STORAGE_KEY) : null;
  } catch {
    return { data: emptyAppData(now), problems: ['Tarayıcı depolamasına erişilemiyor; veriler kaydedilmeyecek.'], backupKey: null };
  }
  const result = parseAppData(raw, now);
  let backupKey: string | null = null;
  if (result.problems.length && raw !== null) {
    try {
      backupKey = `${BACKUP_KEY_PREFIX}${now.getTime()}`;
      storage.setItem(backupKey, raw);
    } catch {
      backupKey = null;
    }
  }
  return { ...result, backupKey };
}

/** Saves; returns false if the browser refused (storage disabled or full). */
export function saveAppData(data: AppData, storage: Storage | undefined = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, serializeAppData(data));
    return true;
  } catch {
    return false;
  }
}
