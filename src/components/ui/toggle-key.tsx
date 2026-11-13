import type { ReactNode } from "react"
import { cn } from "cn"
import { Toggle as TogglePrimitive } from "radix-ui"

/**
 * An on/off key with a status lamp: filled in ink when the feature is on,
 * an empty ring when off, so a row of keys reads at a glance.
 */
function ToggleKey({
  pressed,
  onPressedChange,
  children,
  className,
}: {
  pressed: boolean
  onPressedChange: (v: boolean) => void
  children: ReactNode
  className?: string
}) {
  return (
    <TogglePrimitive.Root
      pressed={pressed}
      onPressedChange={onPressedChange}
      className={cn(
        "group/key flex h-8 w-full items-center gap-2.5 rounded-md border bg-card px-2.5 text-left text-[13px] text-muted-foreground transition-[color,border-color,box-shadow] outline-none select-none hover:border-input hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.1)] data-[state=on]:border-input data-[state=on]:text-foreground",
        className
      )}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-transparent ring-1 ring-input transition-colors group-data-[state=on]/key:bg-foreground group-data-[state=on]/key:ring-foreground"
      />
      <span className="truncate">{children}</span>
    </TogglePrimitive.Root>
  )
}

export { ToggleKey }
