import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "tertiary" | "danger" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-[8px] text-[15px] font-manrope font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-gradient-to-br from-primary to-rose-dark text-on-primary shadow-sm shadow-primary/20 hover:opacity-90":
              variant === "primary",
            "bg-surface-container-lowest border border-outline-variant text-on-surface hover:bg-surface-container":
              variant === "secondary",
            "bg-transparent text-tertiary hover:bg-tertiary-container hover:text-on-tertiary-container":
              variant === "tertiary" || variant === "ghost",
            "bg-danger text-on-error hover:bg-danger/90":
              variant === "danger",
            "h-10 px-4 py-2": size === "default",
            "h-8 rounded-md px-3 text-[13px]": size === "sm",
            "h-12 rounded-md px-8": size === "lg",
            "h-10 w-10": size === "icon",
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
