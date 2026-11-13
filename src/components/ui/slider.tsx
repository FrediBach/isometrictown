import * as React from "react"
import { cn } from "cn"
import { Slider as SliderPrimitive } from "radix-ui"

/**
 * A single-value slider in the manner of a radio tuning dial: a hairline
 * track with a printed scale beneath it and a slim needle as the pointer.
 * The needle lights up in the signal colour while it is being moved.
 */
function Slider({
  className,
  ticks = 10,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { ticks?: number }) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "group/slider relative flex h-6 w-full touch-none items-center select-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {/* Printed scale. The needle is 4px wide and Radix keeps it inside the
          track, so the scale is inset by half a needle to line up exactly. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[2px] top-1/2 mt-[5px] flex h-[5px] justify-between"
      >
        {Array.from({ length: ticks + 1 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-px bg-input",
              i === 0 || i === ticks || i * 2 === ticks ? "h-[5px]" : "h-[3px]"
            )}
          />
        ))}
      </span>
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-px grow bg-input"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute -top-px h-[3px] bg-foreground"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="relative block h-[18px] w-1 shrink-0 rounded-[1px] bg-foreground ring-ring/30 transition-[background-color,box-shadow] outline-none after:absolute after:-inset-x-3 after:-inset-y-1.5 group-hover/slider:ring-4 focus-visible:bg-signal focus-visible:ring-4 active:bg-signal"
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
