import { ScheduleResult, Staff } from '@/types/schedule';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format, startOfMonth, getDaysInMonth, addDays, getDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import { CalendarDays, AlertTriangle, CheckCircle, TrendingUp, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScheduleViewProps {
  result: ScheduleResult | null;
  staff: Staff[];
  month: number;
  year: number;
}

const dayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

export function ScheduleView({ result, staff, month, year }: ScheduleViewProps) {
  if (!result) {
    return (
      <Card className="glass-card">
        <CardContent className="py-12 text-center">
          <CalendarDays className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">
            Çizelge oluşturmak için "Oluştur" butonuna tıklayın
          </p>
        </CardContent>
      </Card>
    );
  }

  const monthStart = startOfMonth(new Date(year, month));
  const daysInMonth = getDaysInMonth(monthStart);
  const startDay = getDay(monthStart);

  // Create calendar grid
  const calendarDays = [];
  for (let i = 0; i < startDay; i++) {
    calendarDays.push(null);
  }
  for (let i = 0; i < daysInMonth; i++) {
    calendarDays.push(addDays(monthStart, i));
  }

  const getShiftForDay = (date: Date) => {
    return result.shifts.find(s => 
      format(s.date, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    );
  };

  const getStaffName = (id: string) => {
    return staff.find(s => s.id === id)?.name || 'Bilinmeyen';
  };

  const getInequalityColor = (score: number) => {
    if (score < 10) return 'text-success';
    if (score < 20) return 'text-warning';
    return 'text-destructive';
  };

  return (
    <div className="space-y-6">
      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/20">
              <CalendarDays className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{result.shifts.length}</p>
              <p className="text-xs text-muted-foreground">Toplam Nöbet</p>
            </div>
          </div>
        </Card>

        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/20">
              <TrendingUp className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {result.shifts.filter(s => s.duration === 24).length}
              </p>
              <p className="text-xs text-muted-foreground">24 Saat Nöbet</p>
            </div>
          </div>
        </Card>

        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-secondary">
              <TrendingUp className="w-5 h-5 text-secondary-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {result.shifts.filter(s => s.duration === 16).length}
              </p>
              <p className="text-xs text-muted-foreground">16 Saat Nöbet</p>
            </div>
          </div>
        </Card>

        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", result.inequalityScore < 15 ? "bg-success/20" : "bg-warning/20")}>
              {result.inequalityScore < 15 ? (
                <CheckCircle className="w-5 h-5 text-success" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-warning" />
              )}
            </div>
            <div>
              <p className={cn("text-2xl font-bold", getInequalityColor(result.inequalityScore))}>
                %{result.inequalityScore.toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground">Eşitsizlik Skoru</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Calendar View */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            {format(monthStart, 'MMMM yyyy', { locale: tr })} Nöbet Çizelgesi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {dayNames.map(day => (
              <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((date, idx) => {
              if (!date) {
                return <div key={idx} className="aspect-square" />;
              }
              
              const shift = getShiftForDay(date);
              const isWeekend = getDay(date) === 0 || getDay(date) === 6;
              
              return (
                <div
                  key={idx}
                  className={cn(
                    "aspect-square p-1 rounded-lg border transition-all",
                    shift ? (shift.duration === 24 ? "shift-24 border-primary/30" : "shift-16 border-accent/30") : "bg-card border-border",
                    isWeekend && "bg-muted/30"
                  )}
                >
                  <div className="h-full flex flex-col">
                    <span className={cn(
                      "text-xs font-medium",
                      isWeekend && "text-primary"
                    )}>
                      {format(date, 'd')}
                    </span>
                    {shift && (
                      <div className="flex-1 flex flex-col justify-center overflow-hidden">
                        <span className="text-[10px] font-mono text-center">
                          {shift.duration}s
                        </span>
                        <div className="text-[9px] text-center truncate">
                          {shift.staffIds.map(id => getStaffName(id).split(' ')[0]).join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Staff Stats */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Personel İstatistikleri</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2">İsim</th>
                  <th className="text-center py-2 px-2">Toplam Saat</th>
                  <th className="text-center py-2 px-2">Nöbet</th>
                  <th className="text-center py-2 px-2">24s</th>
                  <th className="text-center py-2 px-2">16s</th>
                  <th className="text-center py-2 px-2">Tercih</th>
                </tr>
              </thead>
              <tbody>
                {result.staffStats.map(stat => (
                  <tr key={stat.staffId} className="border-b border-border/50">
                    <td className="py-2 px-2 font-medium">{stat.name}</td>
                    <td className="text-center py-2 px-2 font-mono">{stat.totalHours}</td>
                    <td className="text-center py-2 px-2">{stat.shiftCount}</td>
                    <td className="text-center py-2 px-2">{stat.shift24Count}</td>
                    <td className="text-center py-2 px-2">{stat.shift16Count}</td>
                    <td className="text-center py-2 px-2">
                      {stat.preferencesTotal > 0 ? (
                        <span className={cn(
                          stat.preferencesSatisfied / stat.preferencesTotal >= 0.5 
                            ? "text-success" 
                            : "text-warning"
                        )}>
                          {stat.preferencesSatisfied}/{stat.preferencesTotal}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Suggestions */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-warning" />
            Öneriler
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {result.suggestions.map((suggestion, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <span className="text-primary mt-1">•</span>
                <span className="text-muted-foreground">{suggestion}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
