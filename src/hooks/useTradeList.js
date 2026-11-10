import { useQuery } from '@tanstack/react-query';
import { TradeTemplate } from '@/api/entities';

// Used until Settings → Trades has any rows (or if it can't be read).
export const DEFAULT_TRADES = [
  'Electrical', 'Plumbing', 'HVAC', 'Carpentry', 'Masonry',
  'Painting', 'Roofing', 'Flooring', 'Landscaping', 'Demolition',
  'Concrete', 'Steel Erection', 'Glazing', 'Fire Protection',
];

/**
 * The company trade list (Settings → Trades), in its saved order. Tenders,
 * project subcontractors, the team and programme resources all pick from it,
 * so a sub filed under "Plumbing" lines up with a "Plumber" resource in a
 * programme (see tradeKey in scheduleImportResources).
 *
 * @returns {string[]}
 */
export function useTradeList() {
  const { data: templates = [] } = useQuery({
    queryKey: ['trade_templates'],
    queryFn: () => TradeTemplate.list('sort_order'),
    staleTime: 5 * 60_000,
  });
  const names = templates.map(t => t.name).filter(Boolean);
  return names.length ? names : DEFAULT_TRADES;
}
