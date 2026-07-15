import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRecepcion } from '../lib/api';
import type { RecepcionPayload } from '../types';

export function useCreateRecepcion(token: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: RecepcionPayload) => createRecepcion(token, payload),
    onSuccess: () => {
      // Refresh dashboard after creating reception
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
