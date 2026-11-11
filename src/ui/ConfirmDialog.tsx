import { useEffect, useRef } from 'react';

export function ConfirmDialog({
  open,
  title,
  message,
  cancel,
  confirm,
  destructive = true,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  cancel: string;
  confirm: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      onClose={onClose}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="confirm-actions">
        <button type="button" className="pill" onClick={onClose}>
          {cancel}
        </button>
        <button
          type="button"
          className={destructive ? 'pill is-destructive' : 'pill is-primary'}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
