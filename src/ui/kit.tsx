import { cn } from "@/lib/cn";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function Button({ variant = "solid", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "quiet" | "danger" }) {
  return (
    <button
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm px-3 text-[14px] font-semibold leading-none disabled:cursor-not-allowed disabled:opacity-50",
        variant === "solid" && "bg-navy text-white hover:bg-navy/90",
        variant === "quiet" && "border border-line bg-card text-ink hover:bg-head",
        variant === "danger" && "border border-bad bg-card text-bad hover:bg-bad/10",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[13px] font-semibold text-ink">
      <span>{label}</span>
      {children}
    </label>
  );
}

const control = "h-8 rounded-sm border border-line bg-card px-2 text-[14px] font-normal text-ink";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, props.className)} />;
}

export function NumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={cn(control, "w-full font-mono", props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("min-h-16 rounded-sm border border-line bg-card px-1.5 py-1 text-[13px] text-ink", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(control, props.className)} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "bad" | "warn"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-sm border px-2 font-mono text-[12px] text-ink",
        tone === "neutral" && "border-line bg-head",
        tone === "good" && "border-good bg-good/15",
        tone === "bad" && "border-bad bg-bad/10",
        tone === "warn" && "border-amber bg-amber/15",
      )}
    >
      {children}
    </span>
  );
}

export function Panel({ title, children, action, className }: { title?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn("border border-line bg-card", className)}>
      {title ? (
        <div className="flex h-10 items-center justify-between gap-2 border-b border-line bg-head px-3">
          <h2 className="text-[14px] font-semibold text-navy">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className="p-3">{children}</div>
    </section>
  );
}

export const Card = Panel;

export function MoreOptions({ initiallyOpen = false, hint, children }: { initiallyOpen?: boolean; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="border border-line">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="shrink-0 text-[13px] font-semibold">More options</span>
        {hint && !open ? <span className="min-w-0 truncate text-[13px] font-normal text-muted">{hint}</span> : null}
      </button>
      {open ? <div className="grid gap-3 border-t border-line px-3 py-3">{children}</div> : null}
    </div>
  );
}

export function Modal({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/30" />
        <Dialog.Content className={cn("fixed left-1/2 top-8 z-50 max-h-[calc(100vh-4rem)] -translate-x-1/2 overflow-auto border border-line bg-paper shadow-none", wide ? "w-[min(920px,calc(100vw-1rem))]" : "w-[min(640px,calc(100vw-1rem))]")}>
          <div className="flex h-10 items-center justify-between border-b border-line bg-head px-3">
            <Dialog.Title className="text-[15px] font-semibold text-navy">{title}</Dialog.Title>
            <Dialog.Close className="rounded-sm p-1 hover:bg-card" aria-label="Close">
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>
          <div className="p-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
