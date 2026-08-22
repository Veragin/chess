/**
 * `#/training` — the saved repertoire (README §7 Phase 5).
 *
 * The list is **one folder at a time**: breadcrumbs up, subfolder cards down, and the lines filed
 * directly here in between. Folders are implicit in each line's `folder` path (see
 * `storage/folders.ts`), so this screen never creates or deletes one — it only navigates them,
 * and a folder disappears when its last line leaves.
 *
 * The open folder lives in `?folder=` (see `./lines/folderNav.ts`), which is what lets "Drill this
 * folder" and the editor's Back button land where the user actually was.
 *
 * Every row shows what the spec asks for (name, start position, move count, trained-as colour,
 * updated date) and offers Edit / Play / Open in analyze / Delete. Export and import go straight
 * through `storage/lines.ts`; all this file does is turn the result into a `Blob` or a report.
 *
 * No logic worth testing lives here: filtering, folder arithmetic, labelling, the export filename
 * and the import wording are pure functions in `./lines/` and `storage/folders.ts` with their own
 * unit tests (README §9).
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import styled from 'styled-components';
import { Button, Panel } from '../../components/ui';
import { loadPosition } from '../../state/analysis';
import {
  childFolders,
  folderCrumbs,
  folderName,
  lineFolder,
  linesInFolder,
  linesUnderFolder,
} from '../../storage/folders';
import {
  deleteLine,
  exportAll,
  importFile,
  listLines,
  renameFolder,
  storageWarning,
} from '../../storage/lines';
import { normaliseFolderPath, type Line } from '../../storage/schema';
import { seedReport } from '../../storage/seed';
import { ConfirmDialog } from './lines/ConfirmDialog';
import { LinkButton } from './lines/LinkButton';
import { Notice, NoticeList, NoticeTitle } from './lines/Notice';
import { downloadText, serialiseLinesFile } from './lines/download';
import { drillPath, editLinePath, newLinePath, playLinePath } from './lines/folderNav';
import { describeImport, describeSeed, type ImportReportView } from './lines/importReport';
import {
  colorLabel,
  describeLine,
  exportFileName,
  filterLines,
  folderCountLabel,
  formatTimestamp,
  isStandardStart,
  lineCountLabel,
  moveCountLabel,
  normaliseQuery,
  startPositionLabel,
  subfolderCountLabel,
} from './lines/lineFormat';

export function LinesList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const folder = normaliseFolderPath(params.get('folder'));

  const [lines, setLines] = useState<Line[]>(() => listLines());
  const [warning, setWarning] = useState<string | null>(() => storageWarning());
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Line | null>(null);
  /** Non-null while the rename dialog is open; holds the name being typed. */
  const [renameTo, setRenameTo] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  // Seeded lines need no announcement — they are simply in the list. A bundled file that could
  // not be read does, or its lines would be missing with no explanation (see `describeSeed`).
  const [report, setReport] = useState<ImportReportView | null>(() => describeSeed(seedReport()));
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Re-reads the store. Also refreshes the storage warning, which any write can raise. */
  const refresh = useCallback(() => {
    setLines(listLines());
    setWarning(storageWarning());
  }, []);

  const openFolder = useCallback(
    (path: string) => {
      const next = normaliseFolderPath(path);
      // A search is scoped to the folder it was typed in, so moving folders clears it rather
      // than silently re-running it somewhere else.
      setQuery('');
      if (next.length === 0) setParams({});
      else setParams({ folder: next });
    },
    [setParams],
  );

  const searching = normaliseQuery(query).length > 0;
  /** Everything at or below the open folder — the search scope, and what drill would serve. */
  const scope = useMemo(() => linesUnderFolder(lines, folder), [lines, folder]);
  /** Lines filed directly here. */
  const here = useMemo(() => linesInFolder(lines, folder), [lines, folder]);
  const subfolders = useMemo(() => childFolders(lines, folder), [lines, folder]);
  const crumbs = useMemo(() => folderCrumbs(folder), [folder]);
  const matches = useMemo(() => filterLines(scope, query), [scope, query]);

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

  const confirmRename = useCallback(() => {
    if (renameTo === null) return;
    // The dialog renames the folder in place, so only its last segment is editable; the parent
    // path is carried over. Moving a folder elsewhere is a rename of the lines, not of a folder.
    const parent = crumbs[crumbs.length - 2]?.path ?? '';
    const target = normaliseFolderPath(parent.length === 0 ? renameTo : `${parent}/${renameTo}`);
    const result = renameFolder(folder, target);
    if (!result.ok) {
      setRenameError(result.error ?? 'That folder name cannot be used.');
      return;
    }
    setRenameTo(null);
    setRenameError(null);
    refresh();
    openFolder(target);
    if (result.error !== undefined) setWarning(result.error);
  }, [crumbs, folder, openFolder, refresh, renameTo]);

  const storeEmpty = lines.length === 0;
  const inFolder = folder.length > 0;
  const nothingHere = here.length === 0 && subfolders.length === 0;

  return (
    <Wrap data-testid="lines-list" data-folder={folder}>
      <TopBar>
        <Heading>{inFolder ? folderName(folder) : 'Lines'}</Heading>
        <Grow />
        <Button
          variant="primary"
          data-testid="new-line"
          onClick={() => navigate(newLinePath(folder))}
        >
          New line
        </Button>
        <LinkButton to={drillPath(folder)} data-testid="drill-link">
          {inFolder ? 'Drill folder' : 'Drill'}
        </LinkButton>
      </TopBar>

      {/* Always rendered, so the root is a folder like any other and "where am I" is never a
          guess. The last crumb is the open folder and is not a link. */}
      <Breadcrumbs aria-label="Folder path" data-testid="folder-crumbs">
        {crumbs.map((crumb, index) =>
          index === crumbs.length - 1 ? (
            <Crumb key={crumb.path} aria-current="page" data-testid="crumb-current">
              {crumb.name}
            </Crumb>
          ) : (
            <CrumbGroup key={crumb.path}>
              <CrumbLink
                type="button"
                data-testid="crumb-link"
                onClick={() => openFolder(crumb.path)}
              >
                {crumb.name}
              </CrumbLink>
              <CrumbSep aria-hidden="true">/</CrumbSep>
            </CrumbGroup>
          ),
        )}
      </Breadcrumbs>

      {warning !== null && (
        <Notice $tone="warn" role="alert" data-testid="storage-warning">
          <NoticeTitle>Storage problem</NoticeTitle>
          {warning}
        </Notice>
      )}

      <Panel
        title={
          storeEmpty
            ? 'No saved lines'
            : inFolder
              ? folderCountLabel(here.length, scope.length)
              : `${lineCountLabel(lines.length)} saved`
        }
        actions={
          <FileActions>
            {inFolder && (
              <Button
                size="sm"
                data-testid="rename-folder"
                onClick={() => {
                  setRenameError(null);
                  setRenameTo(folderName(folder));
                }}
              >
                Rename folder…
              </Button>
            )}
            <Button size="sm" data-testid="export-button" onClick={onExport} disabled={storeEmpty}>
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
          {!storeEmpty && (
            <SearchRow>
              <SearchLabel htmlFor="lines-search">
                {inFolder ? `Search by name in ${folderName(folder)}` : 'Search by name'}
              </SearchLabel>
              <SearchInput
                id="lines-search"
                type="search"
                placeholder="e.g. Najdorf"
                value={query}
                autoComplete="off"
                data-testid="search-input"
                onChange={(event) => setQuery(event.target.value)}
              />
              {inFolder && (
                <Hint>Searches this folder and everything below it.</Hint>
              )}
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

          {storeEmpty ? (
            <EmptyState data-testid="lines-empty">
              <p>No lines saved yet.</p>
              <p>
                A line is a starting position plus one ordered sequence of moves — the repertoire
                you then practise in line play and drill. Give a line a folder (
                <code>Black/Sicilian</code>) to group it with the rest of that repertoire.
              </p>
              <Button
                variant="primary"
                data-testid="empty-new-line"
                onClick={() => navigate(newLinePath(folder))}
              >
                Create your first line
              </Button>
            </EmptyState>
          ) : searching ? (
            matches.length === 0 ? (
              <EmptyState data-testid="lines-no-match">
                <p>
                  No line name matches “{query.trim()}”
                  {inFolder ? ` in ${folderName(folder)}` : ''}.
                </p>
                <Button data-testid="clear-search" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              </EmptyState>
            ) : (
              <Rows>
                {matches.map((line) => renderRow(line))}
              </Rows>
            )
          ) : (
            <>
              {subfolders.length > 0 && (
                <Rows data-testid="folder-rows">
                  {subfolders.map((node) => (
                    <FolderCard key={node.path} data-testid="folder-row" data-folder={node.path}>
                      <FolderButton
                        type="button"
                        data-testid="folder-open"
                        onClick={() => openFolder(node.path)}
                      >
                        <FolderIcon aria-hidden="true">📁</FolderIcon>
                        <FolderText>
                          <FolderNameText>{node.name}</FolderNameText>
                          <Meta>
                            <span data-testid="folder-count">{lineCountLabel(node.lineCount)}</span>
                            {node.subfolderCount > 0 && (
                              <>
                                <MetaSep>·</MetaSep>
                                <span>{subfolderCountLabel(node.subfolderCount)}</span>
                              </>
                            )}
                          </Meta>
                        </FolderText>
                      </FolderButton>
                      <LinkButton
                        to={drillPath(node.path)}
                        $size="sm"
                        data-testid="folder-drill"
                        aria-label={`Drill ${node.name}`}
                      >
                        Drill
                      </LinkButton>
                    </FolderCard>
                  ))}
                </Rows>
              )}

              {here.length > 0 && <Rows>{here.map((line) => renderRow(line))}</Rows>}

              {/* Only reachable inside a folder that no line names any more — a stale link, or
                  the last line moved out. Folders have no existence of their own to report on. */}
              {nothingHere && (
                <EmptyState data-testid="folder-empty">
                  <p>
                    There is nothing in {folderName(folder)}. Its lines may have been moved,
                    renamed or deleted.
                  </p>
                  <ButtonRow>
                    <Button
                      variant="primary"
                      data-testid="folder-empty-new-line"
                      onClick={() => navigate(newLinePath(folder))}
                    >
                      New line here
                    </Button>
                    <Button data-testid="folder-empty-root" onClick={() => openFolder('')}>
                      Back to all lines
                    </Button>
                  </ButtonRow>
                </EmptyState>
              )}
            </>
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

      {renameTo !== null && (
        <ConfirmDialog
          title="Rename folder"
          confirmLabel="Rename"
          tone="primary"
          autoFocusCancel={false}
          onCancel={() => {
            setRenameTo(null);
            setRenameError(null);
          }}
          onConfirm={confirmRename}
        >
          <DialogField>
            <label htmlFor="folder-rename">New name for {folderName(folder)}</label>
            <SearchInput
              id="folder-rename"
              autoFocus
              value={renameTo}
              autoComplete="off"
              data-testid="rename-input"
              onChange={(event) => {
                setRenameError(null);
                setRenameTo(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirmRename();
              }}
            />
            <span>
              {lineCountLabel(scope.length)} will move with it, subfolders included. Nothing else
              about them changes.
            </span>
            {renameError !== null && (
              <Notice $tone="error" role="alert" data-testid="rename-error">
                {renameError}
              </Notice>
            )}
          </DialogField>
        </ConfirmDialog>
      )}
    </Wrap>
  );

  /**
   * One line row. Declared inside the component because it needs the handlers; it stays a plain
   * function (not a nested component) so React never sees a new component type per render.
   */
  function renderRow(line: Line) {
    const path = lineFolder(line);
    return (
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
          <span data-testid="line-updated">updated {formatTimestamp(line.updatedAt)}</span>
          {/* Only worth saying when the row is not in the folder being shown — i.e. in search
              results from a subfolder. */}
          {path !== folder && (
            <>
              <MetaSep>·</MetaSep>
              <FolderTag
                type="button"
                data-testid="line-folder"
                onClick={() => openFolder(path)}
                title={`Open ${path}`}
              >
                📁 {path}
              </FolderTag>
            </>
          )}
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
            to={playLinePath(line.id, folder)}
            $variant="primary"
            $size="sm"
            data-testid="line-play"
          >
            Play
          </LinkButton>
          <LinkButton to={editLinePath(line.id, folder)} $size="sm" data-testid="line-edit">
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
    );
  }
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
  min-width: 0;
  font-size: ${(p) => p.theme.font.size.xl};
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Grow = styled.div`
  flex: 1 1 auto;
  min-width: 0;
`;

const Breadcrumbs = styled.nav`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  min-width: 0;
  font-size: ${(p) => p.theme.font.size.sm};
`;

const CrumbGroup = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
`;

const Crumb = styled.span`
  color: ${(p) => p.theme.color.text};
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CrumbLink = styled.button`
  padding: 0;
  border: 0;
  background: none;
  color: ${(p) => p.theme.color.accent};
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }
`;

const CrumbSep = styled.span`
  color: ${(p) => p.theme.color.textFaint};
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

const Hint = styled.p`
  margin: 0;
  color: ${(p) => p.theme.color.textFaint};
  font-size: ${(p) => p.theme.font.size.sm};
`;

const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${(p) => p.theme.space.sm};
`;

const DialogField = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;

  label {
    font-weight: 600;
    color: ${(p) => p.theme.color.text};
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

const FolderCard = styled.li`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
  padding: ${(p) => p.theme.space.xs} ${(p) => p.theme.space.md};
  background: ${(p) => p.theme.color.surfaceAlt};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
`;

const FolderButton = styled.button`
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-width: 0;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }
`;

const FolderIcon = styled.span`
  flex: 0 0 auto;
  font-size: ${(p) => p.theme.font.size.lg};
`;

const FolderText = styled.span`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const FolderNameText = styled.span`
  font-size: ${(p) => p.theme.font.size.lg};
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

const FolderTag = styled.button`
  padding: 0;
  border: 0;
  background: none;
  color: ${(p) => p.theme.color.accent};
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }
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
