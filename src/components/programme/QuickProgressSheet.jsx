import React, { useState, useEffect, useRef } from 'react';
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
import { Camera, X, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const QUICK_STEPS = [0, 25, 50, 75, 100];

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

export default function QuickProgressSheet({ task, planned, projectName, open, onOpenChange, saving, onSave }) {
  const [percent, setPercent] = useState(0);
  const [note, setNote] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (task) {
      setPercent(task.percent_complete || 0);
      setNote('');
      setDelayReason('');
      setPhotoFile(null);
    }
  }, [task, open]);

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
  const showDelayReason = runningLate || completedLate;

  const handleSave = () => {
    onSave({
      percent,
      note: note.trim() || null,
      delayReason: delayReason || null,
      photoFile,
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
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
              <div className="flex items-center gap-2 mb-2 p-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-xs text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>This task is past its planned finish</span>
              </div>
              <Label>Delay reason (optional)</Label>
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
          <Button className="h-12 w-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" className="h-12 w-full">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
