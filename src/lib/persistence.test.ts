import { afterEach, describe, expect, it } from 'vitest';
import type { AppData } from '@/types/schedule';
import {
  BACKUP_KEY_PREFIX,
  STORAGE_KEY,
  emptyAppData,
  loadAppData,
  parseAppData,
  parseStoredDate,
  saveAppData,
  serializeAppData,
  toDateOnly,
} from './persistence';

const originalTz = process.env.TZ;
afterEach(() => {
  // Assigning undefined would store the string "undefined".
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** Node re-reads TZ when it changes, so dates created after this use the given zone. */
const inZone = (tz: string) => {
  process.env.TZ = tz;
};

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.has(key) ? this.items.get(key)! : null;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const NOW = new Date(2026, 10, 6);

describe('parseStoredDate', () => {
  for (const tz of ['Europe/Istanbul', 'Asia/Tokyo', 'UTC', 'America/New_York']) {
    it(`reads a legacy UTC ISO date as the day that was picked (${tz})`, () => {
      inZone(tz);
      const picked = new Date(2025, 11, 31); // what the date picker hands over: local midnight
      const legacy = JSON.parse(JSON.stringify(picked)) as string; // what saves before 2026-01-01 contained
      expect(toDateOnly(parseStoredDate(legacy)!)).toBe('2025-12-31');
    });

    it(`round-trips yyyy-MM-dd without moving the day (${tz})`, () => {
      inZone(tz);
      const d = parseStoredDate('2026-03-29')!; // DST change in Europe
      expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 29, 0]);
      expect(toDateOnly(d)).toBe('2026-03-29');
    });
  }

  it('rejects things that are not a calendar day', () => {
    expect(parseStoredDate('2026-02-31')).toBeNull();
    expect(parseStoredDate('03.11.2026')).toBeNull();
    expect(parseStoredDate('')).toBeNull();
    expect(parseStoredDate(null)).toBeNull();
    expect(parseStoredDate({ 0: '2026-11-04' })).toBeNull();
  });
});

describe('parseAppData', () => {
  const ayse = {
    id: 'a',
    name: 'Ayşe',
    vacationDays: ['2026-11-03'],
    unavailableDates: [{ start: '2026-11-10', end: '2026-11-12' }],
    preferTogether: [],
    preferNotTogether: [],
    preferTogetherStrict: false,
    preferNotTogetherStrict: false,
  };

  it('keeps valid records when another one is malformed, and reports the problem', () => {
    const raw = JSON.stringify({
      staff: [ayse, { id: 'b', name: 'Burak', vacationDays: { 0: '2026-11-04' } }, 'garbage'],
      config: { month: 10, year: 2026, totalMonthlyHours: 120, minStaffPerShift: 3 },
    });
    const { data, problems } = parseAppData(raw, NOW);
    expect(data.staff.map((s) => s.id)).toEqual(['a', 'b']);
    expect(data.staff[0].vacationDays.map(toDateOnly)).toEqual(['2026-11-03']);
    expect(data.staff[1].vacationDays).toEqual([]);
    expect(data.config).toEqual({ month: 10, year: 2026, totalMonthlyHours: 120, minStaffPerShift: 3 });
    expect(problems.length).toBeGreaterThan(0);
  });

  it('fills missing fields of old saves without complaining', () => {
    const { data, problems } = parseAppData(JSON.stringify({ staff: [{ id: 'a', name: 'Ayşe' }] }), NOW);
    expect(data.staff[0]).toMatchObject({ vacationDays: [], unavailableDates: [], preferTogether: [], preferTogetherStrict: false });
    expect(data.config.month).toBe(10);
    expect(data.rosters).toEqual({});
    expect(problems).toEqual([]);
  });

  it('falls back to defaults for unparseable text', () => {
    const { data, problems } = parseAppData('{not json', NOW);
    expect(data).toEqual(emptyAppData(NOW));
    expect(problems).toHaveLength(1);
  });

  it('round-trips staff, settings, rosters and carry-in', () => {
    inZone('Europe/Istanbul');
    const original: AppData = {
      staff: [
        {
          id: 'a',
          name: 'Ayşe',
          monthlyHours: 144,
          vacationDays: [new Date(2026, 10, 3)],
          unavailableDates: [{ start: new Date(2026, 10, 10), end: new Date(2026, 10, 12) }],
          preferTogether: ['b'],
          preferNotTogether: [],
          preferTogetherStrict: true,
          preferNotTogetherStrict: false,
        },
      ],
      config: { month: 10, year: 2026, totalMonthlyHours: 168, minStaffPerShift: 2 },
      rosters: {
        '2026-11': {
          month: 10,
          year: 2026,
          seed: 42,
          shifts: [{ date: new Date(2026, 10, 1), assignments: [{ staffId: 'a', duration: 24 }] }],
        },
      },
      carryIn: { '2026-11': ['a'] },
    };
    const { data, problems } = parseAppData(serializeAppData(original), NOW);
    expect(problems).toEqual([]);
    expect(data).toEqual(original);
  });

  it('drops roster days that fall outside the roster month or have bad assignments', () => {
    const raw = JSON.stringify({
      rosters: {
        '2026-11': {
          month: 10,
          year: 2026,
          shifts: [
            { date: '2026-11-02', assignments: [{ staffId: 'a', duration: 24 }, { staffId: 'b', duration: 8 }] },
            { date: '2026-12-01', assignments: [{ staffId: 'a', duration: 16 }] },
          ],
        },
      },
    });
    const { data, problems } = parseAppData(raw, NOW);
    expect(data.rosters['2026-11'].shifts).toEqual([{ date: new Date(2026, 10, 2), assignments: [{ staffId: 'a', duration: 24 }] }]);
    expect(problems.length).toBe(2);
  });
});

describe('loadAppData / saveAppData', () => {
  it('backs up the original text before anything is overwritten when part of it is unreadable', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ staff: [{ id: 'a', name: 'Ayşe' }, 42] });
    storage.setItem(STORAGE_KEY, raw);
    const loaded = loadAppData(storage, NOW);
    expect(loaded.data.staff).toHaveLength(1);
    expect(loaded.backupKey).toBe(`${BACKUP_KEY_PREFIX}${NOW.getTime()}`);
    expect(storage.getItem(loaded.backupKey!)).toBe(raw);
  });

  it('makes no backup for clean data', () => {
    const storage = new MemoryStorage();
    expect(saveAppData(emptyAppData(NOW), storage)).toBe(true);
    const loaded = loadAppData(storage, NOW);
    expect(loaded.problems).toEqual([]);
    expect(loaded.backupKey).toBeNull();
    expect(storage.length).toBe(1);
  });

  it('reports instead of throwing when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    } as unknown as Storage;
    expect(loadAppData(broken, NOW).problems).toHaveLength(1);
    expect(saveAppData(emptyAppData(NOW), broken)).toBe(false);
  });
});
