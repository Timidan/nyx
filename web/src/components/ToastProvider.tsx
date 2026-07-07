import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ErrorIcon, InfoIcon, SuccessIcon } from "./Icons";

type ToastVariant = "muted" | "settle" | "alert";

interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  message?: string;
  /** external link (e.g. explorer tx), rendered as a navy underlined link */
  href?: string;
  hrefLabel?: string;
  /** action button (e.g. retry); action toasts stick until dismissed */
  action?: { label: string; onClick: () => void };
  /** stay until dismissed manually */
  sticky?: boolean;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const ACCENT: Record<ToastVariant, { title: string }> = {
  muted: { title: "text-text" },
  settle: { title: "text-settle" },
  alert: { title: "text-alert" },
};

/** classic message-box icons: info / check / x */
const VARIANT_ICON: Record<ToastVariant, ReactNode> = {
  muted: <InfoIcon />,
  settle: <SuccessIcon />,
  alert: <ErrorIcon />,
};

/** "Order sealed" -> "order-sealed" for the message-box title bar. */
function exeName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = ++idRef.current;
      setToasts((cur) => [...cur, { ...toast, id }]);
      const sticky = toast.sticky || Boolean(toast.action);
      if (!sticky) {
        setTimeout(() => dismiss(id), toast.href ? 6500 : 4200);
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-xs flex-col gap-2">
        {toasts.map((t) => {
          const accent = ACCENT[t.variant];
          return (
            <div
              key={t.id}
              className="pointer-events-auto border-2 border-border bg-surface shadow-win"
            >
              <div className="flex items-center justify-between gap-3 border-b-2 border-border bg-navy px-2.5 py-1">
                <span
                  aria-hidden="true"
                  className="font-pixel text-[0.625rem] leading-none text-white"
                >
                  {exeName(t.title)}
                </span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(t.id)}
                  className="grid h-3.5 w-3.5 place-items-center border border-border bg-surface text-[9px] leading-none text-text"
                >
                  ✕
                </button>
              </div>
              <div className="flex min-w-0 gap-2.5 px-4 py-3">
                <span aria-hidden="true" className="mt-0.5 shrink-0">
                  {VARIANT_ICON[t.variant]}
                </span>
                <div className="min-w-0 flex-1">
                <div className={`text-[0.875rem] font-medium ${accent.title}`}>
                  {t.title}
                </div>
                {t.message && (
                  <div className="mt-0.5 font-mono text-[0.75rem] text-muted">
                    {t.message}
                  </div>
                )}
                {(t.href || t.action) && (
                  <div className="mt-2 flex items-center gap-3">
                    {t.href && (
                      <a
                        href={t.href}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[0.75rem] text-link underline hover:no-underline"
                      >
                        {t.hrefLabel ?? "receipt ↗"}
                      </a>
                    )}
                    {t.action && (
                      <button
                        type="button"
                        onClick={() => {
                          dismiss(t.id);
                          t.action!.onClick();
                        }}
                        className="btn95 bg-surface px-2.5 py-1 text-[0.75rem] text-text"
                      >
                        {t.action.label}
                      </button>
                    )}
                  </div>
                )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
