"use client";

import type { ReactNode, RefObject } from "react";
import { useEffect, useId, useRef } from "react";

import styles from "@/app/admin/admin.module.css";

type AccessibleDialogProps = {
  title: string;
  description?: string;
  children: ReactNode;
  busy?: boolean;
  onRequestClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

export function AccessibleDialog({
  title,
  description,
  children,
  busy = false,
  onRequestClose,
  initialFocusRef,
}: AccessibleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const focusTarget = initialFocusRef?.current ?? dialog.querySelector<HTMLElement>("[autofocus], button, [href], input, select, textarea");
    focusTarget?.focus();

    return () => {
      if (dialog.open) dialog.close();
      returnFocusRef.current?.focus();
    };
  }, [initialFocusRef]);

  return (
    <dialog
      className={styles.sessionDialog}
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onRequestClose();
      }}
      onClose={onRequestClose}
    >
      <div className={styles.dialogHeader}>
        <div>
          <p className={styles.panelKicker}>Staff workspace</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button className={styles.dialogClose} type="button" disabled={busy} onClick={onRequestClose} aria-label={`Close ${title}`}>×</button>
      </div>
      {description ? <p className={styles.dialogDescription} id={descriptionId}>{description}</p> : null}
      {children}
    </dialog>
  );
}

type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busy = false,
  danger = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AccessibleDialog
      title={title}
      description={description}
      busy={busy}
      onRequestClose={onCancel}
      initialFocusRef={cancelRef}
    >
      <div className={styles.dialogActions}>
        <button ref={cancelRef} className={styles.secondaryButton} type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className={`${styles.primaryButton} ${danger ? styles.dangerPrimaryButton : ""}`} type="button" disabled={busy} onClick={onConfirm}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </AccessibleDialog>
  );
}
