import React from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div aria-hidden="true" className="text-4xl mb-3 text-faint">{icon}</div>
      <h3 className="font-medium mb-1 text-secondary">{title}</h3>
      <p className="text-sm max-w-sm text-muted">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer active:translate-y-[1px] wd-chip-secondary"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
