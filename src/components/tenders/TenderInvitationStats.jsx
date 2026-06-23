import React from 'react';
import { TenderInvitation, TenderInvitee } from '@/api/entities';
import { useQuery } from '@tanstack/react-query';
import { Users, Send, Eye, CheckCircle2, Clock } from 'lucide-react';

export default function TenderInvitationStats({ tenderId }) {
  const { data: invitations = [] } = useQuery({
    queryKey: ['tenderInvitations', tenderId],
    queryFn: () => TenderInvitation.filter({ tender_id: tenderId }),
    enabled: !!tenderId,
  });

  const { data: invitees = [] } = useQuery({
    queryKey: ['tenderInvitees', tenderId],
    queryFn: () => TenderInvitee.filter({ tender_id: tenderId }),
    enabled: !!tenderId,
  });

  const activeInvitees = invitees.filter(i => i.status !== 'Archived');
  const sent      = invitations.filter(i => i.status === 'Sent').length;
  const viewed    = invitations.filter(i => i.status === 'Viewed').length;
  const submitted = invitations.filter(i => i.status === 'Submitted').length;
  const pending   = activeInvitees.filter(i => !i.status || i.status === 'Draft').length;

  const stats = [
    { label: 'Invitees',  value: activeInvitees.length, icon: Users,         color: 'text-gray-600',   bg: 'bg-gray-50'   },
    { label: 'Sent',      value: sent,                  icon: Send,          color: 'text-blue-600',   bg: 'bg-blue-50'   },
    { label: 'Viewed',    value: viewed,                icon: Eye,           color: 'text-cyan-600',   bg: 'bg-cyan-50'   },
    { label: 'Submitted', value: submitted,             icon: CheckCircle2,  color: 'text-green-600',  bg: 'bg-green-50'  },
    { label: 'Pending',   value: pending,               icon: Clock,         color: 'text-amber-600',  bg: 'bg-amber-50'  },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {stats.map(({ label, value, icon: Icon, color, bg }) => (
        <div key={label} className={`${bg} rounded-lg p-3 flex items-center gap-3`}>
          <Icon className={`w-5 h-5 ${color} flex-shrink-0`} />
          <div>
            <p className={`text-xl font-bold leading-none ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}