import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PulseCards } from "@/components/dashboard/PulseCards";

/**
 * Dashboard pulse data — extracted from PulseCards.tsx.
 *
 * WHY THIS FILE EXISTS
 *
 * React Fast Refresh only works when a module exports components and nothing
 * else. `PulseCards.tsx` exported the row component AND this hook, so editing
 * either forced a full reload. Behaviour is unchanged.
 */
export function usePulse(period: string) {
  return useQuery<PulseCards>({
    queryKey: ["dashboard", "pulse", period],
    queryFn: () => api.get<PulseCards>(`/dashboard/pulse?period=${period}`),
  });
}
