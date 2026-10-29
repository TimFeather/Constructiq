import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Camera, X, AlertTriangle, Lock } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { cn } from '@/lib/utils';

const QUICK_STEPS = [0, 25, 50, 75, 100];

// "Need more time?" — working days to add
const EXTEND_STEPS = [
  { days: 0.5, label: '+½ day' },
  { days: 1, label: '+1 day' },
  { days: 2, label: '+2 days' },
  { days: 5, label: '+5 days' },
];

const fmtDay = (dateStr) => format(new Date(`${dateStr}T00:00:00`), 'EEE d MMM');
const daysLabel = (n) => `${n} day${n === 1 ? '' : 's'}`;

const DELAY_REASONS = [
  { value: 'weather', label: 'Weather' },
  { value: 'materials', label: 'Materials' },
  { value: 'labour', label: 'Labour' },
  { value: 'design_change', label: 'Design change' },
  { value: 'client_variation', label: 'Client variation' },
  { value: 'site_access', label: 'Site access' },
  { value: 'other', label: 'Other' },
];

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * @param {boolean} [canExtend] - show "Need more time?" (task not a milestone, programme not locked)
 * @param {boolean} [locked] - programme is locked, so explain why days can't be added
 * @param {Function} [previewExtension] - (percent, extraDays) => { duration, finishStr }
 * @param {Function} [extraDaysForFinish] - (currentFinishStr, newFinishStr) => working days
 */
export default function QuickProgressSheet({
  task, planned, projectName, open, onOpenChange, saving, onSave,
  canExtend = false, locked = false, previewExtension, extraDaysForFinish,
}) {
  const [percent, setPercent] = useState(0);
  const [note, setNote] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  // Extension: a quick step, or working days derived from a picked finish date
  const [stepDays, setStepDays] = useState(0);
  const [newFinish, setNewFinish] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (task) {
      setPercent(task.percent_complete || 0);
      setNote('');
      setDelayReason('');
      setPhotoFile(null);
      setStepDays(0);
      setNewFinish('');
    }
  }, [task, open]);

  // Finishing the task makes "more time" moot — the actual finish records the slip
  const extending = canExtend && percent < 100;
  const extraDays = !extending ? 0
    : newFinish ? (extraDaysForFinish?.(planned?.finishStr, newFinish) || 0)
    : stepDays;

  const preview = useMemo(
    // previewExtension is a fresh closure each render; task/percent/days decide the result
    () => (extraDays > 0 ? previewExtension?.(percent, extraDays) : null),
    [task?.id, percent, extraDays],
  );

  useEffect(() => {
    if (photoFile) {
      const url = URL.createObjectURL(photoFile);
      setPhotoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPhotoUrl(null);
  }, [photoFile]);

  if (!task) return null;

  const today = todayStr();
  const runningLate = !!(planned?.finishStr && planned.finishStr < today && percent < 100);
  const completedLate = !!(percent >= 100 && planned?.finishStr && today > planned.finishStr);
  // Adding days always needs a reason, so the programme shows why it slipped
  const reasonRequired = extraDays > 0;
  const showDelayReason = runningLate || completedLate || reasonRequired;
  const missingReason = reasonRequired && !delayReason;

  const pickStep = (days) => {
    setNewFinish('');
    setStepDays(prev => (prev === days ? 0 : days));
  };

  const handleSave = () => {
    onSave({
      percent,
      note: note.trim() || null,
      delayReason: delayReason || null,
      photoFile,
      extraDays,
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2 flex-wrap">
            <span className="truncate">{task.name}</span>
            {task.wbs && <Badge variant="outline" className="text-xs font-mono">{task.wbs}</Badge>}
          </DrawerTitle>
          <DrawerDescription>
            {projectName ? `${projectName} · ` : ''}
            {planned?.finishStr ? `Planned finish ${format(new Date(planned.finishStr), 'dd MMM yy')}` : 'No planned finish'}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-5 overflow-y-auto">
          <div>
            <div className="grid grid-cols-5 gap-2">
              {QUICK_STEPS.map((step) => (
                <Button
                  key={step}
                  type="button"
                  variant={percent === step ? 'default' : 'outline'}
                  className="h-12 text-base font-semibold"
                  onClick={() => setPercent(step)}
                >
                  {step}
                </Button>
              ))}
            </div>
            <div className="mt-4 flex flex-col items-center gap-2">
              <span className="text-2xl font-bold text-primary">{percent}%</span>
              <Slider
                value={[percent]}
                onValueChange={([v]) => setPercent(v)}
                max={100}
                step={5}
                className="w-full"
              />
            </div>
          </div>

          {extending && (
            <div>
              <Label>Need more time?</Label>
              <div className="mt-1 grid grid-cols-4 gap-2">
                {EXTEND_STEPS.map(({ days, label }) => (
                  <Button
                    key={days}
                    type="button"
                    variant={!newFinish && stepDays === days ? 'default' : 'outline'}
                    className="h-12 px-1 text-sm font-semibold"
                    onClick={() => pickStep(days)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground flex-shrink-0">or new finish date</span>
                <Input
                  type="date"
                  value={newFinish}
                  min={planned?.finishStr ? format(addDays(new Date(`${planned.finishStr}T00:00:00`), 1), 'yyyy-MM-dd') : undefined}
                  onChange={(e) => { setStepDays(0); setNewFinish(e.target.value); }}
                  className="h-10"
                />
              </div>
              {preview?.finishStr && (
                <div className="mt-2 p-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-200">
                  <span className="font-semibold">Finishes {fmtDay(preview.finishStr)}</span>
                  {planned?.finishStr ? ` (was ${fmtDay(planned.finishStr)})` : ''}
                  {' · '}{daysLabel(task.duration ?? 1)} → {daysLabel(preview.duration)}
                  <span className="block text-amber-700/80 dark:text-amber-200/70">Linked tasks after it move too.</span>
                </div>
              )}
              {newFinish && extraDays === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">Pick a working day after the planned finish.</p>
              )}
            </div>
          )}

          {locked && percent < 100 && !(task.is_milestone || task.duration === 0) && (
            <div className="flex items-center gap-2 p-2 rounded-md border text-xs text-muted-foreground">
              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
              <span>This programme is locked — ask an admin to add days.</span>
            </div>
          )}

          <div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note (optional)…"
              className="h-20"
            />
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
            />
            {photoUrl ? (
              <div className="relative inline-block">
                <img src={photoUrl} alt="Progress photo" className="h-20 w-20 rounded-md object-cover border" />
                <button
                  type="button"
                  onClick={() => {
                    setPhotoFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="w-4 h-4 mr-2" />
                Add photo
              </Button>
            )}
          </div>

          {showDelayReason && (
            <div>
              {(runningLate || completedLate) && (
                <div className="flex items-center gap-2 mb-2 p-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-xs text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>This task is past its planned finish</span>
                </div>
              )}
              <Label>Delay reason {reasonRequired ? '(required to add days)' : '(optional)'}</Label>
              <Select value={delayReason} onValueChange={setDelayReason}>
                <SelectTrigger className={cn('mt-1')}>
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {DELAY_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DrawerFooter>
          <Button className="h-12 w-full" onClick={handleSave} disabled={saving || missingReason}>
            {saving ? 'Saving…' : missingReason ? 'Pick a delay reason to add days' : extraDays > 0 ? `Save & add ${daysLabel(extraDays)}` : 'Save'}
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" className="h-12 w-full">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
