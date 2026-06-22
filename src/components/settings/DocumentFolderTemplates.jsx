import React, { useState } from 'react';
import { DocumentFolderTemplate } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, FolderOpen, Save, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const ALL_ROLES = ['admin', 'internal', 'pricing', 'external'];

const ROLE_LABELS = {
  admin:    'Admin',
  internal: 'Internal',
  pricing:  'Pricing',
  external: 'External',
};

const DEFAULT_FOLDERS = [
  'Contracts', 'Drawings', 'Specifications', 'Site Photos',
  'RFIs', 'Submittals', 'QA', 'Safety',
];

const DEFAULT_PERMISSIONS = {
  Contracts:        ['admin', 'internal', 'pricing'],
  Drawings:         ['admin', 'internal', 'pricing'],
  Specifications:   ['admin', 'internal', 'pricing'],
  'Site Photos':    ['admin', 'internal', 'pricing'],
  RFIs:             ['admin', 'internal', 'pricing'],
  Submittals:       ['admin', 'internal', 'pricing'],
  QA:               ['admin', 'internal', 'pricing'],
  Safety:           ['admin', 'internal', 'pricing', 'external'],
  'Sub Contractor Uploads': ['admin', 'internal', 'pricing', 'external'],
};

function defaultPermsForFolder(name) {
  return DEFAULT_PERMISSIONS[name] ?? ['admin', 'internal', 'pricing'];
}

export default function DocumentFolderTemplates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newTemplateName, setNewTemplateName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editFolders, setEditFolders] = useState([]);
  const [editPerms, setEditPerms] = useState({});
  const [newFolder, setNewFolder] = useState('');
  const [expandedPerms, setExpandedPerms] = useState(null);

  const { data: templates = [] } = useQuery({
    queryKey: ['documentFolderTemplates'],
    queryFn: () => DocumentFolderTemplate.list('-created_at', 50),
  });

  const createMutation = useMutation({
    mutationFn: (data) => DocumentFolderTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentFolderTemplates'] });
      setNewTemplateName('');
      toast({ title: 'Template created' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => DocumentFolderTemplate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentFolderTemplates'] });
      setEditingId(null);
      toast({ title: 'Template saved' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => DocumentFolderTemplate.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documentFolderTemplates'] }),
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id) => {
      for (const t of templates) {
        if (t.is_default) await DocumentFolderTemplate.update(t.id, { is_default: false });
      }
      return DocumentFolderTemplate.update(id, { is_default: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentFolderTemplates'] });
      toast({ title: 'Default template set' });
    },
  });

  const handleCreate = () => {
    if (!newTemplateName.trim()) return;
    const perms = {};
    DEFAULT_FOLDERS.forEach(f => { perms[f] = defaultPermsForFolder(f); });
    createMutation.mutate({
      name: newTemplateName.trim(),
      folder_structure: [...DEFAULT_FOLDERS],
      folder_permissions: perms,
      is_default: templates.length === 0,
    });
  };

  const startEdit = (template) => {
    setEditingId(template.id);
    setEditFolders([...(template.folder_structure || [])]);
    const basePerms = template.folder_permissions || {};
    const perms = {};
    (template.folder_structure || []).forEach(f => {
      perms[f] = basePerms[f] ?? defaultPermsForFolder(f);
    });
    setEditPerms(perms);
    setNewFolder('');
    setExpandedPerms(null);
  };

  const addFolder = () => {
    const f = newFolder.trim();
    if (!f || editFolders.includes(f)) return;
    setEditFolders(fs => [...fs, f]);
    setEditPerms(p => ({ ...p, [f]: defaultPermsForFolder(f) }));
    setNewFolder('');
  };

  const removeFolder = (idx) => {
    const f = editFolders[idx];
    setEditFolders(fs => fs.filter((_, i) => i !== idx));
    setEditPerms(p => { const next = { ...p }; delete next[f]; return next; });
  };

  const moveFolder = (idx, dir) => {
    setEditFolders(fs => {
      const next = [...fs];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return next;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const toggleRole = (folder, role) => {
    setEditPerms(p => {
      const current = p[folder] ?? [];
      const next = current.includes(role)
        ? current.filter(r => r !== role)
        : [...current, role];
      return { ...p, [folder]: next };
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">Document Folder Templates</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Define default folder structures applied when creating new projects.
          Set which roles can see each folder. Mark one template as default.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={newTemplateName}
          onChange={e => setNewTemplateName(e.target.value)}
          placeholder="Template name (e.g. Standard Residential)"
          className="max-w-sm"
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
        <Button onClick={handleCreate} disabled={!newTemplateName.trim() || createMutation.isPending} className="gap-2">
          <Plus className="w-4 h-4" /> Create
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-10 border rounded-lg text-muted-foreground">
          <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No templates yet. Create one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(template => (
            <Card key={template.id} className={template.is_default ? 'border-primary/40' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">{template.name}</CardTitle>
                    {template.is_default && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">Default</span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    {!template.is_default && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" title="Set as default"
                        onClick={() => setDefaultMutation.mutate(template.id)}>
                        <Star className="w-3 h-3" /> Set Default
                      </Button>
                    )}
                    {editingId !== template.id ? (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startEdit(template)}>
                        Edit
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                        <Button size="sm" className="h-7 text-xs gap-1" disabled={updateMutation.isPending}
                          onClick={() => updateMutation.mutate({
                            id: template.id,
                            data: { folder_structure: editFolders, folder_permissions: editPerms },
                          })}>
                          <Save className="w-3 h-3" /> Save
                        </Button>
                      </>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(template.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                {editingId === template.id ? (
                  <div className="space-y-1">
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto_28px_28px_28px] gap-x-2 items-center px-1 pb-1 border-b">
                      <span className="text-xs font-medium text-muted-foreground">Folder</span>
                      {ALL_ROLES.map(r => (
                        <span key={r} className="text-[10px] font-medium text-muted-foreground text-center w-14">{ROLE_LABELS[r]}</span>
                      ))}
                      <span />
                      <span />
                      <span />
                    </div>

                    {editFolders.map((folder, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto_28px_28px_28px] gap-x-2 items-center py-1 hover:bg-muted/20 rounded px-1">
                        <span className="text-sm truncate">{folder}</span>
                        {ALL_ROLES.map(role => (
                          <div key={role} className="flex justify-center w-14">
                            <input
                              type="checkbox"
                              checked={(editPerms[folder] ?? []).includes(role)}
                              onChange={() => toggleRole(folder, role)}
                              className="w-3.5 h-3.5 accent-primary cursor-pointer"
                              title={`${ROLE_LABELS[role]} can see "${folder}"`}
                            />
                          </div>
                        ))}
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-xs" onClick={() => moveFolder(idx, -1)} disabled={idx === 0}>↑</Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-xs" onClick={() => moveFolder(idx, 1)} disabled={idx === editFolders.length - 1}>↓</Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => removeFolder(idx)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}

                    <div className="flex gap-2 pt-2 border-t mt-1">
                      <Input
                        value={newFolder}
                        onChange={e => setNewFolder(e.target.value)}
                        placeholder="Add folder name..."
                        className="h-7 text-xs"
                        onKeyDown={e => e.key === 'Enter' && addFolder()}
                      />
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addFolder}>Add</Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {(template.folder_structure || []).map((f, i) => {
                      const perms = (template.folder_permissions || {})[f] ?? defaultPermsForFolder(f);
                      return (
                        <div key={i} className="flex items-center justify-between gap-2 py-0.5">
                          <span className="text-xs text-muted-foreground truncate">{f}</span>
                          <div className="flex gap-1 flex-shrink-0">
                            {ALL_ROLES.map(r => (
                              <span key={r} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                perms.includes(r)
                                  ? 'bg-primary/10 text-primary'
                                  : 'bg-muted text-muted-foreground/40'
                              }`}>
                                {ROLE_LABELS[r]}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {(!template.folder_structure?.length) && (
                      <span className="text-xs text-muted-foreground italic">No folders defined</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
