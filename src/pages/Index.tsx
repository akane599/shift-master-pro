import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import type { AppData, ScheduleConfig, ScheduleResult, Shift, Staff } from '@/types/schedule';
import { StaffManager } from '@/components/StaffManager';
import { ScheduleConfig as ScheduleConfigComponent } from '@/components/ScheduleConfig';
import { ScheduleView } from '@/components/ScheduleView';
import { generateSchedule } from '@/lib/scheduleGenerator';
import { evaluateSchedule } from '@/lib/scheduleStats';
import { getMonthDays, monthKey, previousMonth, staffOnDay } from '@/lib/scheduleRules';
import { loadAppData, saveAppData } from '@/lib/persistence';
import { exportToExcel, exportToPDF } from '@/lib/exportUtils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Calendar, Users, Settings, FileSpreadsheet, FileText, Sparkles, Stethoscope } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export default function Index() {
  // Saved data is read before the first render, so the first save writes back exactly what was loaded.
  const [loaded] = useState(() => loadAppData());
  const [staff, setStaff] = useState<Staff[]>(loaded.data.staff);
  const [config, setConfig] = useState<ScheduleConfig>(loaded.data.config);
  const [rosters, setRosters] = useState<AppData['rosters']>(loaded.data.rosters);
  const [carryIn, setCarryIn] = useState<AppData['carryIn']>(loaded.data.carryIn);
  const [activeTab, setActiveTab] = useState('staff');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const saveFailureShown = useRef(false);

  useEffect(() => {
    if (!loaded.problems.length) return;
    toast({
      title: 'Kayıtlı verinin bir kısmı okunamadı',
      description: `${loaded.problems.join(' ')}${loaded.backupKey ? ` Orijinal veri "${loaded.backupKey}" anahtarıyla yedeklendi.` : ''}`,
      variant: 'destructive'
    });
  }, [loaded]);

  useEffect(() => {
    if (saveAppData({ staff, config, rosters, carryIn })) {
      saveFailureShown.current = false;
    } else if (!saveFailureShown.current) {
      saveFailureShown.current = true;
      toast({
        title: 'Kaydedilemedi',
        description: 'Tarayıcı depolamasına yazılamadı. Değişiklikler sayfa yenilenince kaybolur.',
        variant: 'destructive'
      });
    }
  }, [staff, config, rosters, carryIn]);

  const key = monthKey(config);
  const roster = rosters[key];

  // Who worked the last day of the previous month: from its saved roster, or entered by hand in Ayarlar.
  const prevRoster = rosters[monthKey(previousMonth(config))];
  const workedPreviousDay = useMemo(() => {
    if (!prevRoster) return carryIn[key] ?? [];
    const prevDays = getMonthDays(prevRoster);
    return staffOnDay(prevRoster.shifts, prevDays[prevDays.length - 1]);
  }, [prevRoster, carryIn, key]);

  // Stats are always recomputed from the current staff and settings, so they can't go stale.
  const result: ScheduleResult | null = useMemo(
    () => (roster ? { shifts: roster.shifts, ...evaluateSchedule(staff, roster.shifts, config, { workedPreviousDay }) } : null),
    [roster, staff, config, workedPreviousDay]
  );

  const monthLabel = format(new Date(config.year, config.month), 'MMMM yyyy', { locale: tr });

  const handleGenerate = () => {
    if (staff.length < config.minStaffPerShift) {
      toast({
        title: 'Yetersiz Personel',
        description: `En az ${config.minStaffPerShift} personel gerekli.`,
        variant: 'destructive'
      });
      return;
    }
    if (roster) {
      setConfirmOverwrite(true);
      return;
    }
    generate();
  };

  const generate = () => {
    const seed = Math.floor(Math.random() * 2 ** 32);
    const scheduleResult = generateSchedule(staff, config, { seed, workedPreviousDay });
    setRosters((prev) => ({ ...prev, [key]: { month: config.month, year: config.year, shifts: scheduleResult.shifts, seed } }));
    setActiveTab('schedule');

    toast({
      title: 'Çizelge Oluşturuldu',
      description: `${scheduleResult.shifts.length} nöbet günü planlandı. Hedef saat sapması: %${scheduleResult.targetDeviation.toFixed(1)}`
    });
  };

  const handleShiftsChange = (shifts: Shift[]) => {
    setRosters((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], shifts } } : prev));
  };

  const handleCarryInChange = (ids: string[]) => {
    setCarryIn((prev) => ({ ...prev, [key]: ids }));
  };

  const handleExportExcel = () => {
    if (!result) return;
    exportToExcel(result, staff, config.month, config.year);
    toast({
      title: 'Excel İndirildi',
      description: 'Çizelge CSV formatında indirildi.'
    });
  };

  const handleExportPDF = () => {
    if (!result) return;
    exportToPDF(result, staff, config.month, config.year);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/20 glow-primary">
                <Stethoscope className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gradient">Nöbet Planlayıcı</h1>
                <p className="text-xs text-muted-foreground">Hastane Vardiya Yönetimi</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {result && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportExcel}
                    className="hidden sm:flex"
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportPDF}
                    className="hidden sm:flex"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    PDF
                  </Button>
                </>
              )}
              <Button onClick={handleGenerate} className="glow-primary">
                <Sparkles className="w-4 h-4 mr-2" />
                Oluştur
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid grid-cols-3 w-full max-w-md mx-auto bg-card border border-border">
            <TabsTrigger value="staff" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Personel</span>
            </TabsTrigger>
            <TabsTrigger value="config" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Ayarlar</span>
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Çizelge</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="staff" className="animate-fade-in">
            <div className="max-w-2xl mx-auto">
              <StaffManager staff={staff} onStaffChange={setStaff} defaultMonthlyHours={config.totalMonthlyHours} />
            </div>
          </TabsContent>

          <TabsContent value="config" className="animate-fade-in">
            <div className="max-w-md mx-auto">
              <ScheduleConfigComponent
                config={config}
                onConfigChange={setConfig}
                staff={staff}
                workedPreviousDay={workedPreviousDay}
                previousRosterSaved={!!prevRoster}
                onWorkedPreviousDayChange={handleCarryInChange}
              />
            </div>
          </TabsContent>

          <TabsContent value="schedule" className="animate-fade-in">
            <div className="max-w-4xl mx-auto">
              <ScheduleView
                result={result}
                staff={staff}
                config={config}
                workedPreviousDay={workedPreviousDay}
                onShiftsChange={handleShiftsChange}
              />

              {/* Mobile export buttons */}
              {result && (
                <div className="flex gap-2 mt-6 sm:hidden">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleExportExcel}
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Excel
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleExportPDF}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    PDF
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{monthLabel} çizelgesi yeniden oluşturulsun mu?</AlertDialogTitle>
            <AlertDialogDescription>
              Bu ay için kayıtlı bir çizelge var. Yeniden oluşturursanız elle yaptığınız değişiklikler dahil mevcut çizelge silinir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction onClick={generate}>Yeniden Oluştur</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Footer */}
      <footer className="border-t border-border mt-auto py-4">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          <p>Hastane Nöbet Planlayıcı • Personel, ayarlar ve çizelgeler bu tarayıcıda saklanır</p>
          <p className="mt-1 opacity-50">Made by Tuğberk Özgen</p>
        </div>
      </footer>
    </div>
  );
}
