import React from "react";

/**
 * Theme-consistent data table. Replaces the per-panel hand-written table
 * markup: header rows use the shared .wd-label (uppercase mono caption)
 * style, data rows use .wd-row (CSS hover, no per-frame JS) and a subtle
 * horizontal rule separating each row.
 *
 * Columns describe both header and cell rendering; a column may supply a
 * `render` callback for non-plain cell content (badges, buttons, multi-line).
 */
export type WdColumn = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  className?: string;
  cellClassName?: string;
  headerClassName?: string;
  render?: (row: Record<string, any>) => React.ReactNode;
};

const ALIGN_CLASS: Record<"left" | "right" | "center", string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function WdTable({
  columns,
  rows,
  rowKey = (_row, i) => i,
  className = "w-full text-sm",
  cellClassName = "px-4 py-2",
  caption,
}: {
  columns: WdColumn[];
  rows: Record<string, any>[];
  rowKey?: (row: Record<string, any>, i: number) => string | number;
  className?: string;
  cellClassName?: string;
  caption?: string;
}) {
  const label = caption ?? "Data table";
  return (
    <table className={className} aria-label={label}>
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr className="wd-label text-faint">
          {columns.map((c) => (
            <th
              key={c.key}
              className={`${ALIGN_CLASS[c.align ?? "left"]} ${cellClassName} font-normal ${c.className ?? ""} ${c.headerClassName ?? ""}`}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={rowKey(row, i)} className="wd-row wd-divide">
            {columns.map((c) => (
              <td
                key={c.key}
                className={`${ALIGN_CLASS[c.align ?? "left"]} ${cellClassName} ${c.className ?? ""} ${c.cellClassName ?? ""}`}
              >
                {c.render ? c.render(row) : row[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
