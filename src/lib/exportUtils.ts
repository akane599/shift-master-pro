import { ScheduleResult, Staff } from '@/types/schedule';
import { format, startOfMonth, getDaysInMonth, addDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { formatHours } from './scheduleStats';

/** Escapes text for HTML. Names and warnings are user input and must never be parsed as markup. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * CSV separator. Turkish-locale Excel uses ";" as its list separator (the comma is the decimal separator),
 * so a comma-separated file would open with everything in column A.
 */
export const CSV_SEPARATOR = ';';

/** One CSV field: neutralises formula prefixes (=, +, -, @) and quotes when needed. */
export function csvCell(value: string | number): string {
  let text = String(value);
  // A lone "-" (empty day) is plain text; anything longer starting with these could be read as a formula.
  if (typeof value === 'string' && text.length > 1 && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) || text.includes(CSV_SEPARATOR) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvRow = (...cells: (string | number)[]) => cells.map(csvCell).join(CSV_SEPARATOR) + '\n';

/** Builds the CSV text (with BOM so Excel reads it as UTF-8). */
export function buildCsv(result: ScheduleResult, staff: Staff[], month: number, year: number): string {
  const monthStart = startOfMonth(new Date(year, month));
  const daysInMonth = getDaysInMonth(monthStart);

  let csv = csvRow('Gün', 'Tarih', 'Personel (Süre)');

  for (let i = 0; i < daysInMonth; i++) {
    const date = addDays(monthStart, i);
    const shift = result.shifts.find(s =>
      format(s.date, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    );

    const dayName = format(date, 'EEEE', { locale: tr });
    const dateStr = format(date, 'd MMMM yyyy', { locale: tr });

    const staffInfo = shift
      ? shift.assignments
          .map(a => `${staff.find(s => s.id === a.staffId)?.name || 'Silinmiş personel'} (${a.duration}s)`)
          .join(' - ')
      : '-';
    csv += csvRow(dayName, dateStr, staffInfo);
  }

  csv += '\n\n' + csvRow('Personel İstatistikleri');
  csv += csvRow('İsim', 'Toplam Saat', 'Hedef Saat', 'Nöbet Sayısı', '24 Saat', '16 Saat', 'Gerçek Yük', 'Adil Pay');

  result.staffStats.forEach(stat => {
    csv += csvRow(
      stat.name,
      stat.totalHours,
      stat.targetHours,
      stat.shiftCount,
      stat.shift24Count,
      stat.shift16Count,
      formatHours(stat.workload),
      formatHours(stat.fairWorkload)
    );
  });

  csv += '\n' + csvRow('Hedef Saat Sapması', `%${result.targetDeviation.toFixed(2).replace('.', ',')}`);
  return '\ufeff' + csv;
}

export function exportToExcel(result: ScheduleResult, staff: Staff[], month: number, year: number) {
  const monthStart = startOfMonth(new Date(year, month));
  const blob = new Blob([buildCsv(result, staff, month, year)], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `nobet-cizelgesi-${format(monthStart, 'MMMM-yyyy', { locale: tr })}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

/** Builds the printable HTML. Every user-provided string goes through escapeHtml. */
export function buildPrintHtml(result: ScheduleResult, staff: Staff[], month: number, year: number): string {
  const monthStart = startOfMonth(new Date(year, month));
  const daysInMonth = getDaysInMonth(monthStart);
  
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Nöbet Çizelgesi - ${format(monthStart, 'MMMM yyyy', { locale: tr })}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #0d9488; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #0d9488; color: white; }
        tr:nth-child(even) { background: #f9f9f9; }
        .stats { margin-top: 30px; }
        .score { font-size: 24px; color: #0d9488; font-weight: bold; }
        .suggestions { background: #fef3c7; padding: 15px; border-radius: 8px; margin-top: 20px; }
        .duration-24 { color: #0d9488; font-weight: bold; }
        .duration-16 { color: #f59e0b; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <h1>Nöbet Çizelgesi - ${format(monthStart, 'MMMM yyyy', { locale: tr })}</h1>
      
      <table>
        <thead>
          <tr>
            <th>Gün</th>
            <th>Tarih</th>
            <th>Personel</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  for (let i = 0; i < daysInMonth; i++) {
    const date = addDays(monthStart, i);
    const shift = result.shifts.find(s => 
      format(s.date, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    );
    
    const dayName = format(date, 'EEEE', { locale: tr });
    const dateStr = format(date, 'd MMMM', { locale: tr });
    
    if (shift) {
      const staffInfo = shift.assignments
        .map(a => {
          const staffMember = staff.find(s => s.id === a.staffId);
          const durationClass = a.duration === 24 ? 'duration-24' : 'duration-16';
          return `<span class="${durationClass}">${escapeHtml(staffMember?.name || 'Silinmiş personel')} (${a.duration}s)</span>`;
        })
        .join(', ');
      html += `<tr><td>${dayName}</td><td>${dateStr}</td><td>${staffInfo}</td></tr>`;
    } else {
      html += `<tr><td>${dayName}</td><td>${dateStr}</td><td>-</td></tr>`;
    }
  }
  
  html += `
        </tbody>
      </table>
      
      <div class="stats">
        <h2>Personel İstatistikleri</h2>
        <table>
          <thead>
            <tr>
              <th>İsim</th>
              <th>Toplam Saat</th>
              <th>Hedef Saat</th>
              <th>Nöbet Sayısı</th>
              <th>24 Saat</th>
              <th>16 Saat</th>
              <th>Gerçek Yük</th>
              <th>Adil Pay</th>
            </tr>
          </thead>
          <tbody>
  `;

  result.staffStats.forEach(stat => {
    html += `<tr><td>${escapeHtml(stat.name)}</td><td>${stat.totalHours}</td><td>${stat.targetHours}</td><td>${stat.shiftCount}</td><td>${stat.shift24Count}</td><td>${stat.shift16Count}</td><td>${formatHours(stat.workload)}</td><td>${formatHours(stat.fairWorkload)}</td></tr>`;
  });
  
  html += `
          </tbody>
        </table>
        
        <p>Hedef Saat Sapması: <span class="score">%${result.targetDeviation.toFixed(2)}</span></p>
        
        <div class="suggestions">
          <h3>Öneriler</h3>
          <ul>
            ${result.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
          </ul>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return html;
}

export function exportToPDF(result: ScheduleResult, staff: Staff[], month: number, year: number) {
  const html = buildPrintHtml(result, staff, month, year);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  }
}
