import { useState } from 'react';
import styled from 'styled-components';
import type { RefreshMode, ResetSummary } from '../../../storage/reset';
import { ActionDialog } from './ConfirmDialog';
import { lineCountLabel } from './lineFormat';

export interface RefreshDialogProps {
  /** What the refresh would touch, counted when the dialog opened (`resetSummary`). */
  summary: ResetSummary;
  onRefresh: (mode: RefreshMode, clearPersonal: boolean) => void;
  onCancel: () => void;
}

/**
 * "Refresh data…" (`storage/reset.ts` `refreshData`): reinstall the bundled lines, deleting or
 * keeping the user's own, and optionally empty the Personal list.
 *
 * The counts are the point of the dialog — they are what makes the choice informed. Anything that
 * cannot be recovered is `danger`: "Delete my lines" always, and both actions while "Also clear my
 * Personal list" is ticked, with a one-line warning saying why.
 */
export function RefreshDialog({ summary, onRefresh, onCancel }: RefreshDialogProps) {
  const [clearPersonal, setClearPersonal] = useState(false);

  return (
    <ActionDialog
      title="Refresh data?"
      onCancel={onCancel}
      actions={[
        {
          label: 'Delete my lines & refresh',
          tone: 'danger',
          testId: 'refresh-delete',
          onClick: () => onRefresh('delete-user-lines', clearPersonal),
        },
        {
          label: 'Keep my lines & refresh',
          tone: clearPersonal ? 'danger' : 'primary',
          testId: 'refresh-keep',
          onClick: () => onRefresh('keep-user-lines', clearPersonal),
        },
      ]}
    >
      <Content>
        <p>
          The bundled lines are reinstalled fresh: any bundled line you deleted or edited comes back
          in its original form.
        </p>
        <Counts data-testid="refresh-counts">
          <li>
            Your own lines: <strong data-testid="refresh-custom">{summary.custom}</strong>
          </li>
          <li>
            Bundled lines deleted or replaced by an edit:{' '}
            <strong data-testid="refresh-hidden">{summary.hidden}</strong>
          </li>
          <li>
            Lines in Personal: <strong data-testid="refresh-personal">{summary.personal}</strong>
          </li>
        </Counts>
        <p>
          <strong>Delete my lines</strong> also deletes every line you created, imported or edited
          {summary.custom > 0 ? ' — that cannot be undone, so export first if you want a copy' : ''}
          .
        </p>
        <p>
          <strong>Keep my lines</strong> leaves them as they are. An edited copy of a bundled line
          is one of your lines, so it then appears alongside the restored original.
        </p>
        <Check>
          <input
            type="checkbox"
            checked={clearPersonal}
            data-testid="refresh-clear-personal"
            onChange={(event) => setClearPersonal(event.target.checked)}
          />
          Also clear my Personal list ({lineCountLabel(summary.personal)})
        </Check>
        {clearPersonal ? (
          <Warning role="alert" data-testid="refresh-personal-warning">
            A cleared Personal list cannot be recovered.
          </Warning>
        ) : (
          <p>Otherwise Personal keeps every line that still exists after the refresh.</p>
        )}
      </Content>
    </ActionDialog>
  );
}

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;

  p {
    margin: 0;
  }
`;

const Counts = styled.ul`
  margin: 0;
  padding-left: ${(p) => p.theme.space.lg};
`;

const Check = styled.label`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-height: 44px;
  color: ${(p) => p.theme.color.text};
  font-weight: 600;
  cursor: pointer;

  input {
    width: 18px;
    height: 18px;
    margin: 0;
  }
`;

const Warning = styled.p`
  color: ${(p) => p.theme.color.danger};
  font-weight: 600;
`;
