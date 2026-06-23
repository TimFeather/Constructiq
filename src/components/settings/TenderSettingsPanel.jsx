import React, { useState, useEffect } from 'react';
import { TenderSettings } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Save } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const DEFAULT_ROLES = [
  'Client', 'Architect', 'Project Manager',
  'Quantity Surveyor', 'Site Manager', 'Engineer',
];

const DEFAULT_TOGGLES = {
  notify_lead_on_submission: true,
  notify_admins_on_submission: false,
  send_24h_reminder: true,
  send_immediate_notifications: true,
  send_daily_summary: false,
};

const SUGGESTED_ROLES = [
  'Services Engineer', 'Commercial Manager', 'Structural Engineer',
  'Civil Engineer', 'Interior Designer', 'Landscape Architect',
];

export default function TenderSettingsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState(DEFAULT_ROLES);
  const [newRole, setNewRole] = useState('');
  const [settingsId, setSettingsId] = useState(null);
  const [toggles, setToggles] = useState(DEFAULT_TOGGLES);

  const { data: settingsList = [] } = useQuery({
    queryKey: ['tenderSettings'],
    queryFn: () => TenderSettings.list(),
  });

  useEffect(() => {
    if (settingsList.length > 0) {
      const s = settingsList[0];
      setSettingsId(s.id);
      setRoles(s.default_contact_roles?.length ? s.default_contact_roles : DEFAULT_ROLES);
      setToggles({
        notify_lead_on_submission:   s.notify_lead_on_submission   ?? DEFAULT_TOGGLES.notify_lead_on_submission,
        notify_admins_on_submission: s.notify_admins_on_submission ?? DEFAULT_TOGGLES.notify_admins_on_submission,
        send_24h_reminder:           s.send_24h_reminder           ?? DEFAULT_TOGGLES.send_24h_reminder,
        send_immediate_notifications: s.send_immediate_notifications ?? DEFAULT_TOGGLES.send_immediate_notifications,
        send_daily_summary:          s.send_daily_summary          ?? DEFAULT_TOGGLES.send_daily_summary,
      });
    }
  }, [settingsList]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (settingsId) return TenderSettings.update(settingsId, data);
      return TenderSettings.create(data);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tenderSettings'] });
      if (result?.id && !settingsId) setSettingsId(result.id);
      toast({ title: 'Tender settings saved' });
    },
  });

  const addRole = (role) => {
    const r = (role || newRole).trim();
    if (!r || roles.includes(r)) return;
    setRoles(prev => [...prev, r]);
    setNewRole('');
  };

  const removeRole = (idx) => setRoles(r => r.filter((_, i) => i !== idx));

  const moveRole = (idx, dir) => {
    setRoles(r => {
      const next = [...r];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return next;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">Default Tender Contact Roles</h3>
        <p className="text-xs text-muted-foreground mb-4">
          These roles are pre-populated in the Additional Contacts section when creating a new tender.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-1.5">
          {roles.map((role, idx) => (
            <div key={idx} className="flex items-center gap-2 py-0.5">
              <span className="flex-1 text-sm">{role}</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveRole(idx, -1)} disabled={idx === 0}>↑</Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveRole(idx, 1)} disabled={idx === roles.length - 1}>↓</Button>
              <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => removeRole(idx)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}

          <div className="flex gap-2 pt-2 border-t mt-2">
            <Input
              value={newRole}
              onChange={e => setNewRole(e.target.value)}
              placeholder="Add custom role..."
              className="h-8 text-sm"
              onKeyDown={e => e.key === 'Enter' && addRole()}
            />
            <Button size="sm" variant="outline" className="h-8 px-3" onClick={() => addRole()}>
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick-add suggestions */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Quick add:</p>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_ROLES.filter(r => !roles.includes(r)).map(r => (
            <button key={r} onClick={() => addRole(r)}
              className="text-xs px-2 py-0.5 rounded-full border border-dashed hover:border-primary hover:text-primary transition-colors text-muted-foreground">
              + {r}
            </button>
          ))}
        </div>
      </div>

      {/* Notification Settings */}
      <div>
        <h3 className="text-sm font-semibold mb-1">Notification Settings</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Control which email notifications are sent automatically during the tender lifecycle.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-4">
          {[
            { key: 'notify_lead_on_submission',   label: 'Notify Tender Lead on Submission',    desc: 'Send an email to the assigned Tender Lead when a new submission is received.' },
            { key: 'notify_admins_on_submission',  label: 'Notify Admin Users on Submission',    desc: 'Send an email to all admin users when a new submission is received.' },
            { key: 'send_24h_reminder',            label: 'Send 24 Hour Reminder',               desc: 'Automatically send a reminder to outstanding invitees 24 hours before closing.' },
            { key: 'send_immediate_notifications', label: 'Immediate Outcome Notifications',      desc: 'Send outcome emails to subcontractors immediately when an outcome is recorded.' },
            { key: 'send_daily_summary',           label: 'Daily Summary Notifications',         desc: 'Send a daily digest of outstanding submissions instead of immediate notifications.' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <Label className="text-sm font-medium">{label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <Switch
                checked={!!toggles[key]}
                onCheckedChange={val => setToggles(t => ({ ...t, [key]: val }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate({ default_contact_roles: roles, ...toggles })}
        disabled={saveMutation.isPending} className="gap-2">
        <Save className="w-4 h-4" />
        {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
      </Button>
    </div>
  );
}