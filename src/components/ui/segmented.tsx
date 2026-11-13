import type { ReactNode } from "react"
import { cn } from "cn"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

export type SegmentedItem<T extends string> = {
  value: T
  label: ReactNode
  /** Accessible name when the label is only an icon or abbreviation. */
  title?: string
}

/**
 * A row of mutually exclusive options set into a recessed slot, like the
 * selector switches on a Braun receiver. Exactly one option is always on.
 */
function Segmented<T extends string>({
  value,
  onValueChange,
  items,
  className,
  "aria-label": ariaLabel,
}: {
  value: T
  onValueChange: (v: T) => void
  items: SegmentedItem<T>[]
  className?: string
  "aria-label": string
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-9 items-stretch gap-0.5 rounded-md bg-muted p-[3px] shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)]",
        className
      )}
    >
      {items.map((item) => (
        <ToggleGroupPrimitive.Item
          key={item.value}
          value={item.value}
          aria-label={item.title}
          title={item.title}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[4px] px-2.5 text-[12px] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-[0_0_0_1px_var(--border),0_1px_1px_rgb(0_0_0/0.06)] [&_svg]:size-3.5 [&_svg]:shrink-0"
        >
          {item.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  )
}

export { Segmented }
