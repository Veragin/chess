import { useEffect, type ReactNode } from 'react';
import styled from 'styled-components';
import { Button } from '../../../components/ui';

export interface ConfirmDialogProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 'danger' renders the confirm button as destructive (delete). */
  tone?: 'danger' | 'primary';
  /**
   * Set false when `children` contain the field the user is meant to type in (the folder rename
   * dialog). Focus then belongs to that field, and there is nothing destructive for a stray
   * Enter to trigger.
   */
  autoFocusCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** One button of an `ActionDialog`, rendered after Cancel in the order given. */
export interface DialogAction {
  label: string;
  /** 'danger' renders the button as destructive. */
  tone: 'danger' | 'primary';
  testId: string;
  onClick: () => void;
}

export interface ActionDialogProps {
  title: string;
  children?: ReactNode;
  actions: readonly DialogAction[];
  cancelLabel?: string;
  /** See `ConfirmDialogProps.autoFocusCancel`. */
  autoFocusCancel?: boolean;
  onCancel: () => void;
}

/**
 * Modal confirmation. Used for "delete this line?" (README Phase 5: delete with confirmation)
 * and for "discard unsaved changes?" in the editor.
 *
 * Deliberately not `window.confirm`: that blocks the whole tab, cannot be styled, and is
 * suppressible by the browser. Escape cancels and focus moves to the *cancel* button, so a
 * stray Enter never destroys anything.
 */
export function ConfirmDialog({
  confirmLabel,
  tone = 'danger',
  onConfirm,
  ...rest
}: ConfirmDialogProps) {
  return (
    <ActionDialog
      {...rest}
      actions={[{ label: confirmLabel, tone, testId: 'confirm-accept', onClick: onConfirm }]}
    />
  );
}

/**
 * The same modal with several ways forward besides Cancel ("Refresh data": delete or keep the
 * user's lines). `ConfirmDialog` is this with exactly one action.
 */
export function ActionDialog({
  title,
  children,
  actions,
  cancelLabel = 'Cancel',
  autoFocusCancel = true,
  onCancel,
}: ActionDialogProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <Backdrop
      data-testid="confirm-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <Sheet role="dialog" aria-modal="true" aria-label={title} data-testid="confirm-dialog">
        <Title>{title}</Title>
        {children !== undefined && <Body>{children}</Body>}
        <Actions>
          {/* Focus starts on Cancel so a stray Enter never destroys anything. */}
          <Button autoFocus={autoFocusCancel} data-testid="confirm-cancel" onClick={onCancel}>
            {cancelLabel}
          </Button>
          {actions.map((action) => (
            <Button
              key={action.testId}
              variant={action.tone === 'danger' ? 'danger' : 'primary'}
              data-testid={action.testId}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </Actions>
      </Sheet>
    </Backdrop>
  );
}

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${(p) => p.theme.z.dialog};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${(p) => p.theme.space.md};
  background: rgba(10, 13, 17, 0.72);
`;

const Sheet = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  width: 100%;
  max-width: 420px;
  min-width: 0;
  padding: ${(p) => p.theme.space.lg};
  background: ${(p) => p.theme.color.surface};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.lg};
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
`;

const Title = styled.h2`
  margin: 0;
  font-size: ${(p) => p.theme.font.size.lg};
`;

const Body = styled.div`
  min-width: 0;
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
  overflow-wrap: anywhere;
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${(p) => p.theme.space.sm};
`;
