import React, { useMemo, useState } from 'react';
import { Plus, X, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { normalizeEmail } from '@/lib/normalizeEmail';
import { assignableMembers, memberDisplayName, memberOptionLabel, normalizeName } from '@/lib/scheduleImportResources';
import { assigneeLabel } from '@/lib/programme/assignees';

/**
 * Edit a task's assignees: project team members (who then see the task under
 * "My tasks") and name-only assignees such as "Builder".
 *
 * @param {{ value: Array, onChange: (assignees: Array) => void, team: Array }} props
 *   value is tasks.assignees; team is project.team
 */
export default function AssigneePicker({ value = [], onChange, team = [] }) {
  const members = useMemo(() => assignableMembers(team), [team]);
  const [label, setLabel] = useState('');

  const assigned = new Set(value.filter(a => a.email).map(a => normalizeEmail(a.email)));
  const available = members.filter(m => !assigned.has(m.user_email));

  const addMember = (email) => {
    const member = members.find(m => m.user_email === email);
    if (!member) return;
    onChange([...value, {
      name: memberDisplayName(member), person: member.full_name || null, email: member.user_email, msp_resource_uid: null, units: 1,
    }]);
  };

  const addLabel = () => {
    const name = label.trim();
    setLabel('');
    if (!name || value.some(a => !a.email && normalizeName(a.name) === normalizeName(name))) return;
    onChange([...value, { name, email: null, msp_resource_uid: null, units: 1 }]);
  };

  return (
    <div className="mt-1 space-y-1.5">
      {value.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No one assigned.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {value.map((a, idx) => (
            <span key={`${a.email || a.name}-${idx}`}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 pl-2 pr-1 py-0.5 text-xs"
              title={a.email || 'Name only, no CIQ user'}>
              {a.email && <Mail className="w-3 h-3 text-muted-foreground" />}
              {assigneeLabel(a)}
              <button type="button" aria-label={`Remove ${assigneeLabel(a)}`}
                className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                onClick={() => onChange(value.filter((_, i) => i !== idx))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <Select value="" onValueChange={addMember}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Add team member…" /></SelectTrigger>
          <SelectContent>
            {available.map(m => (
              <SelectItem key={m.user_email} value={m.user_email}>{memberOptionLabel(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-1.5">
        <Input value={label} placeholder="Or add a name, e.g. Builder"
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel(); } }}
          className="h-8 text-xs" />
        <Button type="button" variant="outline" size="sm" className="h-8 px-2 gap-1 text-xs flex-shrink-0"
          disabled={!label.trim()} onClick={addLabel}>
          <Plus className="w-3 h-3" /> Add
        </Button>
      </div>
    </div>
  );
}
