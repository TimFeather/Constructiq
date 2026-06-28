import { supabase, uploadFile } from '@/api/supabaseClient';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Save, Upload, X, Image } from 'lucide-react';

// Stored in user profile under company_logo_url
export default function AppearanceSettings({ user }) {
  const queryClient = useQueryClient();
  const [logoUrl, setLogoUrl] = useState(user?.company_logo_url || '');
  const [companyName, setCompanyName] = useState(user?.company_name || '');
  const [uploading, setUploading] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      return supabase.from('users').update(data).eq('id', authUser.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    }
  });

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Logos must live in the PUBLIC 'Documents' bucket — they are embedded in outbound
      // emails and loaded by unauthenticated email clients, so they cannot use signed URLs.
      const { file_url } = await uploadFile(file, 'Documents');
      setLogoUrl(file_url);
    } catch (err) {
      console.error('Logo upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance & Branding</CardTitle>
        <CardDescription>Customise the sidebar logo and company name</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Company Name (shown in sidebar)</Label>
          <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Construction" />
          <p className="text-xs text-muted-foreground">Leave empty to show "ConstructIQ"</p>
        </div>

        <div className="space-y-2">
          <Label>Company Logo</Label>
          {logoUrl && (
            <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg border">
              <img src={logoUrl} alt="Logo" className="h-10 max-w-[120px] object-contain rounded" />
              <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs text-destructive" onClick={() => setLogoUrl('')}>
                <X className="w-3 h-3" /> Remove
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="cursor-pointer">
              <input type="file" accept="image/png,image/jpg,image/jpeg" className="hidden" onChange={handleLogoUpload} />
              <div className="flex items-center gap-2 px-3 py-2 text-sm border rounded-md hover:bg-muted/50 transition-colors cursor-pointer">
                {uploading ? (
                  <div className="w-4 h-4 border-2 border-muted-foreground border-t-primary rounded-full animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {uploading ? 'Uploading...' : 'Upload Logo'}
              </div>
            </label>
            {logoUrl && <span className="text-xs text-muted-foreground truncate max-w-[200px]">Logo uploaded ✓</span>}
          </div>
          <p className="text-xs text-muted-foreground">Recommended: PNG or JPG, max 200×60px, transparent background</p>
        </div>

        <Button onClick={() => saveMutation.mutate({ company_logo_url: logoUrl, company_name: companyName })}
          disabled={saveMutation.isPending} className="gap-2">
          <Save className="w-4 h-4" />
          {saveMutation.isPending ? 'Saving...' : 'Save Appearance'}
        </Button>
      </CardContent>
    </Card>
  );
}