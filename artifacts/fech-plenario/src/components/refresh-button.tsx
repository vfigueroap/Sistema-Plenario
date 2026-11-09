import { RefreshCw } from "lucide-react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { refreshActiveQueries } from "@/lib/realtime";

export function RefreshButton({
  iconOnly = false,
  variant = "secondary",
  className,
}: {
  iconOnly?: boolean;
  variant?: "secondary" | "outline" | "ghost";
  className?: string;
}) {
  const queryClient = useQueryClient();
  const fetching = useIsFetching() > 0;

  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? "icon" : "sm"}
      className={className}
      aria-label="Actualizar ahora"
      title="Actualizar ahora"
      disabled={fetching}
      onClick={() => void refreshActiveQueries(queryClient)}
    >
      <RefreshCw className={`h-4 w-4 ${iconOnly ? "" : "mr-2"} ${fetching ? "animate-spin" : ""}`} />
      {!iconOnly && "Actualizar"}
    </Button>
  );
}
