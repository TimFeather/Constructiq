/**
 * Schedule settings for a project's programme: data date (status date the
 * engine schedules remaining work from), the working-week calendar, custom
 * holidays and shutdown periods. NZ public holidays + regional anniversary
 * are generated automatically.
 *
 * Holidays and shutdowns come in two layers, both merged by the engine
 * (buildProjectCalendar): company-wide ones (company_calendar, migration 033,
 * admins only) that apply to every programme, and this programme's own
 * (programmes.calendar JSONB).
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
import { upsertProgramme, updateCompanyCalendar } from '@/api/programmeData';
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

const fmtDate = (d) => format(new Date(`${d}T00:00:00`), 'dd MMM yyyy');
const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

function LayerHeading({ children, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mt-2 first:mt-1">
      <span className="text-[11px] font-semibold text-muted-foreground">{children}</span>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** Custom holiday dates with add/remove, or read-only. */
function HolidayList({ dates, onChange, readOnly = false }) {
  const [newDate, setNewDate] = useState('');
  const add = () => {
    if (!newDate || dates.includes(newDate)) return;
    onChange([...dates, newDate].sort());
    setNewDate('');
  };
  return (
    <>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {dates.map(d => (
          <Badge key={d} variant="secondary" className="gap-1 text-[10px] font-mono">
            {fmtDate(d)}
            {!readOnly && (
              <button type="button" onClick={() => onChange(dates.filter(x => x !== d))} className="hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            )}
          </Badge>
        ))}
        {dates.length === 0 && <span className="text-[11px] text-muted-foreground">None added</span>}
      </div>
      {!readOnly && (
        <div className="flex gap-2 mt-1.5">
          <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="h-8" />
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={!newDate}>Add</Button>
        </div>
      )}
    </>
  );
}

/** Shutdown ranges with add/remove, or read-only. */
function ShutdownList({ ranges, onChange, readOnly = false }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const valid = start && end && start <= end;
  const add = () => {
    if (!valid) return;
    onChange([...ranges, { start, end }]);
    setStart('');
    setEnd('');
  };
  return (
    <>
      <div className="space-y-1.5 mt-1">
        {ranges.map((s, i) => (
          <div key={`${s.start}-${s.end}-${i}`} className="flex items-center justify-between text-[11px] rounded border px-2 py-1">
            <span className="font-mono">{fmtDate(s.start)} – {fmtDate(s.end)}</span>
            {!readOnly && (
              <button type="button" onClick={() => onChange(ranges.filter((_, j) => j !== i))} className="hover:text-destructive">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        {ranges.length === 0 && <span className="text-[11px] text-muted-foreground">None added</span>}
      </div>
      {!readOnly && (
        <div className="flex gap-2 mt-1.5 items-center">
          <Input type="date" value={start} onChange={e => setStart(e.target.value)} className="h-8" placeholder="Start" />
          <span className="text-muted-foreground text-xs">to</span>
          <Input type="date" value={end} onChange={e => setEnd(e.target.value)} className="h-8" placeholder="End" />
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={!valid}>Add</Button>
        </div>
      )}
    </>
  );
}

export default function ScheduleSettingsPopover({ projectId, programme, companyCalendar = null, canEditCompany = false, tasks = [] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dataDate, setDataDate] = useState('');
  const [weekType, setWeekType] = useState('5day');
  const [slackTolerance, setSlackTolerance] = useState('0');
  const [customHolidays, setCustomHolidays] = useState([]);
  const [shutdowns, setShutdowns] = useState([]);
  const [companyHolidays, setCompanyHolidays] = useState([]);
  const [companyShutdowns, setCompanyShutdowns] = useState([]);

  useEffect(() => {
    setDataDate(programme?.data_date || '');
    setWeekType(programme?.calendar?.type || '5day');
    setSlackTolerance(String(programme?.critical_slack_tolerance_days ?? 0));
    setCustomHolidays(programme?.calendar?.holidays || []);
    setShutdowns(programme?.calendar?.shutdowns || []);
    setCompanyHolidays(companyCalendar?.holidays || []);
    setCompanyShutdowns(companyCalendar?.shutdowns || []);
  }, [programme, companyCalendar, open]);

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

  const companyChanged = canEditCompany && (
    !sameList(companyHolidays, companyCalendar?.holidays) || !sameList(companyShutdowns, companyCalendar?.shutdowns)
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      await upsertProgramme(projectId, {
        data_date: dataDate || null,
        critical_slack_tolerance_days: Math.max(0, parseInt(slackTolerance, 10) || 0),
        calendar: {
          ...(programme?.calendar || {}),
          type: weekType,
          holidays: customHolidays,
          shutdowns,
        },
      });
      if (companyChanged) {
        try {
          await updateCompanyCalendar({ holidays: companyHolidays, shutdowns: companyShutdowns });
        } catch (e) {
          throw new Error(`This programme's settings were saved, but not the ones for all programmes: ${e.message}`);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programme'] });
      queryClient.invalidateQueries({ queryKey: ['programmes'] });
      if (companyChanged) queryClient.invalidateQueries({ queryKey: ['company_calendar'] });
      toast({ title: 'Schedule settings saved', duration: 2500 });
      setOpen(false);
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ['programme'] });
      queryClient.invalidateQueries({ queryKey: ['programmes'] });
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    },
  });

  const companyHint = canEditCompany ? 'applies to every programme' : 'set by an admin · every programme';

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
            <Label className="text-xs">Critical slack tolerance (days)</Label>
            <Input
              type="number" min="0" step="1" value={slackTolerance}
              onChange={e => setSlackTolerance(e.target.value)}
              className="mt-1 h-8 w-28"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Tasks are flagged critical when their total float is ≤ this many days
              (same as MS Project's setting). 0 marks only true zero-float tasks;
              higher values also flag near-critical tasks — it widens the net, never
              narrows it.
            </p>
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
            <Label className="text-xs">Shutdown periods</Label>
            <LayerHeading hint={companyHint}>All programmes</LayerHeading>
            <ShutdownList ranges={companyShutdowns} onChange={setCompanyShutdowns} readOnly={!canEditCompany} />
            <LayerHeading>This programme only</LayerHeading>
            <ShutdownList ranges={shutdowns} onChange={setShutdowns} />
          </div>

          <div>
            <Label className="text-xs">Custom holidays</Label>
            <LayerHeading hint={companyHint}>All programmes</LayerHeading>
            <HolidayList dates={companyHolidays} onChange={setCompanyHolidays} readOnly={!canEditCompany} />
            <LayerHeading>This programme only</LayerHeading>
            <HolidayList dates={customHolidays} onChange={setCustomHolidays} />
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
