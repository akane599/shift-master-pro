import { ScheduleConfig as Config } from '@/types/schedule';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, Clock, Calendar, Users } from 'lucide-react';

interface ScheduleConfigProps {
  config: Config;
  onConfigChange: (config: Config) => void;
}

const months = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

export function ScheduleConfig({ config, onConfigChange }: ScheduleConfigProps) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];

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
            Toplam Aylık Mesai Saati
          </Label>
          <Input
            type="number"
            value={config.totalMonthlyHours}
            onChange={(e) => onConfigChange({ ...config, totalMonthlyHours: parseInt(e.target.value) || 0 })}
            placeholder="Örn: 720"
          />
          <p className="text-xs text-muted-foreground">
            Tüm personelin toplam çalışacağı saat
          </p>
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

        <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
          <div className="text-sm text-muted-foreground">
            <p className="flex justify-between">
              <span>Tahmini nöbet sayısı:</span>
              <span className="font-mono text-foreground">
                ~{Math.ceil(config.totalMonthlyHours / 24)}
              </span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
