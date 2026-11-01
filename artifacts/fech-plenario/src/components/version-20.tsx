import { Sparkles } from "lucide-react";

export function Version20({ className = "", sparkle = true }: { className?: string; sparkle?: boolean }) {
  return (
    <span
      aria-label="versión 2.0"
      className={`fech-num-grad relative inline-block font-black normal-case leading-none tracking-normal ${className}`}
    >
      2.0
      {sparkle && <Sparkles className="fech-spark absolute -right-3 -top-2 h-3.5 w-3.5 text-amber-400" />}
    </span>
  );
}
