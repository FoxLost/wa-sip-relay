import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

// Fetch the running build from /api/config. The label is the branch or tag shown beside
// the logo, and commit is the short SHA used in the tooltip.
export const useVersion = (): { label: string; commit: string } => {
  const { data } = useQuery({
    queryKey: ["config-version"],
    queryFn: () => apiGet<{ version?: string; commit?: string }>("/api/config"),
    staleTime: Infinity,
    retry: false,
  });
  const label = data?.version ?? "";
  const c = data?.commit ?? "";
  const commit = c.length > 12 ? c.slice(0, 7) : c; // Shorten long SHAs.
  return { label, commit };
};
