/**
 * Schedule settings for a project's programme: data date (status date the
 * engine schedules remaining work from), the working-week calendar, custom
 * holidays and shutdown periods. NZ public holidays + regional anniversary
 * are generated automatically — this dialog only manages the calendar JSONB
 * (programmes.calendar); the engine (buildProjectCalendar) already merges
 * generated + custom holidays and reads shutdowns, so this is UI-only work.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings2, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { upsertProgramme } from '@/api/programmeData';
import { getNzHolidaysForRange } from '@/lib/scheduling/nzHolidays';
import { format } from 'date-fns';

function yearSpan(tasks) {
  const years = (tasks || [])
    .flatMap(t => [t.start_date, t.end_date])
    .filter(Boolean)
    .map(d => parseInt(String(d).slice(0, 4), 10))
    .filter(y => y > 2000 && y < 2100);
  const thisYear = new Date().getFullYear();
  const startYear = years.length ? Math.min(...years, thisYear) : thisYear;
  const endYear = (years.length ? Math.max(...years, thisYear) : thisYear) + 2;
  return { startYear, endYear };
}

export default function ScheduleSettingsPopover({ projectId, programme, tasks = [] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dataDate, setDataDate] = useState('');
  const [weekType, setWeekType] = useState('5day');
  const [customHolidays, setCustomHolidays] = useState([]);
  const [shutdowns, setShutdowns] = useState([]);
  const [newHoliday, setNewHoliday] = useState('');
  const [newShutdownStart, setNewShutdownStart] = useState('');
  const [newShutdownEnd, setNewShutdownEnd] = useState('');

  useEffect(() => {
    setDataDate(programme?.data_date || '');
    setWeekType(programme?.calendar?.type || '5day');
    setCustomHolidays(programme?.calendar?.holidays || []);
    setShutdowns(programme?.calendar?.shutdowns || []);
    setNewHoliday('');
    setNewShutdownStart('');
    setNewShutdownEnd('');
  }, [programme, open]);

  const region = programme?.calendar?.region || 'hawkes-bay';
  const { startYear, endYear } = useMemo(() => yearSpan(tasks), [tasks]);

  const generatedByYear = useMemo(() => {
    const dates = getNzHolidaysForRange(startYear, endYear, { region });
    const grouped = new Map();
    for (const d of dates) {
      const year = d.slice(0, 4);
      if (!grouped.has(year)) grouped.set(year, []);
      grouped.get(year).push(d);
    }
    return grouped;
  }, [startYear, endYear, region]);

  const addHoliday = () => {
    if (!newHoliday || customHolidays.includes(newHoliday)) return;
    setCustomHolidays(h => [...h, newHoliday].sort());
    setNewHoliday('');
  };

  const removeHoliday = (date) => setCustomHolidays(h => h.filter(d => d !== date));

  const addShutdown = () => {
    if (!newShutdownStart || !newShutdownEnd || newShutdownStart > newShutdownEnd) return;
    setShutdowns(s => [...s, { start: newShutdownStart, end: newShutdownEnd }]);
    setNewShutdownStart('');
    setNewShutdownEnd('');
  };

  const removeShutdown = (idx) => setShutdowns(s => s.filter((_, i) => i !== idx));

  const saveMutation = useMutation({
    mutationFn: () => upsertProgramme(projectId, {
      data_date: dataDate || null,
      calendar: {
        ...(programme?.calendar || {}),
        type: weekType,
        holidays: customHolidays,
        shutdowns,
      },
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-9" title="Schedule settings">
          <Settings2 className="w-3.5 h-3.5" /> Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Schedule Settings</DialogTitle></DialogHeader>

        <div className="space-y-5">
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
                <SelectItem value="6day">6-day (Mon–Sat — Saturdays worked)</SelectItem>
                <SelectItem value="7day">7-day</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">NZ public holidays ({startYear}–{endYear})</Label>
            <div className="mt-1 max-h-36 overflow-y-auto rounded border p-2 space-y-1.5">
              {Array.from(generatedByYear.entries()).map(([year, dates]) => (
                <div key={year} className="text-[11px]">
                  <span className="font-semibold text-muted-foreground">{year}</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {dates.map(d => (
                      <span key={d} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                        {format(new Date(`${d}T00:00:00`), 'dd MMM')}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Generated automatically — excluded from the working calendar with no setup needed.
              Matariki dates are gazetted through 2035.
            </p>
          </div>

          <div>
            <Label className="text-xs">Custom holidays</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {customHolidays.map(d => (
                <Badge key={d} variant="secondary" className="gap-1 text-[10px] font-mono">
                  {format(new Date(`${d}T00:00:00`), 'dd MMM yyyy')}
                  <button onClick={() => removeHoliday(d)} className="hover:text-destructive">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              {customHolidays.length === 0 && (
                <span className="text-[11px] text-muted-foreground">None added</span>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <Input type="date" value={newHoliday} onChange={e => setNewHoliday(e.target.value)} className="h-8" />
              <Button type="button" variant="outline" size="sm" onClick={addHoliday} disabled={!newHoliday}>Add</Button>
            </div>
          </div>

          <div>
            <Label className="text-xs">Shutdown periods</Label>
            <div className="space-y-1.5 mt-1.5">
              {shutdowns.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] rounded border px-2 py-1">
                  <span className="font-mono">
                    {format(new Date(`${s.start}T00:00:00`), 'dd MMM yyyy')} – {format(new Date(`${s.end}T00:00:00`), 'dd MMM yyyy')}
                  </span>
                  <button onClick={() => removeShutdown(i)} className="hover:text-destructive">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {shutdowns.length === 0 && (
                <span className="text-[11px] text-muted-foreground">None added</span>
              )}
            </div>
            <div className="flex gap-2 mt-2 items-center">
              <Input type="date" value={newShutdownStart} onChange={e => setNewShutdownStart(e.target.value)} className="h-8" placeholder="Start" />
              <span className="text-muted-foreground text-xs">to</span>
              <Input type="date" value={newShutdownEnd} onChange={e => setNewShutdownEnd(e.target.value)} className="h-8" placeholder="End" />
              <Button
                type="button" variant="outline" size="sm" onClick={addShutdown}
                disabled={!newShutdownStart || !newShutdownEnd || newShutdownStart > newShutdownEnd}
              >
                Add
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
