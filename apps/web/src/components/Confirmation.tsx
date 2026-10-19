import { useEffect, useRef, type ReactNode } from "react";
export function Confirmation({
  title,
  children,
  busy,
  disabled = false,
  onCancel,
  onConfirm,
  label,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  label: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirmation-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="confirmation-title">{title}</h2>
      {children}
      <div className="toolbar">
        <button autoFocus disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy || disabled}
          onClick={onConfirm}
        >
          {busy ? "Submitting decision…" : label}
        </button>
      </div>
    </dialog>
  );
}
