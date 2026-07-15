import { useQuery } from '@tanstack/react-query';
import { getDashboard } from '../lib/api';
import type { DashboardData } from '../types';

export function useDashboard(token: string) {
  return useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => getDashboard(token),
    enabled: !!token,
  });
}
