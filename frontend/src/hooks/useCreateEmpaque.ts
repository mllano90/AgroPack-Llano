import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEmpaque } from '../lib/api';
import type { EmpaquePayload } from '../types';

export function useCreateEmpaque(token: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: EmpaquePayload) => createEmpaque(token, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
