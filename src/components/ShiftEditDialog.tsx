import { useEffect, useState } from 'react';
import { Shift, Staff, StaffAssignment } from '@/types/schedule';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { addDays, format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { AlertTriangle, Clock, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dayKey, isStaffUnavailable, notTogetherRelation } from '@/lib/scheduleRules';

interface ShiftEditDialogProps {
  shift: Shift | null;
  /** The whole schedule, to check the rest rule against neighbouring days. */
  shifts: Shift[];
  staff: Staff[];
  /** Staff on duty on the previous month's last day: editing day 1 warns about the rest rule for them. */
  workedPreviousDay?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updatedShift: Shift) => void;
}

export function ShiftEditDialog({ shift, shifts, staff, workedPreviousDay = [], open, onOpenChange, onSave }: ShiftEditDialogProps) {
  const [assignments, setAssignments] = useState<StaffAssignment[]>([]);

  // Start from the saved shift every time the dialog opens. Reopening the same day passes the same `shift`
  // object, so syncing on `shift` alone would bring back changes that were cancelled.
  useEffect(() => {
    if (open && shift) {
      setAssignments([...shift.assignments]);
    }
  }, [open, shift]);

  /** Assignments of people who have since been deleted: listed so they can be removed. */
  const deletedAssignments = (shift?.assignments ?? []).filter(a => !staff.some(s => s.id === a.staffId));

  const handleStaffToggle = (staffId: string, checked: boolean) => {
    if (checked) {
      setAssignments(prev => [...prev, { staffId, duration: 24 }]);
    } else {
      setAssignments(prev => prev.filter(a => a.staffId !== staffId));
    }
  };

  const handleDurationToggle = (staffId: string) => {
    setAssignments(prev => prev.map(a => 
      a.staffId === staffId 
        ? { ...a, duration: a.duration === 24 ? 16 : 24 }
        : a
    ));
  };

  const isStaffSelected = (staffId: string) => assignments.some(a => a.staffId === staffId);
  const getStaffDuration = (staffId: string) => assignments.find(a => a.staffId === staffId)?.duration || 24;

  /** Rules this pick would break. Shown as warnings only: a manual edit may knowingly override them. */
  const getWarnings = (person: Staff): string[] => {
    if (!shift) return [];
    const worksOn = (date: Date) =>
      shifts.some(s => dayKey(s.date) === dayKey(date) && s.assignments.some(a => a.staffId === person.id));
    const warnings: string[] = [];
    if (isStaffUnavailable(person, shift.date)) warnings.push('İzinli / müsait değil');
    if (worksOn(addDays(shift.date, -1))) warnings.push('Önceki gün nöbetçi');
    else if (shift.date.getDate() === 1 && workedPreviousDay.includes(person.id)) warnings.push('Önceki ayın son günü nöbetçi');
    if (worksOn(addDays(shift.date, 1))) warnings.push('Sonraki gün nöbetçi');
    for (const a of assignments) {
      const other = staff.find(o => o.id === a.staffId);
      if (other && other.id !== person.id && notTogetherRelation(person, other) === 'strict') {
        warnings.push(`${other.name} ile kesinlikle ayrı olmalı`);
      }
    }
    return warnings;
  };

  const handleSave = () => {
    if (!shift) return;
    
    onSave({
      ...shift,
      assignments
    });
    onOpenChange(false);
  };

  if (!shift) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Nöbet Düzenle - {format(shift.date, 'd MMMM yyyy', { locale: tr })}
          </DialogTitle>
          <DialogDescription>
            Personel seçin ve her biri için nöbet süresini ayarlayın.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Users className="w-4 h-4" />
            Nöbetçi Personel ({assignments.length} seçili)
          </Label>
          <div className="max-h-80 overflow-y-auto space-y-2 border border-border rounded-lg p-3 bg-muted/30">
            {staff.map(s => {
              const selected = isStaffSelected(s.id);
              const duration = getStaffDuration(s.id);
              const warnings = getWarnings(s);
              
              return (
                <div 
                  key={s.id} 
                  className={cn(
                    "flex items-center justify-between py-2 px-3 rounded-md transition-colors",
                    selected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={`staff-${s.id}`}
                      checked={selected}
                      onCheckedChange={(checked) => handleStaffToggle(s.id, checked as boolean)}
                    />
                    <div className="flex flex-col">
                      <Label 
                        htmlFor={`staff-${s.id}`}
                        className="cursor-pointer text-sm font-medium"
                      >
                        {s.name}
                      </Label>
                      {warnings.length > 0 && (
                        <span className={cn("text-[11px] flex items-center gap-1", selected ? "text-destructive" : "text-muted-foreground")}>
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          {warnings.join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {selected && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDurationToggle(s.id)}
                      className={cn(
                        "h-7 px-2 text-xs font-mono",
                        duration === 24 
                          ? "bg-primary/20 border-primary/50 text-primary" 
                          : "bg-accent/20 border-accent/50 text-accent-foreground"
                      )}
                    >
                      {duration}s
                    </Button>
                  )}
                </div>
              );
            })}
            {deletedAssignments.map(a => (
              <div
                key={a.staffId}
                className={cn(
                  "flex items-center justify-between py-2 px-3 rounded-md",
                  isStaffSelected(a.staffId) ? "bg-destructive/10 border border-destructive/30" : "opacity-60"
                )}
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={`staff-${a.staffId}`}
                    checked={isStaffSelected(a.staffId)}
                    onCheckedChange={(checked) => handleStaffToggle(a.staffId, checked as boolean)}
                  />
                  <div className="flex flex-col">
                    <Label htmlFor={`staff-${a.staffId}`} className="cursor-pointer text-sm font-medium italic">
                      Silinmiş personel ({a.duration}s)
                    </Label>
                    <span className="text-[11px] text-muted-foreground">Bu kişi personel listesinden silindi; işareti kaldırıp kaydedin.</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            💡 Seçili personelin yanındaki butona tıklayarak 24s/16s arasında geçiş yapabilirsiniz. Kimseyi seçmeden kaydederseniz günün nöbeti kaldırılır.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button onClick={handleSave}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
