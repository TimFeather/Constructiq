import { QueryClient, QueryCache } from '@tanstack/react-query';
import { toast } from '@/components/ui/use-toast';

export const queryClientInstance = new QueryClient({
	queryCache: new QueryCache({
		onError: (error, query) => {
			if (query.state.data !== undefined) return; // only show on background-refetch failures
			toast({
				title: 'Failed to load data',
				description: error?.message || 'An unexpected error occurred',
				variant: 'destructive',
			});
		},
	}),
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 60_000,
		},
	},
});