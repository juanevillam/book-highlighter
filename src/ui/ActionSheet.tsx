import { useEffect, useRef } from 'react';

export type SheetAction = {
  label: string;
  destructive?: boolean;
  onSelect: () => void;
};

export function ActionSheet({
  open,
  actions,
  cancel,
  onClose,
}: {
  open: boolean;
  actions: SheetAction[];
  cancel: string;
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
      className="action-sheet"
      onClose={onClose}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="action-group">
        {actions.map(action => (
          <button
            key={action.label}
            type="button"
            className={action.destructive ? 'is-destructive' : undefined}
            onClick={() => {
              onClose();
              action.onSelect();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div className="action-group">
        <button type="button" className="is-cancel" onClick={onClose}>
          {cancel}
        </button>
      </div>
    </dialog>
  );
}
