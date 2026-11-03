import { QueryClient } from "@tanstack/react-query";
/** Chromium connectivity is not authoritative for IPC or main-process requests. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30000,
      },
      mutations: { networkMode: "always" },
    },
  });
}
