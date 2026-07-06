import type { ReactNode } from "react";

/** Win95 window chrome — purely decorative. The title bar is aria-hidden so
 *  accessible names stay on the headings inside each window body (E2E tests
 *  target those by role/name). */
export function Window({
  title,
  children,
  className = "",
  bodyClassName = "p-5",
}: {
  title: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`border-2 border-border bg-surface shadow-win ${className}`}>
      <div
        aria-hidden="true"
        className="select-none border-b-2 border-border bg-navy px-3 py-1.5"
      >
        <span className="font-pixel text-[0.6875rem] leading-none text-white">
          {title}
        </span>
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
