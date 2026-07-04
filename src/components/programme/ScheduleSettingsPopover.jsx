/**
 * Schedule settings for a project's programme: data date (status date the
 * engine schedules remaining work from) and the working-week calendar.
 * NZ public holidays + Hawke's Bay anniversary are applied automatically.
 */
import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { upsertProgramme } from '@/api/programmeData';

export default function ScheduleSettingsPopover({ projectId, programme }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dataDate, setDataDate] = useState('');
  const [weekType, setWeekType] = useState('5day');

  useEffect(() => {
    setDataDate(programme?.data_date || '');
    setWeekType(programme?.calendar?.type || '5day');
  }, [programme, open]);

  const saveMutation = useMutation({
    mutationFn: () => upsertProgramme(projectId, {
      data_date: dataDate || null,
      calendar: { ...(programme?.calendar || {}), type: weekType },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programme'] });
      queryClient.invalidateQueries({ queryKey: ['programmes'] });
      toast({ title: 'Schedule settings saved', duration: 2500 });
      setOpen(false);
    },
    onError: (e) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-9" title="Schedule settings">
          <Settings2 className="w-3.5 h-3.5" /> Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div>
          <Label className="text-xs">Data date (status date)</Label>
          <Input type="date" value={dataDate} onChange={e => setDataDate(e.target.value)} className="mt-1 h-8" />
          <p className="text-[11px] text-muted-foreground mt-1">
            Remaining work is scheduled on or after this date. Leave empty to use today.
          </p>
        </div>
        <div>
          <Label className="text-xs">Working week</Label>
          <Select value={weekType} onValueChange={setWeekType}>
            <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="5day">5-day (Mon–Fri)</SelectItem>
              <SelectItem value="6day">6-day (Mon–Sat)</SelectItem>
              <SelectItem value="7day">7-day</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            NZ public holidays and Hawke's Bay Anniversary are excluded automatically.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
