import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Save } from 'lucide-react';

const DEFAULT_ROLES = [
  'Architect', 'Client', 'External Project Manager',
  'Internal Project Manager', 'Site Manager', 'Quantity Surveyor', 'Subcontractor'
];

export default function RoleManager() {
  const queryClient = useQueryClient();
  const [newRole, setNewRole] = useState('');

  const { data: settings } = useQuery({
    queryKey: ['appSettings', 'roles'],
    queryFn: async () => {
      const all = await base44.entities.User.list();
      // Roles stored as a JSON string in the first admin user's custom_roles field
      const admin = all.find(u => u.role === 'admin');
      return { customRoles: admin?.custom_roles ? JSON.parse(admin.custom_roles) : [] };
    }
  });

  const { data: adminUser } = useQuery({
    queryKey: ['adminUser'],
    queryFn: async () => {
      const all = await base44.entities.User.list();
      return all.find(u => u.role === 'admin') || null;
    }
  });

  const customRoles = settings?.customRoles || [];
  const allRoles = [...DEFAULT_ROLES, ...customRoles];

  const saveMutation = useMutation({
    mutationFn: async (roles) => {
      if (!adminUser) return;
      await base44.entities.User.update(adminUser.id, { custom_roles: JSON.stringify(roles) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appSettings', 'roles'] });
      queryClient.invalidateQueries({ queryKey: ['adminUser'] });
    }
  });

  const addRole = () => {
    const trimmed = newRole.trim();
    if (!trimmed || allRoles.some(r => r.toLowerCase() === trimmed.toLowerCase())) return;
    saveMutation.mutate([...customRoles, trimmed]);
    setNewRole('');
  };

  const removeCustomRole = (role) => {
    saveMutation.mutate(customRoles.filter(r => r !== role));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Roles</CardTitle>
        <CardDescription>Manage the roles available when adding team members to a project</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Default Roles (read-only)</p>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_ROLES.map(r => (
              <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
            ))}
          </div>
        </div>

        {customRoles.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Custom Roles</p>
            <div className="flex flex-wrap gap-2">
              {customRoles.map(r => (
                <div key={r} className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2.5 py-1 rounded-full">
                  {r}
                  <button onClick={() => removeCustomRole(r)} className="ml-1 hover:text-destructive transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t">
          <Input
            value={newRole}
            onChange={e => setNewRole(e.target.value)}
            placeholder="New role name..."
            className="flex-1"
            onKeyDown={e => { if (e.key === 'Enter') addRole(); }}
          />
          <Button onClick={addRole} disabled={!newRole.trim() || saveMutation.isPending} className="gap-1.5">
            <Plus className="w-4 h-4" /> Add Role
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}