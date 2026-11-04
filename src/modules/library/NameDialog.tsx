/** Shared create/rename dialog for the library. Labelled input, refuses empty names, and warns
 *  (without blocking) when the name already exists — a duplicate "HSK 1" list is often deliberate.
 *  Uses a native <dialog> so Escape, focus trapping and restore behaviour come for free. */

import { useEffect, useId, useRef, useState } from 'react';
import { isDuplicateName, nameError } from './helpers';

export function NameDialog({
  open,
  title,
  label,
  initialValue = '',
  taken = [],
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  /** Existing sibling names; the name being edited should be excluded by the caller. */
  taken?: readonly string[];
  submitLabel?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const helpId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initialValue);
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setShowError(false);
    }
  }, [open, initialValue]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const error = nameError(value);
  const duplicate = !error && isDuplicateName(value, taken);
  const canSubmit = !error;

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === dialogRef.current) onCancel();
      }}
    >
      <form
        className="dialog lib-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) {
            setShowError(true);
            return;
          }
          onSubmit(value.trim());
        }}
      >
        <h2>{title}</h2>
        <div className="field">
          <label htmlFor={inputId}>{label}</label>
          <input
            id={inputId}
            className="input"
            type="text"
            autoComplete="off"
            value={value}
            aria-invalid={showError && Boolean(error)}
            aria-describedby={duplicate || (showError && error) ? helpId : undefined}
            onChange={(event) => setValue(event.target.value)}
          />
          {showError && error ? (
            <span id={helpId} className="help" role="alert" style={{ color: 'var(--danger-600)' }}>
              {error}
            </span>
          ) : duplicate ? (
            <span id={helpId} className="help" role="status" style={{ color: 'var(--warn-600)' }}>
              You already have something with this name. That is allowed — just confirming it is
              what you meant.
            </span>
          ) : null}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
