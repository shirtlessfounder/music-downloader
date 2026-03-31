import type { ReactNode } from "react";

type PanelProps = {
  title: string;
  eyebrow?: string;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Panel({
  title,
  eyebrow,
  footer,
  className,
  children
}: PanelProps) {
  const classes = ["panel", className].filter(Boolean).join(" ");

  return (
    <section className={classes}>
      <div className="panel-header">
        <div>
          {eyebrow ? <p className="panel-eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {footer ? <div className="panel-footer">{footer}</div> : null}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
