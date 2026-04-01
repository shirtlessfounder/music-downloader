import type { ReactNode } from "react";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: "muted" | "success" | "warning";
};

export function StatusBadge({
  children,
  tone = "muted"
}: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${tone}`}>{children}</span>
  );
}
