import React, { useState } from 'react';
import { TenderContact } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, Search, Pencil, Trash2, Upload } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const TRADES = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Masonry',
  'Painting', 'Roofing', 'Flooring', 'Landscaping', 'Demolition',
  'Concrete', 'Steel Erection', 'Glazing', 'Fire Protection'
];

const emptyContact = { full_name: '', business_name: '', email: '', phone: '', trade: '', notes: '' };

export default function SubcontractorDirectory() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyContact);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['tenderContacts'],
    queryFn: () => TenderContact.list('-created_at', 500),
  });

  const createMutation = useMutation({
    mutationFn: (data) => TenderContact.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenderContacts'] });
      setShowAdd(false);
      setForm(emptyContact);
      toast({ title: 'Contact added' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => TenderContact.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenderContacts'] });
      setEditingId(null);
      toast({ title: 'Contact updated' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => TenderContact.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenderContacts'] });
    },
  });

  const handleCSVImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target.result;
      const lines = text.trim().split('\n');
      const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
        const row = {};
        header.forEach((h, idx) => { row[h] = cols[idx] || ''; });
        if (row.full_name || row.fullname || row.name) {
          await TenderContact.create({
            full_name: row.full_name || row.fullname || row.name,
            business_name: row.business_name || row.businessname || row.company || '',
            email: row.email || '',
            phone: row.phone || '',
            trade: row.trade || '',
          });
          imported++;
        }
      }
      queryClient.invalidateQueries({ queryKey: ['tenderContacts'] });
      toast({ title: `Imported ${imported} contacts` });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    return !q || c.full_name?.toLowerCase().includes(q) || c.business_name?.toLowerCase().includes(q) || c.trade?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>Subcontractor Directory</CardTitle>
              <CardDescription>{contacts.length} contact{contacts.length !== 1 ? 's' : ''} saved</CardDescription>
            </div>
            <div className="flex gap-2">
              <label>
                <Button variant="outline" size="sm" className="gap-2 cursor-pointer" asChild>
                  <span><Upload className="w-3.5 h-3.5" /> Import CSV</span>
                </Button>
                <input type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
              </label>
              <Button size="sm" className="gap-2" onClick={() => { setForm(emptyContact); setShowAdd(true); }}>
                <Plus className="w-3.5 h-3.5" /> Add Contact
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search contacts..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>

          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{search ? 'No contacts match your search' : 'No contacts yet. Add one or import via CSV.'}</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase">Name</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase hidden md:table-cell">Business</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase hidden sm:table-cell">Trade</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase hidden lg:table-cell">Email</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase hidden lg:table-cell">Phone</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(c => (
                    editingId === c.id ? (
                      <tr key={c.id} className="bg-primary/5">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Full name" className="h-8 text-xs" />
                            <Input value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} placeholder="Business" className="h-8 text-xs" />
                            <Select value={form.trade} onValueChange={v => setForm(f => ({ ...f, trade: v }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Trade" /></SelectTrigger>
                              <SelectContent>{TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                            </Select>
                            <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className="h-8 text-xs" />
                            <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="h-8 text-xs" />
                            <div className="flex gap-1">
                              <Button size="sm" className="h-8 text-xs" onClick={() => updateMutation.mutate({ id: c.id, data: form })} disabled={updateMutation.isPending}>Save</Button>
                              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">{c.full_name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{c.business_name || '—'}</td>
                        <td className="px-4 py-3 hidden sm:table-cell">{c.trade && <span className="bg-muted px-1.5 py-0.5 rounded text-xs">{c.trade}</span>}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell text-xs">{c.email || '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell text-xs">{c.phone || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setForm({ ...c }); setEditingId(c.id); }}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(c.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Full Name *</Label>
              <Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Business Name</Label>
              <Input value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Trade</Label>
              <Select value={form.trade} onValueChange={v => setForm(f => ({ ...f, trade: v }))}>
                <SelectTrigger><SelectValue placeholder="Select trade" /></SelectTrigger>
                <SelectContent>{TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(form)} disabled={!form.full_name || createMutation.isPending}>
              {createMutation.isPending ? 'Adding...' : 'Add Contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}