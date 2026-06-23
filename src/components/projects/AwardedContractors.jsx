import React from 'react';
import { TenderSubmission } from '@/api/entities';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, Mail, Phone, HardHat } from 'lucide-react';

/**
 * AwardedContractors
 * Displays subcontractors awarded from a linked tender.
 * Source of truth: TenderSubmission where outcome === 'Awarded'.
 * Does NOT show pricing, scores, rankings, or evaluation notes.
 */
export default function AwardedContractors({ tenderId }) {
  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ['tenderSubmissions', tenderId],
    queryFn: () => TenderSubmission.filter({ tender_id: tenderId }),
    enabled: !!tenderId,
  });

  const awarded = submissions.filter(s => s.outcome === 'Awarded');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-6 h-6 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!tenderId) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        This project was not created from a tender.
      </p>
    );
  }

  if (awarded.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No awarded subcontractors found for the linked tender.
      </p>
    );
  }

  // Group by trade
  const grouped = awarded.reduce((acc, sub) => {
    const trade = sub.trade || 'Unspecified';
    if (!acc[trade]) acc[trade] = [];
    acc[trade].push(sub);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([trade, subs]) => (
        <div key={trade}>
          <div className="flex items-center gap-2 mb-2">
            <HardHat className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">{trade}</h3>
            <span className="text-xs text-muted-foreground">({subs.length})</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {subs.map(sub => (
              <Card key={sub.id}>
                <CardContent className="p-4 space-y-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {sub.full_name || sub.invitee_name || '—'}
                    </p>
                    {sub.business_name && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        <Building2 className="w-3 h-3" />
                        {sub.business_name}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    {sub.invitee_email && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Mail className="w-3 h-3" />
                        <a href={`mailto:${sub.invitee_email}`} className="hover:text-foreground transition-colors">
                          {sub.invitee_email}
                        </a>
                      </div>
                    )}
                    {sub.phone && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="w-3 h-3" />
                        {sub.phone}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}