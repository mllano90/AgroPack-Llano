import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEmbarque } from '../lib/api';
import type { EmbarquePayload } from '../types';

export function useCreateEmbarque(token: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: EmbarquePayload) => createEmbarque(token, payload),
    onSuccess: () => {
      // Refresh dashboard after shipping
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
