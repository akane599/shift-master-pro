import { useState } from 'react';
import { ScheduleConfig, ScheduleResult, Staff, Shift } from '@/types/schedule';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format, startOfMonth, getDaysInMonth, addDays, getDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import { CalendarDays, AlertTriangle, CheckCircle, TrendingUp, Lightbulb, Edit3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ShiftEditDialog } from './ShiftEditDialog';
import { toast } from '@/hooks/use-toast';
import { dayKey } from '@/lib/scheduleRules';

interface ScheduleViewProps {
  /** The saved roster of `config`'s month with freshly computed stats, or null if that month has none. */
  result: ScheduleResult | null;
  staff: Staff[];
  config: ScheduleConfig;
  /** Staff on duty on the previous month's last day (rest rule for day 1). */
  workedPreviousDay?: string[];
  onShiftsChange?: (shifts: Shift[]) => void;
}

const dayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

export function ScheduleView({ result, staff, config, workedPreviousDay = [], onShiftsChange }: ScheduleViewProps) {
  const { month, year } = config;
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  if (!result) {
    return (
      <Card className="glass-card">
        <CardContent className="py-12 text-center">
          <CalendarDays className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">
            {format(new Date(year, month), 'MMMM yyyy', { locale: tr })} için kayıtlı çizelge yok. Oluşturmak için "Oluştur" butonuna tıklayın.
          </p>
        </CardContent>
      </Card>
    );
  }

  const monthStart = startOfMonth(new Date(year, month));
  const daysInMonth = getDaysInMonth(monthStart);
  const startDay = getDay(monthStart);

  const calendarDays = [];
  for (let i = 0; i < startDay; i++) {
    calendarDays.push(null);
  }
  for (let i = 0; i < daysInMonth; i++) {
    calendarDays.push(addDays(monthStart, i));
  }

  const getShiftForDay = (date: Date) => {
    return result.shifts.find(s => dayKey(s.date) === dayKey(date));
  };

  const getStaffName = (id: string) => {
    return staff.find(s => s.id === id)?.name || 'Silinmiş';
  };

  const onTarget = result.targetDeviation < 0.05;
  const getDeviationColor = (deviation: number) => {
    if (deviation < 0.05) return 'text-success';
    if (deviation < 5) return 'text-warning';
    return 'text-destructive';
  };

  const getShiftTotalHours = (shift: Shift) => {
    return shift.assignments.reduce((sum, a) => sum + a.duration, 0);
  };

  const has24HourAssignment = (shift: Shift) => shift.assignments.some(a => a.duration === 24);
  const has16HourAssignment = (shift: Shift) => shift.assignments.some(a => a.duration === 16);

  const handleDayClick = (date: Date) => {
    if (!onShiftsChange) return;
    // Empty days are editable too, so a gap can be filled by hand.
    setEditingShift(getShiftForDay(date) ?? { date, assignments: [] });
    setIsDialogOpen(true);
  };

  const handleShiftSave = (updatedShift: Shift) => {
    if (!result || !onShiftsChange) return;

    const key = dayKey(updatedShift.date);
    const others = result.shifts.filter(s => dayKey(s.date) !== key);
    const shifts = updatedShift.assignments.length
      ? [...others, updatedShift].sort((a, b) => a.date.getTime() - b.date.getTime())
      : others;

    onShiftsChange(shifts);

    toast({
      title: 'Nöbet Güncellendi',
      description: updatedShift.assignments.length
        ? `${format(updatedShift.date, 'd MMMM', { locale: tr })} nöbeti değiştirildi.`
        : `${format(updatedShift.date, 'd MMMM', { locale: tr })} nöbeti kaldırıldı.`
    });
  };

  const total24Shifts = result.shifts.reduce((count, s) => 
    count + s.assignments.filter(a => a.duration === 24).length, 0
  );
  const total16Shifts = result.shifts.reduce((count, s) => 
    count + s.assignments.filter(a => a.duration === 16).length, 0
  );

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
              <p className="text-xs text-muted-foreground">Nöbet Günü</p>
            </div>
          </div>
        </Card>

        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/20">
              <TrendingUp className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold">{total24Shifts}</p>
              <p className="text-xs text-muted-foreground">24 Saat Atama</p>
            </div>
          </div>
        </Card>

        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-secondary">
              <TrendingUp className="w-5 h-5 text-secondary-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{total16Shifts}</p>
              <p className="text-xs text-muted-foreground">16 Saat Atama</p>
            </div>
          </div>
        </Card>

        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", onTarget ? "bg-success/20" : "bg-warning/20")}>
              {onTarget ? (
                <CheckCircle className="w-5 h-5 text-success" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-warning" />
              )}
            </div>
            <div>
              <p className={cn("text-2xl font-bold", getDeviationColor(result.targetDeviation))}>
                %{result.targetDeviation.toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground">Hedef Saat Sapması</p>
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
              const hasMixed = shift && has24HourAssignment(shift) && has16HourAssignment(shift);
              const understaffed = (shift?.assignments.filter(a => staff.some(s => s.id === a.staffId)).length ?? 0) < config.minStaffPerShift;
              
              return (
                <div
                  key={idx}
                  onClick={() => handleDayClick(date)}
                  className={cn(
                    "aspect-square p-1 rounded-lg border transition-all group relative",
                    shift ? (
                      hasMixed 
                        ? "bg-gradient-to-br from-primary/20 to-accent/20 border-primary/30" 
                        : has24HourAssignment(shift) 
                          ? "shift-24 border-primary/30" 
                          : "shift-16 border-accent/30"
                    ) : "bg-card border-border",
                    isWeekend && "bg-muted/30",
                    understaffed && "border-destructive/70 border-dashed",
                    onShiftsChange && "cursor-pointer hover:ring-2 hover:ring-primary/50"
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
                          <div className="text-[9px] text-center truncate">
                            {shift.assignments.map(a => {
                              const name = getStaffName(a.staffId).split(' ')[0];
                              return `${name}${a.duration === 16 ? '*' : ''}`;
                            }).join(', ')}
                        </div>
                      </div>
                    )}
                    {onShiftsChange && (
                      <div className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Edit3 className="w-3 h-3 text-primary" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            * 16 saatlik nöbeti gösterir · Kesikli kırmızı çerçeve: en az {config.minStaffPerShift} nöbetçi yok · Düzenlemek için güne tıklayın
          </p>
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
                  <th className="text-center py-2 px-2">Saat / Hedef</th>
                  <th className="text-center py-2 px-2">Nöbet</th>
                  <th className="text-center py-2 px-2">24s</th>
                  <th className="text-center py-2 px-2">16s</th>
                  <th className="text-center py-2 px-2">Tercih</th>
                </tr>
              </thead>
              <tbody>
                {result.staffStats.map(stat => {
                  const hitTarget = stat.totalHours === stat.targetHours;
                  return (
                    <tr key={stat.staffId} className="border-b border-border/50">
                      <td className="py-2 px-2 font-medium">{stat.name}</td>
                      <td className={cn("text-center py-2 px-2 font-mono", hitTarget ? "text-success" : "text-warning")}>
                        {stat.totalHours} / {stat.targetHours}
                      </td>
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
                  );
                })}
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

      {/* Shift Edit Dialog */}
      <ShiftEditDialog
        shift={editingShift}
        shifts={result.shifts}
        staff={staff}
        open={isDialogOpen}
        workedPreviousDay={workedPreviousDay}
        onOpenChange={setIsDialogOpen}
        onSave={handleShiftSave}
      />
    </div>
  );
}
