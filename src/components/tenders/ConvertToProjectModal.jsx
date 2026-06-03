import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export default function ConvertToProjectModal({ tender, open, onOpenChange }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [converting, setConverting] = useState(false);

  const awardedSubs = (tender.invitees || []).filter(i => i.status === 'Awarded');

  const [projectName, setProjectName] = useState(tender.title || '');
  const [includeDesc, setIncludeDesc] = useState(true);
  const [includeContacts, setIncludeContacts] = useState(true);
  const [includeSubs, setIncludeSubs] = useState(true);
  const [includedDocs, setIncludedDocs] = useState(
    (tender.documents || []).reduce((m, _, i) => ({ ...m, [i]: true }), {})
  );

  const toggleDoc = (idx) => setIncludedDocs(prev => ({ ...prev, [idx]: !prev[idx] }));

  const handleConvert = async () => {
    setConverting(true);
    try {
      // Build team
      const team = [];
      if (includeContacts) {
        if (tender.architect_name) team.push({ full_name: tender.architect_name, user_email: tender.architect_email || '', role: 'Architect', business_name: '', phone: '' });
        if (tender.project_manager_name) team.push({ full_name: tender.project_manager_name, user_email: tender.project_manager_email || '', role: 'Internal Project Manager', business_name: '', phone: '' });
      }
      if (includeSubs) {
        awardedSubs.forEach(sub => {
          team.push({ full_name: sub.full_name, user_email: sub.email || '', role: 'Subcontractor', business_name: sub.business_name || '', phone: sub.phone || '', trade: sub.trade || '' });
        });
      }

      // Build project data
      const projectData = {
        name: projectName,
        client_name: tender.client_name,
        location: tender.location,
        status: 'Active',
        team,
      };
      if (includeDesc && tender.description) {
        projectData.description = tender.description;
      }

      const newProject = await base44.entities.Project.create(projectData);

      // Copy selected docs
      const docsToCreate = (tender.documents || [])
        .filter((_, idx) => includedDocs[idx])
        .map(doc => ({
          name: doc.name,
          project_id: newProject.id,
          folder: 'Tender',
          file_url: doc.file_url,
          file_type: doc.file_type,
          status: 'Draft',
          uploaded_by_name: 'Imported from Tender',
        }));

      for (const doc of docsToCreate) {
        await base44.entities.Document.create(doc);
      }

      // Update tender status
      await base44.entities.Tender.update(tender.id, {
        status: 'Converted',
        converted_project_id: newProject.id,
      });

      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });

      toast({
        title: 'Project created successfully',
        description: `"${projectName}" has been created from this tender.`,
      });

      onOpenChange(false);
      navigate(`/projects/${newProject.id}`);
    } catch (e) {
      toast({ title: 'Conversion failed', description: e.message, variant: 'destructive' });
    } finally {
      setConverting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="w-5 h-5 text-primary" />
            Convert Tender to Project
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Project details (always included) */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Project Details</h3>
            <div>
              <Label className="text-xs">Project Name *</Label>
              <Input value={projectName} onChange={e => setProjectName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              {tender.client_name && <div><span className="font-medium text-foreground">Client:</span> {tender.client_name}</div>}
              {tender.location && <div><span className="font-medium text-foreground">Location:</span> {tender.location}</div>}
            </div>
          </div>

          {/* What to carry over */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Carry Over</h3>

            <div className="flex items-center gap-2">
              <Checkbox checked={includeDesc} onCheckedChange={setIncludeDesc} id="inc-desc" />
              <Label htmlFor="inc-desc" className="text-sm font-normal cursor-pointer">Tender description → Project description</Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox checked={includeContacts} onCheckedChange={setIncludeContacts} id="inc-contacts" disabled={!tender.architect_name && !tender.project_manager_name} />
              <Label htmlFor="inc-contacts" className="text-sm font-normal cursor-pointer">
                Key contacts (Architect, Project Manager) → Project team
                {!tender.architect_name && !tender.project_manager_name && <span className="text-muted-foreground ml-1">(none set)</span>}
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox checked={includeSubs} onCheckedChange={setIncludeSubs} id="inc-subs" disabled={awardedSubs.length === 0} />
              <Label htmlFor="inc-subs" className="text-sm font-normal cursor-pointer">
                Awarded subcontractors → Project team
                {awardedSubs.length === 0 && <span className="text-muted-foreground ml-1">(none awarded)</span>}
                {awardedSubs.length > 0 && <span className="text-muted-foreground ml-1">({awardedSubs.length} sub{awardedSubs.length !== 1 ? 's' : ''})</span>}
              </Label>
            </div>

            {(tender.documents || []).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Documents to include:</p>
                {(tender.documents || []).map((doc, idx) => (
                  <div key={idx} className="flex items-center gap-2 ml-1">
                    <Checkbox checked={!!includedDocs[idx]} onCheckedChange={() => toggleDoc(idx)} id={`doc-${idx}`} />
                    <Label htmlFor={`doc-${idx}`} className="text-sm font-normal cursor-pointer">{doc.name} <span className="text-muted-foreground text-xs">({doc.category || doc.file_type})</span></Label>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-green-700 dark:text-green-300">
              This will create a new Active project and update the tender status to Converted.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConvert} disabled={converting || !projectName} className="gap-2">
            {converting ? 'Creating...' : <><ArrowRight className="w-4 h-4" /> Create Project</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}