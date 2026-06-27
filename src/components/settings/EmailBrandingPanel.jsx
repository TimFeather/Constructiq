import { uploadFile } from '@/api/supabaseClient';
import React, { useState, useEffect, useRef } from 'react';
import { EmailBranding } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Save, Upload, X, Eye } from 'lucide-react';
import { buildEmailHtml } from '@/lib/emailTemplates';

export default function EmailBrandingPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [form, setForm] = useState({
    logo_url: '',
    logo_width: 160,
    logo_alignment: 'left',
    brand_colour: '#1a56db',
    footer_text: '',
    company_name: '',
    sender_name: '',
    sender_email: '',
  });

  const { data: brandingRecords = [] } = useQuery({
    queryKey: ['emailBranding'],
    queryFn: () => EmailBranding.list(),
  });

  const branding = brandingRecords[0] || null;

  useEffect(() => {
    if (branding) {
      setForm({
        logo_url: branding.logo_url || '',
        logo_width: branding.logo_width || 160,
        logo_alignment: branding.logo_alignment || 'left',
        brand_colour: branding.brand_colour || '#1a56db',
        footer_text: branding.footer_text || '',
        company_name: branding.company_name || '',
        sender_name: branding.sender_name || '',
        sender_email: branding.sender_email || '',
      });
    }
  }, [branding]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (branding?.id) {
        const result = await EmailBranding.update(branding.id, data);
        if (!result) throw new Error('Update returned no data — check your permissions');
        return result;
      } else {
        return EmailBranding.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailBranding'] });
      toast({ title: 'Branding saved' });
    },
    onError: (e) => {
      toast({ title: 'Save failed', description: e?.message || 'Check your permissions', variant: 'destructive' });
    },
  });

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await uploadFile(file);
      setForm(f => ({ ...f, logo_url: file_url }));
      toast({ title: 'Logo uploaded', duration: 4000 });
    } catch (err) {
      toast({
        title: 'Logo upload failed',
        description: err.message || 'Check your connection and try again',
        variant: 'destructive',
        duration: 8000,
      });
    } finally {
      setUploading(false);
    }
  };

  const previewHtml = buildEmailHtml(
    '<p>This is a preview of your email branding wrapper. Your email content will appear here.</p><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>',
    form
  );

  return (
    <>
      <Card className="bg-muted/30 border-2 border-dashed">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary" />
            Email Branding
          </CardTitle>
          <CardDescription>Applied to all outgoing emails as a consistent wrapper</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Logo */}
          <div>
            <Label className="text-xs mb-1 block">Company Logo</Label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="w-3.5 h-3.5" />
                {uploading ? 'Uploading...' : 'Upload Logo'}
              </Button>
              {form.logo_url && (
                <Button variant="ghost" size="sm" className="gap-1 text-destructive h-8" onClick={() => setForm(f => ({ ...f, logo_url: '' }))}>
                  <X className="w-3.5 h-3.5" /> Remove
                </Button>
              )}
              <input ref={fileInputRef} type="file" accept="image/png,image/jpg,image/jpeg,image/gif,image/svg+xml" className="hidden" onChange={handleLogoUpload} />
            </div>
            {form.logo_url && (
              <div className={`mt-3 ${form.logo_alignment === 'center' ? 'text-center' : form.logo_alignment === 'right' ? 'text-right' : 'text-left'}`}>
                <img src={form.logo_url} alt="Logo preview" style={{ maxHeight: 80, width: form.logo_width, maxWidth: '100%' }} className="inline-block object-contain border rounded" />
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            {/* Logo width */}
            <div>
              <Label className="text-xs mb-1 block">Logo Width (px)</Label>
              <Input
                type="number"
                min={60}
                max={400}
                value={form.logo_width}
                onChange={e => setForm(f => ({ ...f, logo_width: Number(e.target.value) }))}
                className="h-8 text-sm"
              />
            </div>

            {/* Logo alignment */}
            <div>
              <Label className="text-xs mb-1 block">Logo Alignment</Label>
              <div className="flex gap-1">
                {['left', 'center', 'right'].map(a => (
                  <button
                    key={a}
                    onClick={() => setForm(f => ({ ...f, logo_alignment: a }))}
                    className={`flex-1 py-1.5 text-xs rounded border transition-colors capitalize ${form.logo_alignment === a ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/50'}`}
                  >
                    {a === 'center' ? 'Centre' : a.charAt(0).toUpperCase() + a.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Brand colour */}
            <div>
              <Label className="text-xs mb-1 block">Header Accent Colour</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={form.brand_colour || '#1a56db'}
                  onChange={e => setForm(f => ({ ...f, brand_colour: e.target.value }))}
                  className="h-8 w-10 rounded border cursor-pointer p-0.5"
                />
                <Input
                  value={form.brand_colour || '#1a56db'}
                  onChange={e => setForm(f => ({ ...f, brand_colour: e.target.value }))}
                  className="h-8 text-sm font-mono"
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          {/* Company / Sender */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs mb-1 block">Company Name</Label>
              <Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Acme Construction Ltd" className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Default Sender Name</Label>
              <Input value={form.sender_name} onChange={e => setForm(f => ({ ...f, sender_name: e.target.value }))} placeholder="John Smith" className="h-8 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs mb-1 block">Sender Email Address</Label>
              <Input
                type="email"
                value={form.sender_email}
                onChange={e => setForm(f => ({ ...f, sender_email: e.target.value }))}
                placeholder="noreply@yourdomain.com"
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground mt-0.5">The From address on outgoing emails. Must be a verified domain in Resend.</p>
            </div>
          </div>

          {/* Footer */}
          <div>
            <Label className="text-xs mb-1 block">Email Footer</Label>
            <Textarea
              value={form.footer_text}
              onChange={e => setForm(f => ({ ...f, footer_text: e.target.value }))}
              rows={3}
              placeholder="e.g. 123 Example St, Auckland 1010 | +64 9 000 0000 | www.example.co.nz"
              className="text-xs"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="gap-2">
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? 'Saving...' : 'Save Branding'}
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => setShowPreview(true)}>
              <Eye className="w-4 h-4" /> Preview Wrapper
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Email Wrapper Preview</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto rounded border" style={{ height: 500 }}>
            <iframe
              srcDoc={previewHtml}
              title="Email Preview"
              className="w-full h-full border-0"
              sandbox="allow-same-origin"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}