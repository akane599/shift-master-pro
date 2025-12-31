import { useEffect, useState } from 'react';
import { Shift, Staff } from '@/types/schedule';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Clock, Users } from 'lucide-react';

interface ShiftEditDialogProps {
  shift: Shift | null;
  staff: Staff[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updatedShift: Shift) => void;
}

export function ShiftEditDialog({ shift, staff, open, onOpenChange, onSave }: ShiftEditDialogProps) {
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [duration, setDuration] = useState<16 | 24>(24);

  // Sync state when shift changes
  useEffect(() => {
    if (shift) {
      setSelectedStaffIds([...shift.staffIds]);
      setDuration(shift.duration);
    }
  }, [shift]);

  const handleOpenChange = (open: boolean) => {
    if (open && shift) {
      setSelectedStaffIds([...shift.staffIds]);
      setDuration(shift.duration);
    }
    onOpenChange(open);
  };

  const handleStaffToggle = (staffId: string, checked: boolean) => {
    if (checked) {
      setSelectedStaffIds(prev => [...prev, staffId]);
    } else {
      setSelectedStaffIds(prev => prev.filter(id => id !== staffId));
    }
  };

  const handleSave = () => {
    if (!shift || selectedStaffIds.length === 0) return;
    
    onSave({
      ...shift,
      staffIds: selectedStaffIds,
      duration
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
            Bu gün için nöbet süresini ve nöbetçi personeli güncelleyin.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Duration Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Nöbet Süresi</Label>
            <RadioGroup
              value={duration.toString()}
              onValueChange={(value) => setDuration(Number(value) as 16 | 24)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="24" id="duration-24" />
                <Label htmlFor="duration-24" className="cursor-pointer">24 Saat</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="16" id="duration-16" />
                <Label htmlFor="duration-16" className="cursor-pointer">16 Saat</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Staff Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Users className="w-4 h-4" />
              Nöbetçi Personel ({selectedStaffIds.length} seçili)
            </Label>
            <div className="max-h-64 overflow-y-auto space-y-2 border border-border rounded-lg p-3 bg-muted/30">
              {staff.map(s => (
                <div key={s.id} className="flex items-center space-x-3 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors">
                  <Checkbox
                    id={`staff-${s.id}`}
                    checked={selectedStaffIds.includes(s.id)}
                    onCheckedChange={(checked) => handleStaffToggle(s.id, checked as boolean)}
                  />
                  <Label 
                    htmlFor={`staff-${s.id}`}
                    className="flex-1 cursor-pointer text-sm"
                  >
                    {s.name}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button 
            onClick={handleSave}
            disabled={selectedStaffIds.length === 0}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
