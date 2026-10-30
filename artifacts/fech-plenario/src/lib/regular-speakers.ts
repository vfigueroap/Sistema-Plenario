import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface RegularSpeaker {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
}

const KEY = ["regular-speakers"] as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : "No se pudo completar la acción");
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export function useRegularSpeakers(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: () => request<RegularSpeaker[]>("/api/regular-speakers"),
    enabled,
    staleTime: 30_000,
  });
}

export function useRegularSpeakerMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const create = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      request<RegularSpeaker>("/api/regular-speakers", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Pick<RegularSpeaker, "name" | "description" | "active">> }) =>
      request<RegularSpeaker>(`/api/regular-speakers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => request<void>(`/api/regular-speakers/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  return { create, update, remove };
}
