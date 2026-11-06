import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ScheduleConfig as Config, Staff } from '@/types/schedule';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, Clock, Calendar, Users, MoonStar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { achievableHours, getMonthDays, previousMonth, shiftCountRange } from '@/lib/scheduleRules';

interface ScheduleConfigProps {
  config: Config;
  onConfigChange: (config: Config) => void;
  staff?: Staff[];
  /** Staff on duty on the previous month's last day (kept off day 1 by the rest rule). */
  workedPreviousDay?: string[];
  /** True when that list comes from a saved roster of the previous month (then it isn't edited here). */
  previousRosterSaved?: boolean;
  onWorkedPreviousDayChange?: (staffIds: string[]) => void;
}

const months = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

export function ScheduleConfig({
  config,
  onConfigChange,
  staff = [],
  workedPreviousDay = [],
  previousRosterSaved = false,
  onWorkedPreviousDayChange
}: ScheduleConfigProps) {
  const prevDays = getMonthDays(previousMonth(config));
  const prevLastDay = prevDays[prevDays.length - 1];
  const prevLastDayLabel = prevLastDay ? format(prevLastDay, 'd MMMM yyyy', { locale: tr }) : '';
  const firstDayLabel = format(new Date(config.year, config.month, 1), 'd MMMM', { locale: tr });
  const togglePrevious = (id: string) =>
    onWorkedPreviousDayChange?.(
      workedPreviousDay.includes(id) ? workedPreviousDay.filter(x => x !== id) : [...workedPreviousDay, id]
    );
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];
  const dayCount = getMonthDays(config).length;
  const hours = config.totalMonthlyHours;
  const hoursExact = achievableHours(hours) === hours;
  const shiftRange = shiftCountRange(achievableHours(hours));

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          Çizelge Ayarları
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              Ay
            </Label>
            <Select
              value={config.month.toString()}
              onValueChange={(v) => onConfigChange({ ...config, month: parseInt(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((month, idx) => (
                  <SelectItem key={idx} value={idx.toString()}>
                    {month}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              Yıl
            </Label>
            <Select
              value={config.year.toString()}
              onValueChange={(v) => onConfigChange({ ...config, year: parseInt(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Kişi Başı Aylık Mesai Saati (Varsayılan)
          </Label>
          <Input
            type="number"
            value={config.totalMonthlyHours}
            onChange={(e) => onConfigChange({ ...config, totalMonthlyHours: parseInt(e.target.value) || 0 })}
            placeholder="Örn: 160"
          />
          <p className="text-xs text-muted-foreground">
            Kendine özel saat girilmemiş her personelin bu ayki hedefi. Personel sekmesinden kişiye özel saat verilebilir.
          </p>
          {!hoursExact && (
            <p className="text-xs text-warning">
              {hours} saat 24 ve 16 saatlik nöbetlerle tam yazılamaz; 8'in katı bir değer girin (8 hariç). Şu haliyle {achievableHours(hours)} saat planlanır.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            Nöbet Başına Minimum Personel
          </Label>
          <Input
            type="number"
            min={1}
            value={config.minStaffPerShift}
            onChange={(e) => onConfigChange({ ...config, minStaffPerShift: parseInt(e.target.value) || 1 })}
          />
        </div>

        {staff.length > 0 && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <MoonStar className="w-4 h-4 text-muted-foreground" />
              Önceki Ayın Son Günü Nöbetçiler
            </Label>
            <p className="text-xs text-muted-foreground">
              {previousRosterSaved
                ? `Kayıtlı çizelgeye göre ${prevLastDayLabel} nöbetçileri. Nöbet ertesi kuralı gereği ${firstDayLabel} günü nöbete yazılmazlar.`
                : `Önceki ay için kayıtlı çizelge yok. ${prevLastDayLabel} günü nöbet tutanları seçin; ${firstDayLabel} günü nöbete yazılmazlar.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {previousRosterSaved
                ? (workedPreviousDay.length
                    ? staff.filter(s => workedPreviousDay.includes(s.id)).map(s => (
                        <Badge key={s.id} variant="secondary">{s.name}</Badge>
                      ))
                    : <span className="text-xs text-muted-foreground">O gün kimse nöbetçi değil.</span>)
                : staff.map(s => (
                    <Badge
                      key={s.id}
                      variant={workedPreviousDay.includes(s.id) ? 'default' : 'outline'}
                      className={cn('cursor-pointer transition-all', !workedPreviousDay.includes(s.id) && 'hover:bg-primary/20')}
                      onClick={() => togglePrevious(s.id)}
                    >
                      {s.name}
                    </Badge>
                  ))}
            </div>
          </div>
        )}

        <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
          <div className="text-sm text-muted-foreground">
            <p className="flex justify-between">
              <span>Varsayılan hedefle kişi başı nöbet:</span>
              <span className="font-mono text-foreground">
                {shiftRange.min === shiftRange.max ? shiftRange.min : `${shiftRange.min}–${shiftRange.max}`}
              </span>
            </p>
            <p className="flex justify-between">
              <span>Ay boyunca gereken toplam atama:</span>
              <span className="font-mono text-foreground">
                {dayCount} gün × {config.minStaffPerShift} = {dayCount * config.minStaffPerShift}
              </span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
