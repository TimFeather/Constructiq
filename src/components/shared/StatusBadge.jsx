import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const statusStyles = {
  'Active': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'On Hold': 'bg-amber-100 text-amber-700 border-amber-200',
  'Complete': 'bg-blue-100 text-blue-700 border-blue-200',
  'Draft': 'bg-slate-100 text-slate-600 border-slate-200',
  'In Review': 'bg-purple-100 text-purple-700 border-purple-200',
  'Approved': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Superseded': 'bg-rose-100 text-rose-600 border-rose-200',
  'Open': 'bg-blue-100 text-blue-700 border-blue-200',
  'Answered': 'bg-amber-100 text-amber-700 border-amber-200',
  'Closed': 'bg-slate-100 text-slate-600 border-slate-200',
  'Low': 'bg-slate-100 text-slate-600 border-slate-200',
  'Medium': 'bg-amber-100 text-amber-700 border-amber-200',
  'High': 'bg-orange-100 text-orange-700 border-orange-200',
  'Critical': 'bg-red-100 text-red-700 border-red-200',
};

export default function StatusBadge({ status, className }) {
  return (
    <Badge 
      variant="outline"
      className={cn(
        "font-medium text-xs border",
        statusStyles[status] || 'bg-muted text-muted-foreground',
        className
      )}
    >
      {status}
    </Badge>
  );
}