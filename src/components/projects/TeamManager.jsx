import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const ROLES = [
  'Architect', 'Client', 'External Project Manager', 
  'Internal Project Manager', 'Site Manager', 'Quantity Surveyor', 'Subcontractor'
];

const TRADES = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Masonry', 
  'Painting', 'Roofing', 'Flooring', 'Landscaping', 'Demolition',
  'Concrete', 'Steel Erection', 'Glazing', 'Fire Protection'
];

const emptyMember = { user_email: '', full_name: '', business_name: '', phone: '', role: '', trade: '' };

export default function TeamManager({ project }) {
  const [newMember, setNewMember] = useState(emptyMember);
  const [customTrade, setCustomTrade] = useState('');
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (team) => base44.entities.Project.update(project.id, { team }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    }
  });

  const addMember = () => {
    if (!newMember.full_name || !newMember.role) return;
    const member = { ...newMember };
    if (member.role === 'Subcontractor' && customTrade) {
      member.trade = customTrade;
    }
    const team = [...(project.team || []), member];
    updateMutation.mutate(team);
    setNewMember(emptyMember);
    setCustomTrade('');
  };

  const removeMember = (index) => {
    const team = (project.team || []).filter((_, i) => i !== index);
    updateMutation.mutate(team);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="w-5 h-5" /> Team Members
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing members */}
        {(project.team || []).length > 0 ? (
          <div className="space-y-2">
            {(project.team || []).map((member, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{member.full_name}</span>
                    <Badge variant="outline" className="text-xs">{member.role}</Badge>
                    {member.trade && <Badge variant="secondary" className="text-xs">{member.trade}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {[member.business_name, member.user_email, member.phone].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeMember(i)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-2">No team members assigned</p>
        )}

        {/* Add member form */}
        <div className="border-t pt-4 space-y-3">
          <p className="text-sm font-medium">Add Team Member</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Full Name *</Label>
              <Input
                value={newMember.full_name}
                onChange={e => setNewMember({...newMember, full_name: e.target.value})}
                placeholder="Full name"
              />
            </div>
            <div>
              <Label className="text-xs">Role *</Label>
              <Select value={newMember.role} onValueChange={v => setNewMember({...newMember, role: v})}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={newMember.user_email}
                onChange={e => setNewMember({...newMember, user_email: e.target.value})}
                placeholder="Email"
              />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input
                value={newMember.phone}
                onChange={e => setNewMember({...newMember, phone: e.target.value})}
                placeholder="Phone"
              />
            </div>
            <div>
              <Label className="text-xs">Business Name</Label>
              <Input
                value={newMember.business_name}
                onChange={e => setNewMember({...newMember, business_name: e.target.value})}
                placeholder="Business name"
              />
            </div>
            {newMember.role === 'Subcontractor' && (
              <div>
                <Label className="text-xs">Trade</Label>
                <Select value={newMember.trade} onValueChange={v => setNewMember({...newMember, trade: v})}>
                  <SelectTrigger><SelectValue placeholder="Select or type trade" /></SelectTrigger>
                  <SelectContent>
                    {TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    <SelectItem value="custom">Other (type below)</SelectItem>
                  </SelectContent>
                </Select>
                {newMember.trade === 'custom' && (
                  <Input
                    className="mt-2"
                    value={customTrade}
                    onChange={e => setCustomTrade(e.target.value)}
                    placeholder="Enter custom trade"
                  />
                )}
              </div>
            )}
          </div>
          <Button onClick={addMember} disabled={!newMember.full_name || !newMember.role} className="gap-2">
            <Plus className="w-4 h-4" /> Add Member
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}