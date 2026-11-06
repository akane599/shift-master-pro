import { describe, expect, it } from 'vitest';
import type { ScheduleResult, Staff } from '@/types/schedule';
import { buildCsv, buildPrintHtml, csvCell, escapeHtml } from './exportUtils';
import { evaluateSchedule } from './scheduleStats';

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

const config = { month: 10, year: 2026, totalMonthlyHours: 48, minStaffPerShift: 1 };

function resultFor(staff: Staff[]): ScheduleResult {
  const shifts = [
    { date: new Date(2026, 10, 1), assignments: [{ staffId: staff[0].id, duration: 24 as const }] },
    { date: new Date(2026, 10, 3), assignments: [{ staffId: staff[1].id, duration: 16 as const }] },
  ];
  return { shifts, ...evaluateSchedule(staff, shifts, config) };
}

/** Minimal CSV reader for ';' with "" quoting, enough to count fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '"' && line[i + 1] === '"') {
      field += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === ';' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

describe('escapeHtml', () => {
  it('escapes all markup characters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
  });
});

describe('buildPrintHtml', () => {
  it('never emits a staff name as markup', () => {
    const payload = '<img src=x onerror="alert(1)">';
    const staff = [person('a', payload), person('b', 'Ali & <Sorumlu>')];
    const html = buildPrintHtml(resultFor(staff), staff, config.month, config.year);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('Ali &amp; &lt;Sorumlu&gt;');
  });
});

describe('CSV export', () => {
  it('uses ";" and keeps names with commas or quotes in one field', () => {
    const staff = [person('a', 'Yılmaz, Ayşe'), person('b', 'Burak "Bora" Can; Jr')];
    const lines = buildCsv(resultFor(staff), staff, config.month, config.year).replace(/^\ufeff/, '').split('\n');
    expect(lines[0]).toBe('Gün;Tarih;Personel (Süre)');
    expect(parseCsvLine(lines[1])).toEqual(['Pazar', '1 Kasım 2026', 'Yılmaz, Ayşe (24s)']);
    expect(parseCsvLine(lines[2])).toEqual(['Pazartesi', '2 Kasım 2026', '-']);
    const statsHeader = lines.findIndex((l) => l.startsWith('İsim;'));
    expect(parseCsvLine(lines[statsHeader])).toEqual(['İsim', 'Toplam Saat', 'Hedef Saat', 'Nöbet Sayısı', '24 Saat', '16 Saat', 'Gerçek Yük', 'Adil Pay']);
    // Both work alone: 24h covers the whole day (24), 16h ends at 00:00 (15.5). Fair shares split 39.5 by 24:16.
    expect(parseCsvLine(lines[statsHeader + 1])).toEqual(['Yılmaz, Ayşe', '24', '48', '1', '1', '0', '24,0', '23,7']);
    expect(parseCsvLine(lines[statsHeader + 2])).toEqual(['Burak "Bora" Can; Jr', '16', '48', '1', '0', '1', '15,5', '15,8']);
  });

  it('neutralises spreadsheet formulas but leaves a lone dash alone', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+90 555')).toBe("'+90 555");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-')).toBe('-');
    expect(csvCell(-5)).toBe('-5');
  });

  it('starts with a BOM so Excel reads UTF-8', () => {
    const staff = [person('a', 'Şule'), person('b', 'Ömer')];
    expect(buildCsv(resultFor(staff), staff, config.month, config.year).startsWith('\ufeff')).toBe(true);
  });
});
