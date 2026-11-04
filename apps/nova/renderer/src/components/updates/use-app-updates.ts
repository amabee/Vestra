import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bridge } from "@/lib/bridge";

const key = ["app-updates"];
export const updatePromptEvent = "vestra:show-app-update";
export function showUpdatePrompt() {
  window.dispatchEvent(new Event(updatePromptEvent));
}
export function useAppUpdates() {
  const client = useQueryClient();
  useEffect(
    () => bridge.updates.onChanged((state) => client.setQueryData(key, state)),
    [client],
  );
  return useQuery({
    queryKey: key,
    queryFn: bridge.updates.state,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
export function useUpdateCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: "check" | "download" | "install") =>
      bridge.updates[action](),
    onSuccess: (state) => client.setQueryData(key, state),
  });
}
