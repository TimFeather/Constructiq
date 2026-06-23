import { invokeFunction } from '@/api/supabaseClient';
import React, { useState, useCallback } from 'react';
import { EmailBranding, EmailTemplate, Project, ProjectRole, User } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, Users, UserCheck, Pencil, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { resolveTemplate, applyTemplate, buildEmailHtml } from '@/lib/emailTemplates';
import { isUserDeactivated, filterActiveUsers } from '@/lib/userStatus';
import { normalizeEmail } from '@/lib/normalizeEmail';

// Fallback roles if ProjectRole entity is empty
const FALLBACK_ROLES = [
  { name: 'Architect', permission_role: 'external' },
  { name: 'Client', permission_role: 'external' },
  { name: 'External Project Manager', permission_role: 'external' },
  { name: 'Internal Project Manager', permission_role: 'internal' },
  { name: 'Site Manager', permission_role: 'internal' },
  { name: 'Quantity Surveyor', permission_role: 'pricing' },
  { name: 'Subcontractor', permission_role: 'external' },
  { name: 'Other', permission_role: 'external' },
];

const TRADES = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Masonry',
  'Painting', 'Roofing', 'Flooring', 'Landscaping', 'Demolition',
  'Concrete', 'Steel Erection', 'Glazing', 'Fire Protection'
];

const emptyMember = { user_email: '', full_name: '', business_name: '', phone: '', role: '', trade: '' };

// Detection status badge
function EmailStatusBadge({ status }) {
  if (!status) return null;
  if (status === 'existing_user') return (
    <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
      🟢 Existing User
    </span>
  );
  if (status === 'pending') return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
      🟡 Pending Invitation
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
      ⚪ New User
    </span>
  );
}

export default function TeamManager({ project }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAllowed = ['admin', 'internal', 'pricing'].includes(user?.role);
  const [newMember, setNewMember] = useState(emptyMember);
  const [customRole, setCustomRole] = useState('');
  const [customTrade, setCustomTrade] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [emailStatus, setEmailStatus] = useState(null); // 'existing_user' | 'pending' | 'new' | null
  const [emailStatusData, setEmailStatusData] = useState(null);
  const [detectingEmail, setDetectingEmail] = useState(false);
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => User.list(),
    enabled: isAllowed,
  });

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: () => EmailTemplate.list(),
  });

  const { data: emailBranding = {} } = useQuery({
    queryKey: ['emailBranding'],
    queryFn: () => EmailBranding.list().then(r => r[0] ?? {}),
  });

  const { data: projectRolesRaw = [] } = useQuery({
    queryKey: ['projectRoles'],
    queryFn: () => ProjectRole.filter({ active: true }, 'sort_order', 100),
    enabled: isAllowed,
  });

  const projectRoles = projectRolesRaw.length > 0 ? projectRolesRaw : FALLBACK_ROLES;

  const updateMutation = useMutation({
    mutationFn: (team) => Project.update(project.id, { team }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    }
  });

  // Debounced email detection
  const detectEmail = useCallback(async (email) => {
    if (!email || email.length < 5 || !email.includes('@')) {
      setEmailStatus(null);
      setEmailStatusData(null);
      return;
    }
    setDetectingEmail(true);
    try {
      const res = await invokeFunction('invitationService', { action: 'detect', email });
      setEmailStatus(res.data?.status || null);
      setEmailStatusData(res.data || null);
      // Auto-fill name if existing user
      if (res.data?.status === 'existing_user' && res.data.user) {
        setNewMember(prev => ({
          ...prev,
          full_name: prev.full_name || res.data.user.full_name || '',
          business_name: prev.business_name || res.data.user.business_name || '',
          phone: prev.phone || res.data.user.phone || '',
        }));
      }
    } catch (e) {
      setEmailStatus(null);
    } finally {
      setDetectingEmail(false);
    }
  }, []);

  const handleEmailInput = (val) => {
    setEmailInput(val);
    setNewMember(prev => ({ ...prev, user_email: val }));
    setEmailStatus(null);
    // Only suggest active users
    if (val.length >= 2) {
      const matches = filterActiveUsers(allUsers).filter(u =>
        u.email?.toLowerCase().includes(val.toLowerCase()) ||
        u.full_name?.toLowerCase().includes(val.toLowerCase())
      );
      setSuggestions(matches.slice(0, 5));
    } else {
      setSuggestions([]);
    }
  };

  const handleEmailBlur = () => {
    setSuggestions([]);
    if (emailInput && emailInput.includes('@')) {
      detectEmail(emailInput);
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
    detectEmail(u.email);
  };

  const addMember = async () => {
    if (!newMember.full_name || !newMember.role) return;
    setAdding(true);
    try {
      const member = { ...newMember, user_email: normalizeEmail(newMember.user_email) };
      if (member.role === 'Subcontractor' && customTrade) member.trade = customTrade;
      if (member.role === 'Other' && customRole) member.role = customRole;

      // Look up permission_role from the selected ProjectRole
      const selectedProjectRole = projectRoles.find(r => r.name === member.role);
      const permissionRole = selectedProjectRole?.permission_role || 'external';

      if (emailStatus === 'existing_user' && emailStatusData?.user) {
        // Route through invitationService for direct add + audit log
        await invokeFunction('invitationService', {
          action: 'addExistingUser',
          targetUserId: emailStatusData.user.id,
          projectId: project.id,
          role: member.role,
          fullName: member.full_name,
          businessName: member.business_name,
          phone: member.phone,
          trade: member.trade,
        });
        // Also send notification email
        const tpl = resolveTemplate(emailTemplates, 'team_added');
        const { subject, body } = applyTemplate(tpl, {
          name: member.full_name,
          project_name: project.name,
          role: member.role,
        });
        try {
          const htmlBody = buildEmailHtml(body, emailBranding);
          await invokeFunction('sendEmail', { to: member.user_email, toName: member.full_name, subject, htmlBody });
        } catch (e) { /* email non-critical */ }

        toast({ title: `${member.full_name} added to project` });

      } else if (member.user_email) {
        // New user or pending — add to team array locally + route through invitationService
        const team = [...(project.team || []), member];
        await updateMutation.mutateAsync(team);

        const res = await invokeFunction('invitationService', {
          action: 'invite',
          email: member.user_email,
          fullName: member.full_name,
          businessName: member.business_name,
          phone: member.phone,
          trade: member.trade,
          projectId: project.id,
          projectName: project.name,
          role: member.role,
          appRole: permissionRole,
          projectRole: member.role,
        });

        const data = res?.data;
        if (data?.duplicateAssignment) {
          toast({ title: `${member.full_name} added to project`, description: 'Existing invitation reused — no duplicate sent.' });
        } else if (data?.isNewInvite) {
          toast({ title: `${member.full_name} added`, description: 'Invitation email sent.' });
        } else {
          toast({ title: `${member.full_name} added to project` });
        }
      } else {
        // No email — just add to team
        const team = [...(project.team || []), member];
        await updateMutation.mutateAsync(team);
        toast({ title: `${member.full_name} added to project` });
      }

      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['invitedUsers'] });
      queryClient.invalidateQueries({ queryKey: ['pendingAssignments'] });

      setNewMember(emptyMember);
      setEmailInput('');
      setCustomTrade('');
      setCustomRole('');
      setSuggestions([]);
      setEmailStatus(null);
      setEmailStatusData(null);
    } catch (e) {
      toast({ title: 'Failed to add member', description: e?.message, variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const removeMember = (index) => {
    const member = (project.team || [])[index];
    const team = (project.team || []).filter((_, i) => i !== index);
    updateMutation.mutate(team);
    // Clean up any pending invite for this member + project
    if (member?.user_email) {
      invokeFunction('invitationService', {
        action: 'cancelProjectInvite',
        email: member.user_email,
        projectId: project.id,
      }).catch(() => { /* non-critical */ });
    }
  };

  const startEdit = (index) => {
    setEditingIndex(index);
    setEditValues({ ...(project.team || [])[index] });
  };

  const saveEdit = () => {
    const team = (project.team || []).map((m, i) => i === editingIndex ? { ...editValues } : m);
    updateMutation.mutate(team);
    setEditingIndex(null);
    setEditValues({});
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditValues({});
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
              {(project.team || []).map((member, i) => {
                const matchedUser = allUsers.find(u => normalizeEmail(u.email) === normalizeEmail(member.user_email));
                const isMemberDeactivated = matchedUser ? isUserDeactivated(matchedUser) : false;
                return (
                  <div key={i} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{member.full_name}</span>
                      <Badge variant="outline" className="text-xs">{member.role}</Badge>
                      {member.trade && <Badge variant="secondary" className="text-xs">{member.trade}</Badge>}
                      {isMemberDeactivated && (
                        <Badge variant="outline" className="text-xs text-red-600 border-red-300 bg-red-50">Deactivated</Badge>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
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
              const matchedUser = allUsers.find(u => normalizeEmail(u.email) === normalizeEmail(member.user_email));
              const isRegistered = !!matchedUser;
              const isMemberDeactivated = matchedUser ? isUserDeactivated(matchedUser) : false;
              const isEditing = editingIndex === i;
              return (
                <div key={i} className={`p-3 rounded-lg border ${isEditing ? 'bg-primary/5 border-primary/20' : 'bg-muted/50 border-transparent'}`}>
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Full Name</Label>
                          <Input className="h-8 text-xs" value={editValues.full_name || ''} onChange={e => setEditValues(v => ({ ...v, full_name: e.target.value }))} />
                        </div>
                        <div>
                          <Label className="text-xs">Role</Label>
                          <Select value={editValues.role || ''} onValueChange={val => setEditValues(v => ({ ...v, role: val }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{projectRoles.map(r => <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Phone</Label>
                          <Input className="h-8 text-xs" value={editValues.phone || ''} onChange={e => setEditValues(v => ({ ...v, phone: e.target.value }))} />
                        </div>
                        <div>
                          <Label className="text-xs">Business Name</Label>
                          <Input className="h-8 text-xs" value={editValues.business_name || ''} onChange={e => setEditValues(v => ({ ...v, business_name: e.target.value }))} />
                        </div>
                        {editValues.role === 'Subcontractor' && (
                          <div>
                            <Label className="text-xs">Trade</Label>
                            <Select value={editValues.trade || ''} onValueChange={val => setEditValues(v => ({ ...v, trade: val }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select trade" /></SelectTrigger>
                              <SelectContent>{TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={saveEdit} disabled={updateMutation.isPending}>Save</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={cancelEdit}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{member.full_name}</span>
                          <Badge variant="outline" className="text-xs">{member.role}</Badge>
                          {member.trade && <Badge variant="secondary" className="text-xs">{member.trade}</Badge>}
                          {member.user_email && !isRegistered && (
                            <Badge variant="secondary" className="text-xs text-amber-600 bg-amber-50">Invite Pending</Badge>
                          )}
                          {member.user_email && isRegistered && !isMemberDeactivated && (
                            <UserCheck className="w-3.5 h-3.5 text-green-600" />
                          )}
                          {isMemberDeactivated && (
                            <Badge variant="outline" className="text-xs text-red-600 border-red-300 bg-red-50">Deactivated</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {[member.business_name, member.user_email, member.phone].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(i)}>
                          <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeMember(i)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  )}
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
                  {projectRoles.map(r => <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {newMember.role === 'Other' && (
                <Input className="mt-2" value={customRole} onChange={e => setCustomRole(e.target.value)} placeholder="Enter custom role..." />
              )}
            </div>
            <div className="relative sm:col-span-2">
              <Label className="text-xs flex items-center gap-2">
                Email
                {detectingEmail && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                {emailStatus && !detectingEmail && <EmailStatusBadge status={emailStatus} />}
              </Label>
              <Input
                type="email"
                value={emailInput}
                onChange={e => handleEmailInput(e.target.value)}
                onBlur={handleEmailBlur}
                placeholder="Email (type to search or detect status)"
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
              {emailStatus === 'pending' && (
                <p className="text-xs text-amber-600 mt-1">An invitation already exists for this email. Adding this project will reuse it — no duplicate will be sent.</p>
              )}
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input value={newMember.phone} onChange={e => setNewMember({ ...newMember, phone: e.target.value })} placeholder="Phone" />
            </div>
            <div>
              <Label className="text-xs">Business Name</Label>
              <Input value={newMember.business_name} onChange={e => setNewMember({ ...newMember, business_name: e.target.value })} placeholder="Business name" />
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
                  <Input className="mt-2" value={customTrade} onChange={e => setCustomTrade(e.target.value)} placeholder="Enter custom trade" />
                )}
              </div>
            )}
          </div>
          <Button
            onClick={addMember}
            disabled={!newMember.full_name || !newMember.role || adding}
            className="gap-2"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {adding ? 'Adding...' : 'Add Member'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}