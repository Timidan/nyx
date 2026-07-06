import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastVariant = "muted" | "settle" | "alert";

interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  message?: string;
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

const ACCENT: Record<ToastVariant, { bar: string; title: string }> = {
  muted: { bar: "bg-muted", title: "text-text" },
  settle: { bar: "bg-settle", title: "text-settle" },
  alert: { bar: "bg-alert", title: "text-alert" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++idRef.current;
    setToasts((cur) => [...cur, { ...toast, id }]);
    setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-xs flex-col gap-2">
        {toasts.map((t) => {
          const accent = ACCENT[t.variant];
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex overflow-hidden rounded-card border border-border bg-surface-2 shadow-xl"
            >
              <span className={`w-1 shrink-0 ${accent.bar}`} />
              <div className="px-4 py-3">
                <div className={`text-[0.875rem] font-medium ${accent.title}`}>
                  {t.title}
                </div>
                {t.message && (
                  <div className="mt-0.5 font-mono text-[0.75rem] text-muted">
                    {t.message}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
