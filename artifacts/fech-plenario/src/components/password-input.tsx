import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
};

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, visible, onVisibleChange, ...props }, ref) => {
    const [internal, setInternal] = React.useState(false);
    const shown = visible ?? internal;
    const toggle = () => {
      if (onVisibleChange) onVisibleChange(!shown);
      else setInternal(!shown);
    };
    return (
      <div className="relative w-full">
        <Input ref={ref} type={shown ? "text" : "password"} className={cn("pr-10", className)} {...props} />
        <button
          type="button"
          onClick={toggle}
          aria-label={shown ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={shown}
          title={shown ? "Ocultar contraseña" : "Mostrar contraseña"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
