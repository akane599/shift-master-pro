import { ScheduleResult, Staff } from '@/types/schedule';
import { format, startOfMonth, getDaysInMonth, addDays } from 'date-fns';
import { tr } from 'date-fns/locale';

export function exportToExcel(result: ScheduleResult, staff: Staff[], month: number, year: number) {
  const monthStart = startOfMonth(new Date(year, month));
  const daysInMonth = getDaysInMonth(monthStart);
  
  // Create CSV content
  let csv = 'Gün,Tarih,Süre (Saat),Personel\n';
  
  for (let i = 0; i < daysInMonth; i++) {
    const date = addDays(monthStart, i);
    const shift = result.shifts.find(s => 
      format(s.date, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    );
    
    const dayName = format(date, 'EEEE', { locale: tr });
    const dateStr = format(date, 'd MMMM yyyy', { locale: tr });
    
    if (shift) {
      const staffNames = shift.staffIds
        .map(id => staff.find(s => s.id === id)?.name || 'Bilinmeyen')
        .join(' - ');
      csv += `${dayName},${dateStr},${shift.duration},${staffNames}\n`;
    } else {
      csv += `${dayName},${dateStr},-,-\n`;
    }
  }
  
  // Add statistics
  csv += '\n\nPersonel İstatistikleri\n';
  csv += 'İsim,Toplam Saat,Nöbet Sayısı,24 Saat,16 Saat\n';
  
  result.staffStats.forEach(stat => {
    csv += `${stat.name},${stat.totalHours},${stat.shiftCount},${stat.shift24Count},${stat.shift16Count}\n`;
  });
  
  csv += `\nEşitsizlik Skoru,%${result.inequalityScore.toFixed(2)}\n`;
  
  // Download
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `nobet-cizelgesi-${format(monthStart, 'MMMM-yyyy', { locale: tr })}.csv`;
  link.click();
}

export function exportToPDF(result: ScheduleResult, staff: Staff[], month: number, year: number) {
  const monthStart = startOfMonth(new Date(year, month));
  const daysInMonth = getDaysInMonth(monthStart);
  
  // Create printable HTML
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
        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <h1>Nöbet Çizelgesi - ${format(monthStart, 'MMMM yyyy', { locale: tr })}</h1>
      
      <table>
        <thead>
          <tr>
            <th>Gün</th>
            <th>Tarih</th>
            <th>Süre</th>
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
      const staffNames = shift.staffIds
        .map(id => staff.find(s => s.id === id)?.name || 'Bilinmeyen')
        .join(', ');
      html += `<tr><td>${dayName}</td><td>${dateStr}</td><td>${shift.duration} saat</td><td>${staffNames}</td></tr>`;
    } else {
      html += `<tr><td>${dayName}</td><td>${dateStr}</td><td>-</td><td>-</td></tr>`;
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
              <th>Nöbet Sayısı</th>
              <th>24 Saat</th>
              <th>16 Saat</th>
            </tr>
          </thead>
          <tbody>
  `;
  
  result.staffStats.forEach(stat => {
    html += `<tr><td>${stat.name}</td><td>${stat.totalHours}</td><td>${stat.shiftCount}</td><td>${stat.shift24Count}</td><td>${stat.shift16Count}</td></tr>`;
  });
  
  html += `
          </tbody>
        </table>
        
        <p>Eşitsizlik Skoru: <span class="score">%${result.inequalityScore.toFixed(2)}</span></p>
        
        <div class="suggestions">
          <h3>Öneriler</h3>
          <ul>
            ${result.suggestions.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      </div>
    </body>
    </html>
  `;
  
  // Open in new window for printing
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  }
}
