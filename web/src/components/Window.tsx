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
        className="flex select-none items-center justify-between gap-3 border-b-2 border-border bg-navy px-3 py-1.5"
      >
        <span className="font-pixel text-[0.6875rem] leading-none text-white">
          {title}
        </span>
        <span className="flex gap-1">
          {["▁", "▢", "✕"].map((glyph) => (
            <span
              key={glyph}
              className="grid h-4 w-4 place-items-center border-2 border-border bg-surface text-[9px] leading-none text-text"
            >
              {glyph}
            </span>
          ))}
        </span>
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
