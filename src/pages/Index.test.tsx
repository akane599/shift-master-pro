// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Index from '@/pages/Index';
import { ScheduleView } from '@/components/ScheduleView';
import { generateSchedule } from '@/lib/scheduleGenerator';
import { BACKUP_KEY_PREFIX, STORAGE_KEY, serializeAppData } from '@/lib/persistence';
import { staffOnDay } from '@/lib/scheduleRules';
import { formatHours } from '@/lib/scheduleStats';
import type { ScheduleConfig, Staff } from '@/types/schedule';

// Node 22+ has its own localStorage global, which shadows jsdom's; use jsdom's.
const jsdomWindow = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: jsdomWindow.localStorage });

beforeAll(() => {
  // What Radix needs and jsdom doesn't have.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const person = (id: string, name: string): Staff => ({
  id,
  name,
  vacationDays: [],
  unavailableDates: [],
  preferTogether: [],
  preferNotTogether: [],
  preferTogetherStrict: false,
  preferNotTogetherStrict: false,
});
const six = ['Ayşe', 'Burak', 'Cem', 'Deniz', 'Elif', 'Fatma'].map((n, i) => person(String.fromCharCode(97 + i), n));
const nameOf = (id: string) => six.find((s) => s.id === id)!.name;
const NOV: ScheduleConfig = { month: 10, year: 2026, totalMonthlyHours: 168, minStaffPerShift: 2 };

/** Calendar cell of a day number (cells start with the day number). */
const dayCell = (day: number) =>
  [...document.querySelectorAll<HTMLElement>('div.aspect-square')].find((c) => c.querySelector('span')?.textContent === String(day))!;
const calendarText = () => [...document.querySelectorAll('div.aspect-square')].map((c) => c.textContent).join('|');
const openTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole('tab', { name }));
const checkboxStates = () => within(screen.getByRole('dialog')).getAllByRole('checkbox').map((c) => c.getAttribute('aria-checked'));

function saveNovemberRoster(config: ScheduleConfig = NOV) {
  const november = generateSchedule(six, NOV, { seed: 1 });
  localStorage.setItem(
    STORAGE_KEY,
    serializeAppData({ staff: six, config, rosters: { '2026-11': { month: 10, year: 2026, shifts: november.shifts, seed: 1 } }, carryIn: {} })
  );
  return november;
}

describe('ShiftEditDialog (via ScheduleView)', () => {
  it('forgets cancelled changes when the same day is reopened', () => {
    const result = generateSchedule(six, NOV, { seed: 1 });
    const onShiftsChange = vi.fn();
    render(<ScheduleView result={result} staff={six} config={NOV} onShiftsChange={onShiftsChange} />);

    fireEvent.click(dayCell(5));
    const before = checkboxStates();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getAllByRole('checkbox')[before.indexOf('false')]);
    expect(checkboxStates()).not.toEqual(before);
    fireEvent.click(within(dialog).getByRole('button', { name: 'İptal' }));

    fireEvent.click(dayCell(5));
    expect(checkboxStates()).toEqual(before);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Kaydet' }));
    expect(onShiftsChange).toHaveBeenCalledWith(result.shifts);
  });

  it('lists assignments of deleted staff so they can be removed', () => {
    const result = generateSchedule(six, NOV, { seed: 1 });
    const [gone, kept] = staffOnDay(result.shifts, new Date(2026, 10, 5));
    const onShiftsChange = vi.fn();
    render(<ScheduleView result={result} staff={six.filter((s) => s.id !== gone)} config={NOV} onShiftsChange={onShiftsChange} />);

    fireEvent.click(dayCell(5));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText(/Silinmiş personel/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    const saved = onShiftsChange.mock.calls[0][0];
    expect(staffOnDay(saved, new Date(2026, 10, 5))).toEqual([kept]);
  });
});

describe('ScheduleView stats', () => {
  it('shows each person\'s real workload and the gap to a fair share', () => {
    const result = generateSchedule(six, NOV, { seed: 1 });
    render(<ScheduleView result={result} staff={six} config={NOV} />);
    expect(screen.getByRole('columnheader', { name: 'Gerçek Yük' })).toBeTruthy();
    const first = result.staffStats[0];
    const row = screen.getByRole('row', { name: new RegExp(`^${first.name}`) });
    expect(within(row).getByText(formatHours(first.workload))).toBeTruthy();
  });
});

describe('StaffManager', () => {
  it('adds a person when crypto.randomUUID is missing (plain HTTP from a phone)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    render(<Index />);

    fireEvent.change(screen.getByPlaceholderText('İsim girin...'), { target: { value: 'Ayşe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));

    expect(screen.getByText('Ayşe')).toBeTruthy();
    expect((screen.getByPlaceholderText('İsim girin...') as HTMLInputElement).value).toBe('');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).staff.map((s: Staff) => s.name)).toEqual(['Ayşe']);
  });
});

describe('Index persistence', () => {
  it('keeps the roster, including manual edits, across a reload', () => {
    localStorage.setItem(STORAGE_KEY, serializeAppData({ staff: six, config: NOV, rosters: {}, carryIn: {} }));
    const first = render(<Index />);
    fireEvent.click(screen.getByRole('button', { name: /Oluştur/ }));
    expect(screen.getByText('Personel İstatistikleri')).toBeTruthy();

    // Manual edit: clear day 7.
    fireEvent.click(dayCell(7));
    for (const box of within(screen.getByRole('dialog')).getAllByRole('checkbox')) {
      if (box.getAttribute('aria-checked') === 'true') fireEvent.click(box);
    }
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Kaydet' }));
    const shown = calendarText();
    first.unmount();

    render(<Index />);
    openTab(/Çizelge/);
    expect(calendarText()).toBe(shown);
    expect(dayCell(7).textContent).toBe('7');
  });

  it('shows the roster of the selected month only', () => {
    saveNovemberRoster({ ...NOV, month: 11 });
    render(<Index />);
    openTab(/Çizelge/);
    expect(screen.getByText(/Aralık 2026 için kayıtlı çizelge yok/)).toBeTruthy();
    expect(screen.queryByText('Personel İstatistikleri')).toBeNull();
  });

  it('keeps November\'s last-day staff off 1 December', () => {
    const november = saveNovemberRoster({ ...NOV, month: 11 });
    const lastDay = staffOnDay(november.shifts, new Date(2026, 10, 30)).map(nameOf);
    render(<Index />);

    openTab(/Ayarlar/);
    expect(screen.getByText(/Kayıtlı çizelgeye göre 30 Kasım 2026 nöbetçileri/)).toBeTruthy();
    for (const name of lastDay) expect(screen.getByText(name)).toBeTruthy();

    // A seed where generating December without the carry-in would put a 30 November nurse on 1 December.
    vi.spyOn(Math, 'random').mockReturnValue(1 / 41);
    fireEvent.click(screen.getByRole('button', { name: /Oluştur/ }));
    const firstDecember = dayCell(1).textContent!;
    for (const name of lastDay) expect(firstDecember).not.toContain(name);
  });

  it('asks before overwriting a saved roster', () => {
    saveNovemberRoster();
    render(<Index />);
    openTab(/Çizelge/);
    const before = calendarText();
    fireEvent.click(screen.getByRole('button', { name: /Oluştur/ }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByText(/Kasım 2026 çizelgesi yeniden oluşturulsun mu/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Vazgeç' }));
    expect(calendarText()).toBe(before);
  });

  it('does not wipe saved data when one record is malformed, and keeps a backup', () => {
    const raw = JSON.stringify({
      staff: [{ ...person('a', 'Ayşe'), vacationDays: ['2026-11-03'] }, { id: 'b', name: 'Burak', vacationDays: { 0: '2026-11-04' } }],
      config: { month: 10, year: 2026, totalMonthlyHours: 120, minStaffPerShift: 3 },
    });
    localStorage.setItem(STORAGE_KEY, raw);
    render(<Index />);

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.staff.map((s: Staff) => s.name)).toEqual(['Ayşe', 'Burak']);
    expect(saved.staff[0].vacationDays).toEqual(['2026-11-03']);
    expect(saved.config).toEqual({ month: 10, year: 2026, totalMonthlyHours: 120, minStaffPerShift: 3 });
    const backups = Object.keys(localStorage).filter((k) => k.startsWith(BACKUP_KEY_PREFIX));
    expect(backups).toHaveLength(1);
    expect(localStorage.getItem(backups[0])).toBe(raw);
  });
});
