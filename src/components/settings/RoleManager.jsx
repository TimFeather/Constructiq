import React, { useState } from 'react';
import { ProjectRole } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Pencil, X, Check, Shield, Info } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { ROLE_DEFINITIONS } from '@/lib/permissions';

const PERMISSION_ROLES = ['admin', 'internal', 'pricing', 'external'];

const PERMISSION_ROLE_LABELS = {
  admin:    { label: 'Admin',    color: 'bg-red-100 text-red-700 border-red-200' },
  internal: { label: 'Internal', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  pricing:  { label: 'Pricing',  color: 'bg-purple-100 text-purple-700 border-purple-200' },
  external: { label: 'External', color: 'bg-gray-100 text-gray-600 border-gray-200' },
};

function PermissionBadge({ role }) {
  const cfg = PERMISSION_ROLE_LABELS[role] || PERMISSION_ROLE_LABELS.external;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function InheritedPermissions({ permissionRole }) {
  const modules = ROLE_DEFINITIONS[permissionRole]?.permissions || [];
  if (modules.length === 0) return <span className="text-xs text-muted-foreground">None</span>;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {modules.map(m => (
        <span key={m} className="inline-block px-1.5 py-0.5 bg-muted text-muted-foreground text-[10px] rounded capitalize">
          {m}
        </span>
      ))}
    </div>
  );
}

function RoleRow({ role, onDelete, onSave }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(role.name);
  const [editPermRole, setEditPermRole] = useState(role.permission_role);
  const [editDesc, setEditDesc] = useState(role.description || '');

  const handleSave = () => {
    if (!editName.trim()) return;
    onSave(role.id, {
      name: editName.trim(),
      permission_role: editPermRole,
      description: editDesc.trim(),
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditName(role.name);
    setEditPermRole(role.permission_role);
    setEditDesc(role.description || '');
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="border border-primary/30 rounded-lg p-4 space-y-3 bg-primary/5">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Role Name</Label>
            <Input value={editName} onChange={e => setEditName(e.target.value)} className="mt-1 h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Maps to System Role</Label>
            <Select value={editPermRole} onValueChange={setEditPermRole}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_ROLES.map(r => (
                  <SelectItem key={r} value={r}>
                    <span className="capitalize">{r}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs">Description (optional)</Label>
          <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} className="mt-1 h-8 text-sm" placeholder="Brief description..." />
        </div>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleCancel}>
            <X className="w-3 h-3" /> Cancel
          </Button>
          <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSave} disabled={!editName.trim()}>
            <Check className="w-3 h-3" /> Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{role.name}</span>
          <span className="text-muted-foreground text-xs">→</span>
          <PermissionBadge role={role.permission_role} />
          {!role.active && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Inactive</span>
          )}
        </div>
        {role.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>
        )}
        <div className="flex items-center gap-1 mt-1.5">
          <Shield className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="text-[10px] text-muted-foreground mr-1">Inherits:</span>
          <InheritedPermissions permissionRole={role.permission_role} />
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" onClick={() => onDelete(role.id)}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function RoleManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newPermRole, setNewPermRole] = useState('external');
  const [newDesc, setNewDesc] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['projectRoles'],
    queryFn: () => ProjectRole.list('sort_order', 100),
  });

  const createMutation = useMutation({
    mutationFn: (data) => ProjectRole.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectRoles'] });
      setNewName('');
      setNewPermRole('external');
      setNewDesc('');
      setShowForm(false);
      toast({ title: 'Role created', duration: 3000 });
    },
    onError: (e) => toast({ title: 'Failed to create role', description: e.message, variant: 'destructive', duration: 6000 }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => ProjectRole.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectRoles'] });
      toast({ title: 'Role updated', duration: 3000 });
    },
    onError: (e) => toast({ title: 'Failed to update role', description: e.message, variant: 'destructive', duration: 6000 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => ProjectRole.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectRoles'] });
      toast({ title: 'Role removed', duration: 3000 });
    },
    onError: (e) => toast({ title: 'Failed to remove role', description: e.message, variant: 'destructive', duration: 6000 }),
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate({
      name: newName.trim(),
      permission_role: newPermRole,
      description: newDesc.trim(),
      active: true,
      sort_order: roles.length,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Role Management</CardTitle>
          <CardDescription>
            Define project roles and the system permissions they inherit. Future roles can be added here without any code changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Info banner */}
          <div className="flex gap-2 bg-muted/50 border border-border rounded-lg p-3 mb-4 text-xs text-muted-foreground">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Each project role maps to a <strong>system role</strong> (Admin, Internal, Pricing, External) which determines what permissions a user inherits when invited.
              Permissions are defined in the permission engine and cannot be edited here.
            </span>
          </div>

          {/* Role list */}
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}
            </div>
          ) : roles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No roles defined yet. Add your first role below.</p>
          ) : (
            <div>
              {roles.map(role => (
                <RoleRow
                  key={role.id}
                  role={role}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onSave={(id, data) => updateMutation.mutate({ id, data })}
                />
              ))}
            </div>
          )}

          {/* Add new role */}
          <div className="mt-4 pt-4 border-t">
            {!showForm ? (
              <Button variant="outline" className="gap-2 text-sm" onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4" /> Add Role
              </Button>
            ) : (
              <div className="border border-dashed border-border rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium">New Project Role</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Role Name</Label>
                    <Input
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. Estimator"
                      className="mt-1 h-8 text-sm"
                      onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Maps to System Role</Label>
                    <Select value={newPermRole} onValueChange={setNewPermRole}>
                      <SelectTrigger className="mt-1 h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERMISSION_ROLES.map(r => (
                          <SelectItem key={r} value={r}>
                            <span className="capitalize">{r}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Description (optional)</Label>
                  <Input
                    value={newDesc}
                    onChange={e => setNewDesc(e.target.value)}
                    placeholder="Brief description..."
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                {newPermRole && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Inherits <strong className="capitalize">{newPermRole}</strong> permissions:</span>
                    <InheritedPermissions permissionRole={newPermRole} />
                  </div>
                )}
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setShowForm(false); setNewName(''); setNewDesc(''); setNewPermRole('external'); }}>
                    <X className="w-3 h-3" /> Cancel
                  </Button>
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending}>
                    <Plus className="w-3 h-3" /> {createMutation.isPending ? 'Creating...' : 'Create Role'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}