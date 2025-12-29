import { useState, useEffect } from 'react';
import { Staff, ScheduleConfig, ScheduleResult } from '@/types/schedule';
import { StaffManager } from '@/components/StaffManager';
import { ScheduleConfig as ScheduleConfigComponent } from '@/components/ScheduleConfig';
import { ScheduleView } from '@/components/ScheduleView';
import { generateSchedule } from '@/lib/scheduleGenerator';
import { exportToExcel, exportToPDF } from '@/lib/exportUtils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, Users, Settings, FileSpreadsheet, FileText, Sparkles, Stethoscope } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

const STORAGE_KEY = 'hospital-shift-scheduler-data';

export default function Index() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [config, setConfig] = useState<ScheduleConfig>({
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
    totalMonthlyHours: 720,
    minStaffPerShift: 2
  });
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [activeTab, setActiveTab] = useState('staff');

  // Load data from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.staff) {
          // Convert date strings back to Date objects
          const loadedStaff = data.staff.map((s: any) => ({
            ...s,
            unavailableDates: s.unavailableDates.map((d: any) => ({
              start: new Date(d.start),
              end: new Date(d.end)
            }))
          }));
          setStaff(loadedStaff);
        }
        if (data.config) {
          setConfig(data.config);
        }
      } catch (e) {
        console.error('Failed to load saved data:', e);
      }
    }
  }, []);

  // Save data to localStorage on change
  useEffect(() => {
    const data = { staff, config };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [staff, config]);

  const handleGenerate = () => {
    if (staff.length < config.minStaffPerShift) {
      toast({
        title: 'Yetersiz Personel',
        description: `En az ${config.minStaffPerShift} personel gerekli.`,
        variant: 'destructive'
      });
      return;
    }

    const scheduleResult = generateSchedule(staff, config);
    setResult(scheduleResult);
    setActiveTab('schedule');
    
    toast({
      title: 'Çizelge Oluşturuldu',
      description: `${scheduleResult.shifts.length} nöbet planlandı. Eşitsizlik skoru: %${scheduleResult.inequalityScore.toFixed(1)}`
    });
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
              <ScheduleConfigComponent config={config} onConfigChange={setConfig} />
            </div>
          </TabsContent>

          <TabsContent value="schedule" className="animate-fade-in">
            <div className="max-w-4xl mx-auto">
              <ScheduleView 
                result={result} 
                staff={staff}
                month={config.month}
                year={config.year}
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

      {/* Footer */}
      <footer className="border-t border-border mt-auto py-4">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          Hastane Nöbet Planlayıcı • Veriler tarayıcıda saklanır
        </div>
      </footer>
    </div>
  );
}
