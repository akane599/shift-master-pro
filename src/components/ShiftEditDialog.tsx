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
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Clock, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ShiftEditDialogProps {
  shift: Shift | null;
  staff: Staff[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updatedShift: Shift) => void;
}

export function ShiftEditDialog({ shift, staff, open, onOpenChange, onSave }: ShiftEditDialogProps) {
  const [assignments, setAssignments] = useState<StaffAssignment[]>([]);

  useEffect(() => {
    if (shift) {
      setAssignments([...shift.assignments]);
    }
  }, [shift]);

  const handleOpenChange = (open: boolean) => {
    if (open && shift) {
      setAssignments([...shift.assignments]);
    }
    onOpenChange(open);
  };

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

  const handleSave = () => {
    if (!shift || assignments.length === 0) return;
    
    onSave({
      ...shift,
      assignments
    });
    onOpenChange(false);
  };

  if (!shift) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
                    <Label 
                      htmlFor={`staff-${s.id}`}
                      className="cursor-pointer text-sm font-medium"
                    >
                      {s.name}
                    </Label>
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
          </div>
          
          <p className="text-xs text-muted-foreground">
            💡 Seçili personelin yanındaki butona tıklayarak 24s/16s arasında geçiş yapabilirsiniz.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button 
            onClick={handleSave}
            disabled={assignments.length === 0}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
