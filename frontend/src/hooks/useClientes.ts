import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClientes, createCliente } from '../lib/api';
import type { Cliente, ClienteCreate } from '../types';

export function useClientes(token: string) {
  return useQuery<Cliente[]>({
    queryKey: ['clientes'],
    queryFn: () => getClientes(token),
    enabled: !!token,
  });
}

export function useCreateCliente(token: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ClienteCreate) => createCliente(token, data),
    onSuccess: () => {
      // Invalidate clients list so it refetches automatically
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
    },
  });
}
