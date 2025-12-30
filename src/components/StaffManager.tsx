import { useState } from 'react';
import { Staff, DateRange } from '@/types/schedule';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserPlus, X, Users, Calendar, UserMinus, UserCheck, Clock, Palmtree } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface StaffManagerProps {
  staff: Staff[];
  onStaffChange: (staff: Staff[]) => void;
  defaultMonthlyHours: number;
}

export function StaffManager({ staff, onStaffChange, defaultMonthlyHours }: StaffManagerProps) {
  const [newName, setNewName] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ start: Date | undefined; end: Date | undefined }>({
    start: undefined,
    end: undefined
  });

  const updateStaffMonthlyHours = (staffId: string, hours: number | undefined) => {
    onStaffChange(staff.map(s => {
      if (s.id !== staffId) return s;
      return { ...s, monthlyHours: hours };
    }));
  };

  const addStaff = () => {
    if (!newName.trim()) return;
    const newStaff: Staff = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      vacationDays: [],
      unavailableDates: [],
      preferTogether: [],
      preferNotTogether: [],
      preferTogetherStrict: false,
      preferNotTogetherStrict: false
    };
    onStaffChange([...staff, newStaff]);
    setNewName('');
  };

  const removeStaff = (id: string) => {
    // Also remove from others' preferences
    const updatedStaff = staff
      .filter(s => s.id !== id)
      .map(s => ({
        ...s,
        preferTogether: s.preferTogether.filter(pId => pId !== id),
        preferNotTogether: s.preferNotTogether.filter(pId => pId !== id)
      }));
    onStaffChange(updatedStaff);
  };

  const addUnavailableDates = (staffId: string) => {
    if (!dateRange.start || !dateRange.end) return;
    
    onStaffChange(staff.map(s => {
      if (s.id !== staffId) return s;
      return {
        ...s,
        unavailableDates: [...s.unavailableDates, { start: dateRange.start!, end: dateRange.end! }]
      };
    }));
    setDateRange({ start: undefined, end: undefined });
  };

  const removeUnavailableDate = (staffId: string, index: number) => {
    onStaffChange(staff.map(s => {
      if (s.id !== staffId) return s;
      return {
        ...s,
        unavailableDates: s.unavailableDates.filter((_, i) => i !== index)
      };
    }));
  };

  const toggleVacationDay = (staffId: string, date: Date) => {
    onStaffChange(staff.map(s => {
      if (s.id !== staffId) return s;
      const vacationDays = s.vacationDays || [];
      const existingIndex = vacationDays.findIndex(d => 
        d.getFullYear() === date.getFullYear() &&
        d.getMonth() === date.getMonth() &&
        d.getDate() === date.getDate()
      );
      if (existingIndex >= 0) {
        return {
          ...s,
          vacationDays: vacationDays.filter((_, i) => i !== existingIndex)
        };
      } else {
        return {
          ...s,
          vacationDays: [...vacationDays, date]
        };
      }
    }));
  };

  const clearVacationDays = (staffId: string) => {
    onStaffChange(staff.map(s => {
      if (s.id !== staffId) return s;
      return { ...s, vacationDays: [] };
    }));
  };

  const togglePreferTogetherStrict = (staffId: string) => {
    onStaffChange(staff.map(s => {
      if (s.id !== staffId) return s;
      return { ...s, preferTogetherStrict: !s.preferTogetherStrict };
    }));
  };

  const togglePreferNotTogetherStrict = (staffId: string) => {
    onStaffChange(staff.map(s => {
      if (s.id !== staffId) return s;
      return { ...s, preferNotTogetherStrict: !s.preferNotTogetherStrict };
    }));
  };

  const togglePreferTogether = (staffId: string, partnerId: string) => {
    onStaffChange(staff.map(s => {
      if (s.id !== staffId) return s;
      const isCurrentlyPreferred = s.preferTogether.includes(partnerId);
      return {
        ...s,
        preferTogether: isCurrentlyPreferred 
          ? s.preferTogether.filter(id => id !== partnerId)
          : [...s.preferTogether, partnerId],
        preferNotTogether: s.preferNotTogether.filter(id => id !== partnerId) // Remove from not-together if adding to together
      };
    }));
  };

  const togglePreferNotTogether = (staffId: string, partnerId: string) => {
    onStaffChange(staff.map(s => {
      if (s.id !== staffId) return s;
      const isCurrentlyNotPreferred = s.preferNotTogether.includes(partnerId);
      return {
        ...s,
        preferNotTogether: isCurrentlyNotPreferred 
          ? s.preferNotTogether.filter(id => id !== partnerId)
          : [...s.preferNotTogether, partnerId],
        preferTogether: s.preferTogether.filter(id => id !== partnerId) // Remove from together if adding to not-together
      };
    }));
  };

  const selectedStaff = staff.find(s => s.id === selectedStaffId);

  return (
    <div className="space-y-6">
      {/* Add new staff */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Personel Ekle
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="İsim girin..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addStaff()}
              className="flex-1"
            />
            <Button onClick={addStaff} className="shrink-0">
              <UserPlus className="w-4 h-4 mr-2" />
              Ekle
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Staff list */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Personel Listesi ({staff.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              Henüz personel eklenmedi
            </p>
          ) : (
            <div className="grid gap-2">
              {staff.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setSelectedStaffId(selectedStaffId === s.id ? null : s.id)}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all",
                    selectedStaffId === s.id 
                      ? "bg-primary/20 border border-primary/50" 
                      : "bg-secondary/50 hover:bg-secondary"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium">
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <span className="font-medium">{s.name}</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.monthlyHours !== undefined && s.monthlyHours < defaultMonthlyHours && (
                          <Badge variant="outline" className="text-xs bg-warning/20 text-warning border-warning/50">
                            {s.monthlyHours}h
                          </Badge>
                        )}
                        {(s.vacationDays?.length || 0) > 0 && (
                          <Badge variant="outline" className="text-xs bg-amber-500/20 text-amber-500 border-amber-500/50">
                            {s.vacationDays.length} izin günü
                          </Badge>
                        )}
                        {s.unavailableDates.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {s.unavailableDates.length} müsait değil
                          </Badge>
                        )}
                        {s.preferTogether.length > 0 && (
                          <Badge variant="outline" className={cn(
                            "text-xs",
                            s.preferTogetherStrict 
                              ? "bg-success text-success-foreground border-success" 
                              : "bg-success/20 text-success border-success/50"
                          )}>
                            {s.preferTogether.length} birlikte {s.preferTogetherStrict && "(zorunlu)"}
                          </Badge>
                        )}
                        {s.preferNotTogether.length > 0 && (
                          <Badge variant="outline" className={cn(
                            "text-xs",
                            s.preferNotTogetherStrict 
                              ? "bg-destructive text-destructive-foreground border-destructive" 
                              : "bg-destructive/20 text-destructive border-destructive/50"
                          )}>
                            {s.preferNotTogether.length} ayrı {s.preferNotTogetherStrict && "(zorunlu)"}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeStaff(s.id);
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Staff details panel */}
      {selectedStaff && (
        <Card className="glass-card animate-fade-in">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {selectedStaff.name} - Detaylar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Individual monthly hours */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Aylık Mesai Saati
              </h4>
              <p className="text-xs text-muted-foreground mb-2">
                Yıllık izin gibi durumlarda kişiye özel mesai saati belirleyebilirsiniz.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder={`Varsayılan: ${defaultMonthlyHours}`}
                  value={selectedStaff.monthlyHours ?? ''}
                  onChange={(e) => {
                    const value = e.target.value ? parseInt(e.target.value) : undefined;
                    updateStaffMonthlyHours(selectedStaff.id, value);
                  }}
                  className="w-32"
                />
                {selectedStaff.monthlyHours !== undefined && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => updateStaffMonthlyHours(selectedStaff.id, undefined)}
                  >
                    Sıfırla
                  </Button>
                )}
                <span className="text-sm text-muted-foreground">saat</span>
              </div>
              {selectedStaff.monthlyHours !== undefined && selectedStaff.monthlyHours < defaultMonthlyHours && (
                <Badge variant="outline" className="mt-2 text-xs bg-warning/20 text-warning border-warning/50">
                  {defaultMonthlyHours - selectedStaff.monthlyHours} saat az çalışacak
                </Badge>
              )}
            </div>

            {/* Vacation Days - for annual leave */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Palmtree className="w-4 h-4 text-amber-500" />
                Yıllık İzin Günleri
              </h4>
              <p className="text-xs text-muted-foreground mb-2">
                Yıllık izindeyken çalışmayacağı günleri seçin. Bu günlerde nöbet yazılmaz.
              </p>
              {(selectedStaff.vacationDays?.length || 0) > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {selectedStaff.vacationDays.map((date, idx) => (
                    <Badge key={idx} variant="secondary" className="flex items-center gap-1 bg-amber-500/20 text-amber-500 border-amber-500/50">
                      {format(date, 'd MMM', { locale: tr })}
                      <X 
                        className="w-3 h-3 cursor-pointer hover:text-destructive" 
                        onClick={() => toggleVacationDay(selectedStaff.id, date)}
                      />
                    </Badge>
                  ))}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-xs"
                    onClick={() => clearVacationDays(selectedStaff.id)}
                  >
                    Tümünü Temizle
                  </Button>
                </div>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Calendar className="w-4 h-4 mr-2" />
                    İzin Günü Seç
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="multiple"
                    selected={selectedStaff.vacationDays || []}
                    onSelect={(dates) => {
                      if (dates) {
                        onStaffChange(staff.map(s => {
                          if (s.id !== selectedStaff.id) return s;
                          return { ...s, vacationDays: dates };
                        }));
                      }
                    }}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Unavailable dates */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                Müsait Olmayan Tarih Aralıkları
              </h4>
              <p className="text-xs text-muted-foreground mb-2">
                Belirli tarih aralıklarında çalışamayacağı günler.
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedStaff.unavailableDates.map((range, idx) => (
                  <Badge key={idx} variant="secondary" className="flex items-center gap-1">
                    {format(range.start, 'd MMM', { locale: tr })} - {format(range.end, 'd MMM', { locale: tr })}
                    <X 
                      className="w-3 h-3 cursor-pointer hover:text-destructive" 
                      onClick={() => removeUnavailableDate(selectedStaff.id, idx)}
                    />
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2 items-end">
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Başlangıç</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-32">
                        {dateRange.start ? format(dateRange.start, 'd MMM', { locale: tr }) : 'Seç'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={dateRange.start}
                        onSelect={(date) => setDateRange(prev => ({ ...prev, start: date }))}
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Bitiş</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-32">
                        {dateRange.end ? format(dateRange.end, 'd MMM', { locale: tr }) : 'Seç'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={dateRange.end}
                        onSelect={(date) => setDateRange(prev => ({ ...prev, end: date }))}
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <Button 
                  size="sm" 
                  onClick={() => addUnavailableDates(selectedStaff.id)}
                  disabled={!dateRange.start || !dateRange.end}
                >
                  Ekle
                </Button>
              </div>
            </div>

            {/* Prefer together */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-success" />
                  Birlikte Çalışmak İstediği Kişiler
                </h4>
                {selectedStaff.preferTogether.length > 0 && (
                  <div className="flex gap-1">
                    <Button
                      variant={selectedStaff.preferTogetherStrict ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "text-xs h-7",
                        selectedStaff.preferTogetherStrict 
                          ? "bg-success hover:bg-success/80" 
                          : "hover:bg-success/20"
                      )}
                      onClick={() => togglePreferTogetherStrict(selectedStaff.id)}
                    >
                      {selectedStaff.preferTogetherStrict ? "✓ %100 Zorunlu" : "%100 Zorunlu"}
                    </Button>
                    <Button
                      variant={!selectedStaff.preferTogetherStrict ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "text-xs h-7",
                        !selectedStaff.preferTogetherStrict 
                          ? "bg-success/70 hover:bg-success/60" 
                          : "hover:bg-success/20"
                      )}
                      onClick={() => {
                        if (selectedStaff.preferTogetherStrict) {
                          togglePreferTogetherStrict(selectedStaff.id);
                        }
                      }}
                    >
                      {!selectedStaff.preferTogetherStrict ? "✓ Optimize (%60-75)" : "Optimize (%60-75)"}
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {selectedStaff.preferTogetherStrict 
                  ? "Bu kişilerle mümkün oldukça aynı nöbette olacak." 
                  : "Algoritma eşitliği bozmadan %60-75 oranında birlikte yazmaya çalışacak."}
              </p>
              <div className="flex flex-wrap gap-2">
                {staff.filter(s => s.id !== selectedStaff.id).map(s => (
                  <Badge
                    key={s.id}
                    variant={selectedStaff.preferTogether.includes(s.id) ? "default" : "outline"}
                    className={cn(
                      "cursor-pointer transition-all",
                      selectedStaff.preferTogether.includes(s.id) 
                        ? "bg-success text-success-foreground hover:bg-success/80" 
                        : "hover:bg-success/20"
                    )}
                    onClick={() => togglePreferTogether(selectedStaff.id, s.id)}
                  >
                    {s.name}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Prefer not together */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium flex items-center gap-2">
                  <UserMinus className="w-4 h-4 text-destructive" />
                  Birlikte Çalışmak İstemediği Kişiler
                </h4>
                {selectedStaff.preferNotTogether.length > 0 && (
                  <div className="flex gap-1">
                    <Button
                      variant={selectedStaff.preferNotTogetherStrict ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "text-xs h-7",
                        selectedStaff.preferNotTogetherStrict 
                          ? "bg-destructive hover:bg-destructive/80" 
                          : "hover:bg-destructive/20"
                      )}
                      onClick={() => togglePreferNotTogetherStrict(selectedStaff.id)}
                    >
                      {selectedStaff.preferNotTogetherStrict ? "✓ %100 Zorunlu" : "%100 Zorunlu"}
                    </Button>
                    <Button
                      variant={!selectedStaff.preferNotTogetherStrict ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "text-xs h-7",
                        !selectedStaff.preferNotTogetherStrict 
                          ? "bg-destructive/70 hover:bg-destructive/60" 
                          : "hover:bg-destructive/20"
                      )}
                      onClick={() => {
                        if (selectedStaff.preferNotTogetherStrict) {
                          togglePreferNotTogetherStrict(selectedStaff.id);
                        }
                      }}
                    >
                      {!selectedStaff.preferNotTogetherStrict ? "✓ Optimize (%60-75)" : "Optimize (%60-75)"}
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {selectedStaff.preferNotTogetherStrict 
                  ? "Bu kişilerle kesinlikle aynı nöbete yazılmayacak." 
                  : "Algoritma eşitliği bozmadan ayrı tutmaya çalışacak."}
              </p>
              <div className="flex flex-wrap gap-2">
                {staff.filter(s => s.id !== selectedStaff.id).map(s => (
                  <Badge
                    key={s.id}
                    variant={selectedStaff.preferNotTogether.includes(s.id) ? "default" : "outline"}
                    className={cn(
                      "cursor-pointer transition-all",
                      selectedStaff.preferNotTogether.includes(s.id) 
                        ? "bg-destructive text-destructive-foreground hover:bg-destructive/80" 
                        : "hover:bg-destructive/20"
                    )}
                    onClick={() => togglePreferNotTogether(selectedStaff.id, s.id)}
                  >
                    {s.name}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
