import * as React from "react";

import { cn } from "@/lib/utils";
import { autoDir } from "@/lib/i18n";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        dir={autoDir(props.value ?? props.defaultValue)}
        className={cn(
          "desktop-input flex h-7 w-full rounded border border-input bg-transparent px-2.5 py-0.5 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
