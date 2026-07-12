import type { ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/theme";

type ToasterProps = ComponentProps<typeof Sonner>;

/**
 * Sonner toaster wired to the dashboard's own light/dark theme and design tokens.
 * Mounted once at the app root; call `toast(...)` from anywhere.
 */
function Toaster(props: ToasterProps): React.ReactNode {
  const [theme] = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          error: "group-[.toast]:text-destructive",
          success: "group-[.toast]:text-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
export { toast } from "sonner";
