import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, Users, UserCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { resolveTemplate, applyTemplate } from '@/lib/emailTemplates';

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
  const { user } = useAuth();
  const isAllowed = user?.role === 'admin' || user?.role === 'internal';
  const [newMember, setNewMember] = useState(emptyMember);
  const [customTrade, setCustomTrade] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const queryClient = useQueryClient();

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: isAllowed,
  });

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: () => base44.entities.EmailTemplate.list(),
  });

  const updateMutation = useMutation({
    mutationFn: (team) => base44.entities.Project.update(project.id, { team }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    }
  });

  const handleEmailInput = (val) => {
    setEmailInput(val);
    setNewMember(prev => ({ ...prev, user_email: val }));
    if (val.length >= 2) {
      const matches = allUsers.filter(u =>
        u.email?.toLowerCase().includes(val.toLowerCase()) ||
        u.full_name?.toLowerCase().includes(val.toLowerCase())
      );
      setSuggestions(matches.slice(0, 5));
    } else {
      setSuggestions([]);
    }
  };

  const selectSuggestion = (u) => {
    setEmailInput(u.email);
    setNewMember(prev => ({
      ...prev,
      user_email: u.email,
      full_name: u.full_name || prev.full_name,
      phone: u.phone || prev.phone,
      business_name: u.business_name || prev.business_name,
    }));
    setSuggestions([]);
  };

  const addMember = async () => {
    if (!newMember.full_name || !newMember.role) return;
    const member = { ...newMember };
    if (member.role === 'Subcontractor' && customTrade) {
      member.trade = customTrade;
    }
    const team = [...(project.team || []), member];
    await updateMutation.mutateAsync(team);

    // Check if this email belongs to a registered user
    const existingUser = allUsers.find(u => u.email?.toLowerCase() === member.user_email?.toLowerCase());
    const tpl = resolveTemplate(emailTemplates, existingUser ? 'team_added' : 'team_invited');

    if (member.user_email) {
      if (existingUser) {
        // Send notification email only to registered users
        const { subject, body } = applyTemplate(tpl, {
          name: member.full_name,
          project_name: project.name,
          role: member.role,
        });
        try {
          await base44.integrations.Core.SendEmail({ to: member.user_email, subject, body });
        } catch (e) {
          // Email failed — not critical
        }
      } else {
        // Invite unregistered users — platform invite handles the notification email
        try {
          await base44.users.inviteUser(member.user_email, 'user');
          await base44.entities.InvitedUser.create({
            email: member.user_email,
            app_role: 'external',
            invited_by_email: user?.email,
            project_id: project.id,
            project_name: project.name,
          });
        } catch (e) {
          // Already invited — that's fine
        }
      }
    }

    setNewMember(emptyMember);
    setEmailInput('');
    setCustomTrade('');
    setSuggestions([]);
  };

  const removeMember = (index) => {
    const team = (project.team || []).filter((_, i) => i !== index);
    updateMutation.mutate(team);
  };

  if (!isAllowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="w-5 h-5" /> Team Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(project.team || []).length > 0 ? (
            <div className="space-y-2">
              {(project.team || []).map((member, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{member.full_name}</span>
                      <Badge variant="outline" className="text-xs">{member.role}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">No team members assigned</p>
          )}
        </CardContent>
      </Card>
    );
  }

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
            {(project.team || []).map((member, i) => {
              const isRegistered = allUsers.some(u => u.email?.toLowerCase() === member.user_email?.toLowerCase());
              return (
                <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{member.full_name}</span>
                      <Badge variant="outline" className="text-xs">{member.role}</Badge>
                      {member.trade && <Badge variant="secondary" className="text-xs">{member.trade}</Badge>}
                      {member.user_email && !isRegistered && (
                        <Badge variant="secondary" className="text-xs text-amber-600 bg-amber-50">Invite Pending</Badge>
                      )}
                      {member.user_email && isRegistered && (
                        <UserCheck className="w-3.5 h-3.5 text-green-600" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {[member.business_name, member.user_email, member.phone].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeMember(i)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
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
                onChange={e => setNewMember({ ...newMember, full_name: e.target.value })}
                placeholder="Full name"
              />
            </div>
            <div>
              <Label className="text-xs">Role *</Label>
              <Select value={newMember.role} onValueChange={v => setNewMember({ ...newMember, role: v })}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="relative">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={emailInput}
                onChange={e => handleEmailInput(e.target.value)}
                placeholder="Email (type to search users)"
                autoComplete="off"
              />
              {suggestions.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-card border rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {suggestions.map(u => (
                    <button
                      key={u.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2"
                      onClick={() => selectSuggestion(u)}
                    >
                      <UserCheck className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                      <span className="font-medium">{u.full_name}</span>
                      <span className="text-muted-foreground text-xs">{u.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input
                value={newMember.phone}
                onChange={e => setNewMember({ ...newMember, phone: e.target.value })}
                placeholder="Phone"
              />
            </div>
            <div>
              <Label className="text-xs">Business Name</Label>
              <Input
                value={newMember.business_name}
                onChange={e => setNewMember({ ...newMember, business_name: e.target.value })}
                placeholder="Business name"
              />
            </div>
            {newMember.role === 'Subcontractor' && (
              <div>
                <Label className="text-xs">Trade</Label>
                <Select value={newMember.trade} onValueChange={v => setNewMember({ ...newMember, trade: v })}>
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
          <Button onClick={addMember} disabled={!newMember.full_name || !newMember.role || updateMutation.isPending} className="gap-2">
            <Plus className="w-4 h-4" /> Add Member
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}