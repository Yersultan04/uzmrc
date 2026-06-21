import * as React from "react";

import { cn } from "@/lib/utils";

// Lightweight styled native <select>. We avoid pulling in a heavier popover
// select component (no new deps) — native is accessible and adequate here.
function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat px-2.5 py-1 pr-8 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23888%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%226 9 12 15 18 9%22/></svg>')]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { NativeSelect };
