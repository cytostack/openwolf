import React, { useState } from "react";

export interface DotBarDatum {
  label: string;
  value: number;
  highlight?: boolean;   // red column — reserved for "current" / over-limit
}

interface DotBarProps {
  data: DotBarDatum[];
  rows?: number;         // dot resolution per column
  unit?: string;         // tooltip unit
}

/**
 * Dot-matrix column chart: each column is a stack of dots filled bottom-up in
 * proportion to its value. Hover shows an exact-value tooltip (charts are
 * interactive by default; identity is carried by the label, not color).
 */
export function DotBar({ data, rows = 7, unit = "" }: DotBarProps) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="relative">
      <div className="flex items-end justify-between gap-1">
        {data.map((d, i) => {
          const filled = d.value <= 0 ? 0 : Math.max(1, Math.round((d.value / max) * rows));
          return (
            <div
              key={`${d.label}-${i}`}
              className="flex flex-col-reverse items-center gap-[3px] px-1 py-1 cursor-default"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {Array.from({ length: rows }).map((_, r) => (
                <span
                  key={r}
                  className={`rounded-full wd-dotseries ${r < filled ? (d.highlight ? "wd-dotseries-red" : hover === i ? "wd-dotseries-1" : "wd-dotseries-2") : "wd-dotseries-off"}`}
                />
              ))}
              <span className={`wd-label wd-label-2xs mt-2 ${hover === i ? "text-primary" : "text-faint"}`}>
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
      {hover !== null && data[hover] && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded-md font-mono text-xs pointer-events-none whitespace-nowrap wd-tooltip"
>
          {data[hover].label}: {data[hover].value.toLocaleString()}{unit ? ` ${unit}` : ""}
        </div>
      )}
    </div>
  );
}
