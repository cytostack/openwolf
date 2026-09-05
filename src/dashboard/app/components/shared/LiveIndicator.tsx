import React from "react";
import { useI18n } from "../../lib/i18n-context.js";

export function LiveIndicator() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5 wd-label" style={{ color: "var(--accent)" }}>
      <span className="rounded-full rec-pulse" style={{ width: 8, height: 8, background: "var(--accent)" }} />
      {t("live")}
    </span>
  );
}
