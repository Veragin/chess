/**
 * `#/training` — the saved repertoire (README §7 Phase 5).
 *
 * Every row shows what the spec asks for (name, start position, move count, trained-as colour,
 * updated date) and offers Edit / Play / Open in analyze / Delete. Export and import go straight
 * through `storage/lines.ts`; all this file does is turn the result into a `Blob` or a report.
 *
 * No logic worth testing lives here: filtering, labelling, the export filename and the import
 * wording are pure functions in `./lines/` with their own unit tests (README §9).
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import styled from 'styled-components';
import { Button, Panel } from '../../components/ui';
import { loadPosition } from '../../state/analysis';
import { deleteLine, exportAll, importFile, listLines, storageWarning } from '../../storage/lines';
import type { Line } from '../../storage/schema';
import { ConfirmDialog } from './lines/ConfirmDialog';
import { LinkButton } from './lines/LinkButton';
import { Notice, NoticeList, NoticeTitle } from './lines/Notice';
import { downloadText, serialiseLinesFile } from './lines/download';
import { describeImport, type ImportReportView } from './lines/importReport';
import {
  colorLabel,
  describeLine,
  exportFileName,
  filterLines,
  formatTimestamp,
  isStandardStart,
  moveCountLabel,
  startPositionLabel,
} from './lines/lineFormat';

export function LinesList() {
  const navigate = useNavigate();
  const [lines, setLines] = useState<Line[]>(() => listLines());
  const [warning, setWarning] = useState<string | null>(() => storageWarning());
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Line | null>(null);
  const [report, setReport] = useState<ImportReportView | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Re-reads the store. Also refreshes the storage warning, which any write can raise. */
  const refresh = useCallback(() => {
    setLines(listLines());
    setWarning(storageWarning());
  }, []);

  const visible = useMemo(() => filterLines(lines, query), [lines, query]);

  const openInAnalyze = useCallback(
    (line: Line) => {
      // `state/analysis.ts` is the hand-off point: load first, then navigate, so the section
      // has the line already in place on its first paint.
      loadPosition(line.startFen, line.moves);
      navigate('/analyze');
    },
    [navigate],
  );

  const onExport = useCallback(() => {
    const file = exportAll();
    const ok = downloadText(exportFileName(file.exportedAt), serialiseLinesFile(file));
    setWarning(storageWarning());
    if (!ok) {
      setReport({ tone: 'error', headline: 'The browser refused the download.', details: [] });
    }
  }, []);

  const onImportPicked = useCallback(
    async (file: File) => {
      let text: string;
      try {
        text = await file.text();
      } catch {
        setReport({
          tone: 'error',
          headline: 'That file could not be read — your saved lines were left untouched.',
          details: [],
        });
        return;
      }
      // `importFile` validates shape, FEN legality and SAN replayability before writing
      // anything, so a corrupt file cannot damage what is already stored (README §6).
      setReport(describeImport(importFile(text)));
      refresh();
    },
    [refresh],
  );

  const confirmDelete = useCallback(() => {
    if (pendingDelete !== null) deleteLine(pendingDelete.id);
    setPendingDelete(null);
    refresh();
  }, [pendingDelete, refresh]);

  const empty = lines.length === 0;

  return (
    <Wrap data-testid="lines-list">
      <TopBar>
        <Heading>Lines</Heading>
        <Grow />
        <Button variant="primary" data-testid="new-line" onClick={() => navigate('/training/new')}>
          New line
        </Button>
        <LinkButton to="/training/drill" data-testid="drill-link">
          Drill
        </LinkButton>
      </TopBar>

      {warning !== null && (
        <Notice $tone="warn" role="alert" data-testid="storage-warning">
          <NoticeTitle>Storage problem</NoticeTitle>
          {warning}
        </Notice>
      )}

      <Panel
        title={`${lines.length} saved line${lines.length === 1 ? '' : 's'}`}
        actions={
          <FileActions>
            <Button size="sm" data-testid="export-button" onClick={onExport} disabled={empty}>
              Export…
            </Button>
            <Button
              size="sm"
              data-testid="import-button"
              onClick={() => fileInputRef.current?.click()}
            >
              Import…
            </Button>
            <HiddenFileInput
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              data-testid="import-input"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                // Clear the value so picking the same file twice still fires a change event.
                event.target.value = '';
                if (picked !== undefined) void onImportPicked(picked);
              }}
            />
          </FileActions>
        }
        padded={false}
      >
        <Body>
          {/* Nothing to search through while the store is empty. */}
          {!empty && (
            <SearchRow>
              <SearchLabel htmlFor="lines-search">Search by name</SearchLabel>
              <SearchInput
                id="lines-search"
                type="search"
                placeholder="e.g. Najdorf"
                value={query}
                autoComplete="off"
                data-testid="search-input"
                onChange={(event) => setQuery(event.target.value)}
              />
            </SearchRow>
          )}

          {report !== null && (
            <Notice $tone={report.tone} role="status" data-testid="import-report">
              <ReportHeader>
                <NoticeTitle>{report.headline}</NoticeTitle>
                <Button size="sm" data-testid="dismiss-report" onClick={() => setReport(null)}>
                  Dismiss
                </Button>
              </ReportHeader>
              {report.details.length > 0 && (
                <NoticeList data-testid="import-rejections">
                  {report.details.map((detail, i) => (
                    <li key={`${i}-${detail}`}>{detail}</li>
                  ))}
                </NoticeList>
              )}
            </Notice>
          )}

          {empty ? (
            <EmptyState data-testid="lines-empty">
              <p>No lines saved yet.</p>
              <p>
                A line is a starting position plus one ordered sequence of moves — the repertoire
                you then practise in line play and drill.
              </p>
              <Button
                variant="primary"
                data-testid="empty-new-line"
                onClick={() => navigate('/training/new')}
              >
                Create your first line
              </Button>
            </EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState data-testid="lines-no-match">
              <p>No line name matches “{query.trim()}”.</p>
              <Button data-testid="clear-search" onClick={() => setQuery('')}>
                Clear search
              </Button>
            </EmptyState>
          ) : (
            <Rows>
              {visible.map((line) => (
                <RowCard
                  key={line.id}
                  aria-label={describeLine(line)}
                  data-testid="line-row"
                  data-line-id={line.id}
                >
                  <RowHead>
                    <LineName data-testid="line-name">
                      {line.name.trim().length === 0 ? 'Untitled line' : line.name}
                    </LineName>
                    <ColorBadge $white={line.userColor === 'w'} data-testid="line-color">
                      as {colorLabel(line.userColor)}
                    </ColorBadge>
                  </RowHead>

                  <Meta>
                    <span data-testid="line-moves">{moveCountLabel(line.moves.length)}</span>
                    <MetaSep>·</MetaSep>
                    <span data-testid="line-updated">
                      updated {formatTimestamp(line.updatedAt)}
                    </span>
                  </Meta>

                  <StartFen
                    $standard={isStandardStart(line.startFen)}
                    data-testid="line-start"
                    title={line.startFen}
                  >
                    {startPositionLabel(line.startFen)}
                  </StartFen>

                  {line.notes !== undefined && line.notes.trim().length > 0 && (
                    <Notes data-testid="line-notes">{line.notes}</Notes>
                  )}

                  <Actions>
                    <LinkButton
                      to={`/training/${line.id}/play`}
                      $variant="primary"
                      $size="sm"
                      data-testid="line-play"
                    >
                      Play
                    </LinkButton>
                    <LinkButton to={`/training/${line.id}/edit`} $size="sm" data-testid="line-edit">
                      Edit
                    </LinkButton>
                    <Button size="sm" data-testid="line-analyze" onClick={() => openInAnalyze(line)}>
                      Open in analyze
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      data-testid="line-delete"
                      onClick={() => setPendingDelete(line)}
                    >
                      Delete
                    </Button>
                  </Actions>
                </RowCard>
              ))}
            </Rows>
          )}
        </Body>
      </Panel>

      {pendingDelete !== null && (
        <ConfirmDialog
          title="Delete this line?"
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        >
          <strong>
            {pendingDelete.name.trim().length === 0 ? 'Untitled line' : pendingDelete.name}
          </strong>{' '}
          ({moveCountLabel(pendingDelete.moves.length)}) will be removed. This cannot be undone —
          export first if you want a copy.
        </ConfirmDialog>
      )}
    </Wrap>
  );
}

/* ----------------------------------- styles ----------------------------------- */

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  min-width: 0;
`;

const TopBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const Heading = styled.h1`
  margin: 0;
  font-size: ${(p) => p.theme.font.size.xl};
`;

const Grow = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`;

const FileActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${(p) => p.theme.space.xs};
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  padding: ${(p) => p.theme.space.md};
  min-width: 0;
`;

const SearchRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;
`;

const SearchLabel = styled.label`
  font-size: ${(p) => p.theme.font.size.sm};
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${(p) => p.theme.color.textMuted};
`;

const SearchInput = styled.input`
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0 ${(p) => p.theme.space.sm};
  background: ${(p) => p.theme.color.bg};
  color: ${(p) => p.theme.color.text};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.md};

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 1px;
  }
`;

const ReportHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${(p) => p.theme.space.sm};
  padding: ${(p) => p.theme.space.md} 0;
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.md};
  max-width: 60ch;

  p {
    margin: 0;
  }
`;

const Rows = styled.ul`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.sm};
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
`;

const RowCard = styled.li`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;
  padding: ${(p) => p.theme.space.md};
  background: ${(p) => p.theme.color.surfaceAlt};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
`;

const RowHead = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
`;

const LineName = styled.h3`
  flex: 1 1 auto;
  margin: 0;
  min-width: 0;
  font-size: ${(p) => p.theme.font.size.lg};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ColorBadge = styled.span<{ $white: boolean }>`
  flex: 0 0 auto;
  padding: 2px ${(p) => p.theme.space.sm};
  border-radius: 999px;
  border: 1px solid ${(p) => p.theme.color.border};
  background: ${(p) => (p.$white ? p.theme.color.text : p.theme.color.bg)};
  color: ${(p) => (p.$white ? p.theme.color.bg : p.theme.color.text)};
  font-size: ${(p) => p.theme.font.size.sm};
  font-weight: 600;
  white-space: nowrap;
`;

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${(p) => p.theme.space.xs};
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const MetaSep = styled.span`
  color: ${(p) => p.theme.color.textFaint};
`;

const StartFen = styled.p<{ $standard: boolean }>`
  margin: 0;
  min-width: 0;
  color: ${(p) => p.theme.color.textFaint};
  font-family: ${(p) => (p.$standard ? p.theme.font.body : p.theme.font.mono)};
  font-size: ${(p) => p.theme.font.size.sm};
  overflow-wrap: anywhere;
`;

const Notes = styled.p`
  margin: 0;
  min-width: 0;
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
  overflow-wrap: anywhere;
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${(p) => p.theme.space.xs};
  margin-top: ${(p) => p.theme.space.xs};
  min-width: 0;
`;
