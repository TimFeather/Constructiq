import React, { useState } from 'react';
import { DocumentFolderTemplate } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, FolderOpen, Save, Star } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const DEFAULT_FOLDERS = [
  'Contracts', 'Drawings', 'Specifications', 'Site Photos',
  'RFIs', 'Submittals', 'QA', 'Safety',
];

export default function DocumentFolderTemplates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newTemplateName, setNewTemplateName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editFolders, setEditFolders] = useState([]);
  const [newFolder, setNewFolder] = useState('');

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
    createMutation.mutate({
      name: newTemplateName.trim(),
      folder_structure: [...DEFAULT_FOLDERS],
      is_default: templates.length === 0,
    });
  };

  const startEdit = (template) => {
    setEditingId(template.id);
    setEditFolders([...(template.folder_structure || [])]);
    setNewFolder('');
  };

  const addFolder = () => {
    const f = newFolder.trim();
    if (!f || editFolders.includes(f)) return;
    setEditFolders(fs => [...fs, f]);
    setNewFolder('');
  };

  const removeFolder = (idx) => {
    setEditFolders(fs => fs.filter((_, i) => i !== idx));
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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">Document Folder Templates</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Define default folder structures applied when creating new projects. Sharing is
          controlled per file, not per folder — mark one template as default.
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
                            data: { folder_structure: editFolders },
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
                    {editFolders.map((folder, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_28px_28px_28px] gap-x-2 items-center py-1 hover:bg-muted/20 rounded px-1">
                        <span className="text-sm truncate">{folder}</span>
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
                    {(template.folder_structure || []).map((f, i) => (
                      <div key={i} className="flex items-center gap-2 py-0.5">
                        <span className="text-xs text-muted-foreground truncate">{f}</span>
                      </div>
                    ))}
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
