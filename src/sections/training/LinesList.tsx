/**
 * `#/training` — the saved repertoire (README §7 Phase 5).
 *
 * Two sections, picked with the **Favourite | Openings** switch at the top (Openings is the UI name
 * of the Database set) and held in `?set=`
 * (see `./lines/folderNav.ts`): Database is every saved line, Personal only the lines the user
 * picked to learn (`storage/personal.ts` — ids, never copies). Both show the same folder structure,
 * because both derive it from the lines' own `folder` paths (`./lines/lineSet.ts`). The section is
 * remembered for the tab (`sessionStorage`): opening `#/training` without `?set=` after leaving
 * Personal goes back to Personal.
 *
 * The list is **one folder at a time**: breadcrumbs up, subfolder cards down, and the lines filed
 * directly here in between. Folders are implicit in each line's `folder` path (see
 * `storage/folders.ts`), so this screen never creates or deletes one — it only navigates them,
 * and a folder disappears when its last line leaves.
 *
 * The open folder lives in `?folder=`, and every link out of here carries `set` too, which is
 * what lets "Drill this folder", explore and the editor's Back button land where the user
 * actually was.
 *
 * Every row shows what the spec asks for (name, start position, move count, trained-as colour,
 * updated date) and offers Drill / Explore / Edit / Analyze, a ★/☆ Favourite star (the
 * UI name of the Personal set; in that section it only unstars), and — in Database only — Delete. A row's Drill
 * button is the same drill screen as the header's, with a pool of exactly that one line (see
 * `drillLinePath`); its Explore button opens `#/training/explore` on the line, scoped to its own
 * folder — the lines it could transpose with are its siblings, not whichever folder the list
 * happened to be showing. A folder card's star (and the open folder's header buttons) add or remove
 * a whole folder from Favourite in one write.
 *
 * Export and import go straight through `storage/lines.ts`; all this file does is turn the
 * result into a `Blob` or a report. Export follows the open folder — inside one it writes that
 * folder and its subfolders (the Drill/Explore scope), at the root the whole section; in Personal
 * that is the picked lines only. Import, "Refresh data…" and folder rename belong to the database
 * and are offered only there. "Refresh data…" is the one action that ignores the open folder: it
 * reinstalls the bundled lines and optionally deletes the user's own (`storage/reset.ts`), so its
 * dialog (`./lines/RefreshDialog.tsx`) counts what it would change.
 *
 * Bundled ("server") lines and the user's own are listed together; own lines carry a "Custom"
 * badge, and the "My lines" filter hides the bundled ones. The filter is remembered for the tab
 * (`sessionStorage`), so it survives a round trip through the editor or a drill.
 *
 * "White only" / "Black only" keep just the lines trained as that colour. That filter is explore's
 * own "Trained for" setting (`state/explore.ts`), so Explore opens already narrowed to the same
 * side; Drill links carry it as `?side=` (`./lines/folderNav.ts`).
 *
 * No logic worth testing lives here: filtering, folder arithmetic, labelling, the export filename
 * and the report wording are pure functions in `./lines/` and `storage/folders.ts` with their own
 * unit tests (README §9).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import styled from 'styled-components';
import { branchSpec } from '../../chess/line';
import { Button, Panel } from '../../components/ui';
import { loadPosition } from '../../state/analysis';
import { loadExploration, useTrainedFor } from '../../state/explore';
import { linesTrainedFor, type TrainedFor } from '../explore/coverage';
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
    exportFolder,
    importFile,
    isServerLine,
    renameFolder,
    storageWarning,
} from '../../storage/lines';
import { addPersonal, personalIds, removePersonal } from '../../storage/personal';
import {
    refreshData,
    resetSummary,
    type RefreshMode,
    type ResetSummary,
} from '../../storage/reset';
import {
    LINES_SCHEMA_VERSION,
    normaliseFolderPath,
    type Line,
    type LinesFile,
} from '../../storage/schema';
import { seedReport } from '../../storage/seed';
import { ConfirmDialog } from './lines/ConfirmDialog';
import { LinkButton } from './lines/LinkButton';
import { Notice, NoticeList, NoticeTitle } from './lines/Notice';
import { OverflowActions, type OverflowAction } from './lines/OverflowActions';
import { RefreshDialog } from './lines/RefreshDialog';
import { downloadText, serialiseLinesFile } from './lines/download';
import {
    drillLinePath,
    drillPath,
    editLinePath,
    explorePath,
    linesPath,
    newLinePath,
    parseLineSet,
    type LineSet,
} from './lines/folderNav';
import {
    combineReports,
    describeImport,
    describeRefresh,
    describeSeed,
    type ImportReportView,
} from './lines/importReport';
import { linesOfSet } from './lines/lineSet';
import {
    colorLabel,
    describeLine,
    exportFileName,
    filterLines,
    folderCountLabel,
    formatTimestamp,
    isStandardStart,
    lineCountLabel,
    lineSizeLabel,
    normaliseQuery,
    startPositionLabel,
    subfolderCountLabel,
} from './lines/lineFormat';
import { favouriteToggleLabel, folderPersonalStatus } from './lines/personalStatus';

const MINE_ONLY_KEY = 'chess-trainer.linesMineOnly';
const SET_KEY = 'chess-trainer.linesSet';

/** Per-tab convenience only, so any storage failure just means "filter off". */
function readMineOnly(): boolean {
    try {
        return globalThis.sessionStorage?.getItem(MINE_ONLY_KEY) === '1';
    } catch {
        return false;
    }
}

function writeMineOnly(on: boolean): void {
    try {
        if (on) globalThis.sessionStorage?.setItem(MINE_ONLY_KEY, '1');
        else globalThis.sessionStorage?.removeItem(MINE_ONLY_KEY);
    } catch {
        // Not remembered; the filter still applies for this visit.
    }
}

/** The section last shown in this tab; any storage failure just means "Database". */
function readRememberedSet(): LineSet {
    try {
        return globalThis.sessionStorage?.getItem(SET_KEY) === 'favourite' ? 'favourite' : 'database';
    } catch {
        return 'database';
    }
}

function writeRememberedSet(set: LineSet): void {
    try {
        if (set === 'favourite') globalThis.sessionStorage?.setItem(SET_KEY, 'favourite');
        else globalThis.sessionStorage?.removeItem(SET_KEY);
    } catch {
        // Not remembered; `#/training` simply opens on Database next time.
    }
}

/** Shown when a Personal write only reached memory (`addPersonal`/`removePersonal` → false). */
const PERSONAL_NOT_SAVED =
    'Your Favourite list could not be saved in this browser (private browsing or blocked storage). ' +
    'The change holds until the page is reloaded.';

/** Everything the list reads from storage for one section, re-read together by `refresh`. */
interface Snapshot {
    set: LineSet;
    lines: Line[];
    personal: Set<string>;
}

function readSnapshot(set: LineSet): Snapshot {
    return { set, lines: linesOfSet(set), personal: personalIds() };
}

/** A folder waiting for "Remove from Personal?" to be confirmed. */
interface PendingFolderRemoval {
    path: string;
    ids: string[];
}

export function LinesList() {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const folder = normaliseFolderPath(params.get('folder'));
    /**
     * `?set=` wins; without it, the section this tab was last in. Database is spelled as no
     * parameter, so only a remembered Personal needs the URL rewritten (the effect below) — the
     * screen already renders it on this paint.
     */
    const urlHasSet = params.has('set');
    const set: LineSet = urlHasSet ? parseLineSet(params) : readRememberedSet();
    const inPersonal = set === 'favourite';

    useEffect(() => {
        if (!urlHasSet && set === 'favourite') {
            const next = new URLSearchParams(params);
            next.set('set', 'favourite');
            setParams(next, { replace: true });
        } else if (urlHasSet) {
            // Arriving on an explicit section (a Back link from drill or the editor) counts as
            // being there.
            writeRememberedSet(set);
        }
    }, [params, set, setParams, urlHasSet]);

    const [snapshot, setSnapshot] = useState<Snapshot>(() => readSnapshot(set));
    // A section switch (or Back/Forward across one) re-reads the store for the new section right
    // away, rather than a frame later from an effect.
    if (snapshot.set !== set) setSnapshot(readSnapshot(set));
    const allLines = snapshot.lines;
    const personal = snapshot.personal;
    /** Show only the user's own lines, hiding the bundled ones. */
    const [mineOnly, setMineOnly] = useState(readMineOnly);
    /** Show only the lines trained as one colour; shared with explore's "Trained for". */
    const [trainedFor, setTrainedFor] = useTrainedFor();
    /** What every count, folder and search below works on. */
    const lines = useMemo(
        () =>
            linesTrainedFor(
                mineOnly ? allLines.filter((line) => !isServerLine(line)) : allLines,
                trainedFor,
            ),
        [allLines, mineOnly, trainedFor],
    );
    const [warning, setWarning] = useState<string | null>(() => storageWarning());
    /** Set when a Personal add/remove only reached memory; Personal has no warning of its own. */
    const [personalWarning, setPersonalWarning] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [pendingDelete, setPendingDelete] = useState<Line | null>(null);
    const [pendingFolderRemoval, setPendingFolderRemoval] = useState<PendingFolderRemoval | null>(
        null,
    );
    /**
     * Non-null while the "refresh data" dialog is open, holding what the refresh would touch.
     * Counted when the dialog opens rather than on every render: it walks every stored line to
     * work out which are the user's own (see `storage/reset.ts`).
     */
    const [pendingRefresh, setPendingRefresh] = useState<ResetSummary | null>(null);
    /** Non-null while the rename dialog is open; holds the name being typed. */
    const [renameTo, setRenameTo] = useState<string | null>(null);
    const [renameError, setRenameError] = useState<string | null>(null);
    // Seeded lines need no announcement — they are simply in the list. A bundled file that could
    // not be read does, or its lines would be missing with no explanation (see `describeSeed`).
    const [report, setReport] = useState<ImportReportView | null>(() => describeSeed(seedReport()));
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    /** Re-reads the store. Also refreshes the storage warning, which any write can raise. */
    const refresh = useCallback(() => {
        setSnapshot(readSnapshot(set));
        setWarning(storageWarning());
    }, [set]);

    const toggleMineOnly = useCallback(() => {
        setMineOnly((on) => {
            writeMineOnly(!on);
            return !on;
        });
    }, []);

    /** Pressing the active colour again shows both colours. */
    const toggleTrainedFor = useCallback(
        (side: Exclude<TrainedFor, 'both'>) => setTrainedFor(trainedFor === side ? 'both' : side),
        [setTrainedFor, trainedFor],
    );

    const showAllLines = useCallback(() => {
        if (mineOnly) toggleMineOnly();
        setTrainedFor('both');
    }, [mineOnly, setTrainedFor, toggleMineOnly]);

    const openFolder = useCallback(
        (path: string) => {
            // A search is scoped to the folder it was typed in, so moving folders clears it rather
            // than silently re-running it somewhere else. The section stays.
            setQuery('');
            const next = normaliseFolderPath(path);
            const nextParams: Record<string, string> = {};
            if (next.length > 0) nextParams.folder = next;
            if (set === 'favourite') nextParams.set = 'favourite';
            setParams(nextParams);
        },
        [set, setParams],
    );

    /** The Personal | Database switch: back to that section's root, search cleared. */
    const switchSet = useCallback(
        (next: LineSet) => {
            writeRememberedSet(next);
            setQuery('');
            // Database is spelled out here, though every other URL leaves it implicit: the history
            // entry must still mean Database when Back returns to it after the remembered section
            // has become Personal (a bare `#/training` would be sent on to Personal).
            setParams({ set: next });
        },
        [setParams],
    );

    /** Adds or removes lines from Personal, saying so when the change only reached memory. */
    const changePersonal = useCallback(
        (ids: readonly string[], add: boolean) => {
            if (ids.length === 0) return;
            const saved = add ? addPersonal(ids) : removePersonal(ids);
            setPersonalWarning(saved ? null : PERSONAL_NOT_SAVED);
            refresh();
        },
        [refresh],
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
            // The main line (branch 0); its variations are the line editor's business.
            loadPosition(line.startFen, branchSpec(line, 0)?.moves ?? []);
            navigate('/analyze');
        },
        [navigate],
    );

    const openInExplore = useCallback(
        (line: Line) => {
            // Same hand-off as "Open in analyze", into explore's own store: the board opens at the end
            // of the line, and its move list is how the user walks back to where it branches.
            loadExploration(line.startFen, branchSpec(line, 0)?.moves ?? []);
            navigate(explorePath(lineFolder(line), set));
        },
        [navigate, set],
    );

    const onExport = useCallback(() => {
        // Scoped to the open folder — the same lines Drill and Explore would use from here, so the
        // file holds what the screen is showing rather than the whole repertoire. At the root that
        // is still everything in the section. Personal has no export of its own in storage: it is
        // the same file shape, holding only the picked lines.
        const file: LinesFile = inPersonal
            ? {
                  schemaVersion: LINES_SCHEMA_VERSION,
                  exportedAt: Date.now(),
                  lines: linesUnderFolder(allLines, folder),
              }
            : exportFolder(folder);
        const ok = downloadText(exportFileName(file.exportedAt, folder), serialiseLinesFile(file));
        setWarning(storageWarning());
        if (!ok) {
            setReport({
                tone: 'error',
                headline: 'The browser refused the download.',
                details: [],
            });
        }
    }, [allLines, folder, inPersonal]);

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
        // `deleteLine` also drops the id from Personal (`storage/lines.ts`).
        if (pendingDelete !== null) deleteLine(pendingDelete.id);
        setPendingDelete(null);
        refresh();
    }, [pendingDelete, refresh]);

    const confirmFolderRemoval = useCallback(() => {
        if (pendingFolderRemoval !== null) changePersonal(pendingFolderRemoval.ids, false);
        setPendingFolderRemoval(null);
    }, [changePersonal, pendingFolderRemoval]);

    const confirmRefresh = useCallback(
        (mode: RefreshMode, clearPersonal: boolean) => {
            if (pendingRefresh === null) return;
            const options = { mode, clearPersonal };
            const result = refreshData(options);
            setPendingRefresh(null);
            // The bundled set was reloaded, so its own problems (if any) are new news too.
            setReport(
                combineReports(
                    describeRefresh(pendingRefresh, options, result),
                    describeSeed(seedReport()),
                ),
            );
            // Lines, Personal and any degraded-session warning may all have changed, so everything
            // is re-read from scratch.
            refresh();
            setPersonalWarning(null);
            // Back to the root: the folder in `?folder=` may no longer contain anything.
            setQuery('');
            setParams({});
        },
        [pendingRefresh, refresh, setParams],
    );

    const confirmRename = useCallback(() => {
        if (renameTo === null) return;
        // The dialog renames the folder in place, so only its last segment is editable; the parent
        // path is carried over. Moving a folder elsewhere is a rename of the lines, not of a folder.
        const parent = crumbs[crumbs.length - 2]?.path ?? '';
        const target = normaliseFolderPath(
            parent.length === 0 ? renameTo : `${parent}/${renameTo}`,
        );
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

    const storeEmpty = allLines.length === 0;
    /** The filters hide everything in the section. */
    const noneMatchFilters = !storeEmpty && lines.length === 0;
    const sideLabel = trainedFor === 'both' ? '' : ` as ${colorLabel(trainedFor)}`;
    const inFolder = folder.length > 0;
    const nothingHere = here.length === 0 && subfolders.length === 0;
    /** How much of the open folder is in Personal — only asked in Database, inside a folder. */
    const folderStatus = folderPersonalStatus(scope, personal);

    /**
     * The panel header's buttons, shown in a row or a ⋮ menu (`OverflowActions`). Rename, Import
     * and "Refresh data…" belong to the database and are offered only there; "Refresh data…" is not
     * scoped to the open folder like Export is — the bundled set and the user's own lines are
     * reset as a whole.
     */
    const fileActions: OverflowAction[] = [
        ...(inFolder && !inPersonal
            ? [
                  {
                      key: 'rename',
                      label: 'Rename folder',
                      testId: 'rename-folder',
                      onSelect: () => {
                          setRenameError(null);
                          setRenameTo(folderName(folder));
                      },
                  },
              ]
            : []),
        {
            key: 'export',
            label: inFolder ? 'Export folder' : 'Export',
            testId: 'export-button',
            onSelect: onExport,
            // Nothing in scope, nothing to write — at the root that means an empty section.
            disabled: scope.length === 0,
            title: inFolder
                ? `Export the ${lineCountLabel(scope.length)} in ${folderName(folder)}, subfolders included`
                : inPersonal
                  ? 'Export every favourite line'
                  : 'Export every saved line',
        },
        ...(inPersonal
            ? []
            : [
                  {
                      key: 'import',
                      label: 'Import',
                      testId: 'import-button',
                      onSelect: () => fileInputRef.current?.click(),
                  },
                  {
                      key: 'refresh',
                      label: 'Refresh data…',
                      testId: 'refresh-data',
                      onSelect: () => setPendingRefresh(resetSummary()),
                      title: 'Reinstall the bundled lines, keeping or deleting your own',
                  },
              ]),
    ];

    return (
        <Wrap data-testid="lines-list" data-folder={folder} data-set={set}>
            {/* Two sections of one list, not two screens: a switch rather than links, and each
          press lands on that section's root. */}
            <SetTabs role="group" aria-label="Section" data-testid="set-switch">
                <SetTab
                    type="button"
                    $active={inPersonal}
                    aria-pressed={inPersonal}
                    data-testid="set-personal"
                    onClick={() => switchSet('favourite')}
                >
                    <TabStar aria-hidden="true">★</TabStar> Favourite
                </SetTab>
                <SetTab
                    type="button"
                    $active={!inPersonal}
                    aria-pressed={!inPersonal}
                    data-testid="set-database"
                    onClick={() => switchSet('database')}
                >
                    Openings
                </SetTab>
            </SetTabs>

            <TopBar>
                <Heading>{inFolder ? folderName(folder) : inPersonal ? 'Favourite' : 'Lines'}</Heading>
                <Grow />
                <Button
                    variant="primary"
                    data-testid="new-line"
                    onClick={() => navigate(newLinePath(folder, set))}
                >
                    New line
                </Button>
                <LinkButton to={drillPath(folder, set, trainedFor)} data-testid="drill-link">
                    {inFolder ? 'Drill folder' : 'Drill'}
                </LinkButton>
                {/* The same scope as Drill, asked the other way round: not "can I play these lines"
            but "what do they cover". */}
                <LinkButton to={explorePath(folder, set)} data-testid="explore-link">
                    Explore
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

            {personalWarning !== null && (
                <Notice $tone="warn" role="alert" data-testid="personal-warning">
                    <NoticeTitle>Storage problem</NoticeTitle>
                    {personalWarning}
                </Notice>
            )}

            <Panel
                title={
                    storeEmpty
                        ? inPersonal
                            ? 'No favourite lines'
                            : 'No saved lines'
                        : inFolder
                          ? folderCountLabel(here.length, scope.length)
                          : mineOnly
                            ? `${lineCountLabel(lines.length)} of your own${sideLabel}`
                            : `${lineCountLabel(lines.length)} ${inPersonal ? 'picked' : 'saved'}${sideLabel}`
                }
                actions={
                    <FileActions>
                        {/* The open folder's own Favourite star, like the ones on its subfolders'
                cards: filled once every line below is a favourite (pressing it then asks before
                unstarring the folder), hollow otherwise (pressing it stars the rest). In
                Favourite every line is starred, so there it only ever unstars. */}
                        {inFolder && scope.length > 0 && (
                            <StarButton
                                type="button"
                                $on={folderStatus === 'all'}
                                aria-pressed={folderStatus === 'all'}
                                data-testid="header-personal"
                                data-status={folderStatus}
                                aria-label={`${favouriteToggleLabel(folderStatus === 'all')}: ${folderName(folder)}`}
                                title={
                                    folderStatus === 'all'
                                        ? `Remove the ${lineCountLabel(scope.length)} in ${folderName(folder)} from Favourite`
                                        : `Add the ${lineCountLabel(scope.length)} in ${folderName(folder)} to Favourite, subfolders included`
                                }
                                onClick={() =>
                                    folderStatus === 'all'
                                        ? askFolderRemoval(folder, scope)
                                        : changePersonal(
                                              scope.map((line) => line.id),
                                              true,
                                          )
                                }
                            >
                                {folderStatus === 'all' ? '★' : '☆'}
                            </StarButton>
                        )}
                        {/* Folded into a ⋮ menu when the header is too narrow for the row. */}
                        <OverflowActions actions={fileActions} menuLabel="Folder actions" />
                        {!inPersonal && (
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
                        )}
                    </FileActions>
                }
                padded={false}
            >
                <Body>
                    {/* Nothing to search through while the section is empty. */}
                    {!storeEmpty && (
                        <SearchRow>
                            <SearchLabel htmlFor="lines-search">
                                {inFolder
                                    ? `Search by name in ${folderName(folder)}`
                                    : 'Search by name'}
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
                            {inFolder && <Hint>Searches this folder and everything below it.</Hint>}
                            <FilterRow>
                                <Button
                                    size="sm"
                                    variant={mineOnly ? 'primary' : 'secondary'}
                                    aria-pressed={mineOnly}
                                    data-testid="filter-mine"
                                    onClick={toggleMineOnly}
                                    title="Show only lines you created, imported or edited"
                                >
                                    My lines only
                                </Button>
                                <Button
                                    size="sm"
                                    variant={trainedFor === 'w' ? 'primary' : 'secondary'}
                                    aria-pressed={trainedFor === 'w'}
                                    data-testid="filter-white"
                                    onClick={() => toggleTrainedFor('w')}
                                    title="Show only lines trained as White — Drill and Explore follow"
                                >
                                    White only
                                </Button>
                                <Button
                                    size="sm"
                                    variant={trainedFor === 'b' ? 'primary' : 'secondary'}
                                    aria-pressed={trainedFor === 'b'}
                                    data-testid="filter-black"
                                    onClick={() => toggleTrainedFor('b')}
                                    title="Show only lines trained as Black — Drill and Explore follow"
                                >
                                    Black only
                                </Button>
                            </FilterRow>
                        </SearchRow>
                    )}

                    {report !== null && (
                        <Notice $tone={report.tone} role="status" data-testid="import-report">
                            <ReportHeader>
                                <NoticeTitle>{report.headline}</NoticeTitle>
                                <Button
                                    size="sm"
                                    data-testid="dismiss-report"
                                    onClick={() => setReport(null)}
                                >
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

                    {storeEmpty && inPersonal ? (
                        <EmptyState data-testid="personal-empty">
                            <p>
                                You haven’t picked any favourites yet. Open Openings, and
                                star the lines you want to learn with ☆.
                            </p>
                            <LinkButton
                                to={linesPath('', 'database')}
                                $variant="primary"
                                data-testid="personal-empty-database"
                                // The bare Database URL would otherwise be sent back to the
                                // remembered Personal section.
                                onClick={() => writeRememberedSet('database')}
                            >
                                Open Openings
                            </LinkButton>
                        </EmptyState>
                    ) : storeEmpty ? (
                        <EmptyState data-testid="lines-empty">
                            <p>No lines saved yet.</p>
                            <p>
                                A line is a starting position plus one ordered sequence of moves —
                                the repertoire you then practise in drill. Give a line a folder (
                                <code>Black/Sicilian</code>) to group it with the rest of that
                                repertoire.
                            </p>
                            <Button
                                variant="primary"
                                data-testid="empty-new-line"
                                onClick={() => navigate(newLinePath(folder, set))}
                            >
                                Create your first line
                            </Button>
                        </EmptyState>
                    ) : noneMatchFilters && mineOnly && trainedFor === 'both' ? (
                        <EmptyState data-testid="lines-none-mine">
                            <p>
                                {inPersonal
                                    ? 'None of your favourite lines are your own — they are all bundled lines.'
                                    : 'You have no lines of your own yet.'}{' '}
                                Create one, import a file, or edit a bundled line — editing saves
                                your own copy.
                            </p>
                            <Button data-testid="filter-mine-off" onClick={toggleMineOnly}>
                                Show all lines
                            </Button>
                        </EmptyState>
                    ) : noneMatchFilters ? (
                        <EmptyState data-testid="lines-none-filtered">
                            <p>
                                No {mineOnly ? 'lines of your own' : inPersonal ? 'favourite lines' : 'lines'}{' '}
                                are trained{sideLabel}.
                            </p>
                            <Button data-testid="filter-off" onClick={showAllLines}>
                                Show all lines
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
                            <Rows>{matches.map((line) => renderRow(line))}</Rows>
                        )
                    ) : (
                        <>
                            {subfolders.length > 0 && (
                                <Rows data-testid="folder-rows">
                                    {subfolders.map((node) => renderFolderCard(node))}
                                </Rows>
                            )}

                            {here.length > 0 && <Rows>{here.map((line) => renderRow(line))}</Rows>}

                            {/* Only reachable inside a folder that no line names any more — a stale link, or
                  the last line moved out. Folders have no existence of their own to report on. */}
                            {nothingHere && (
                                <EmptyState data-testid="folder-empty">
                                    <p>
                                        There is nothing in {folderName(folder)}. Its lines may have
                                        been moved, renamed{inPersonal ? ', removed from Favourite' : ''}{' '}
                                        or deleted.
                                    </p>
                                    <ButtonRow>
                                        <Button
                                            variant="primary"
                                            data-testid="folder-empty-new-line"
                                            onClick={() => navigate(newLinePath(folder, set))}
                                        >
                                            New line here
                                        </Button>
                                        <Button
                                            data-testid="folder-empty-root"
                                            onClick={() => openFolder('')}
                                        >
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
                        {pendingDelete.name.trim().length === 0
                            ? 'Untitled line'
                            : pendingDelete.name}
                    </strong>{' '}
                    ({lineSizeLabel(pendingDelete.tree)}) will be removed
                    {personal.has(pendingDelete.id) ? ' — from Favourite too' : ''}.{' '}
                    {isServerLine(pendingDelete)
                        ? 'It is a bundled line, so it only comes back after "Refresh data".'
                        : 'This cannot be undone — export first if you want a copy.'}
                </ConfirmDialog>
            )}

            {pendingFolderRemoval !== null && (
                <ConfirmDialog
                    title="Remove folder from Favourite?"
                    confirmLabel="Remove"
                    onCancel={() => setPendingFolderRemoval(null)}
                    onConfirm={confirmFolderRemoval}
                >
                    <span data-testid="folder-removal-count">
                        {lineCountLabel(pendingFolderRemoval.ids.length)}
                    </span>{' '}
                    in <strong>{folderName(pendingFolderRemoval.path)}</strong>, subfolders included,{' '}
                    {pendingFolderRemoval.ids.length === 1 ? 'leaves' : 'leave'} your Favourite list.
                    The lines themselves stay in Openings.
                </ConfirmDialog>
            )}

            {pendingRefresh !== null && (
                <RefreshDialog
                    summary={pendingRefresh}
                    onCancel={() => setPendingRefresh(null)}
                    onRefresh={confirmRefresh}
                />
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
                            {lineCountLabel(scope.length)} will move with it, subfolders included.
                            Nothing else about them changes.
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
     * Opens "Remove folder from Personal?" for every line of `folderLines` that is personal. A
     * dialog even in Database: one press can unpick a whole repertoire.
     */
    function askFolderRemoval(path: string, folderLines: readonly Line[]) {
        const ids = folderLines.filter((line) => personal.has(line.id)).map((line) => line.id);
        if (ids.length > 0) setPendingFolderRemoval({ path, ids });
    }

    /** One subfolder card. A plain function for the same reason as `renderRow`. */
    function renderFolderCard(node: ReturnType<typeof childFolders>[number]) {
        const folderLines = linesUnderFolder(lines, node.path);
        const status = folderPersonalStatus(folderLines, personal);
        return (
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
                <FolderActions>
                    <LinkButton
                        to={drillPath(node.path, set, trainedFor)}
                        $size="sm"
                        data-testid="folder-drill"
                        aria-label={`Drill ${node.name}`}
                    >
                        Drill
                    </LinkButton>
                    <LinkButton
                        to={explorePath(node.path, set)}
                        $size="sm"
                        data-testid="folder-explore"
                        aria-label={`Explore ${node.name}`}
                    >
                        Explore
                    </LinkButton>
                    {/* Filled once every line below is a favourite; pressing it then asks before
              unstarring the whole folder. A partly starred folder stays hollow and stars the rest. */}
                    <StarButton
                        type="button"
                        $on={status === 'all'}
                        aria-pressed={status === 'all'}
                        data-testid="folder-personal"
                        data-status={status}
                        aria-label={`${favouriteToggleLabel(status === 'all')}: ${node.name}`}
                        title={favouriteToggleLabel(status === 'all')}
                        onClick={() =>
                            status === 'all'
                                ? askFolderRemoval(node.path, folderLines)
                                : changePersonal(
                                      folderLines.map((line) => line.id),
                                      true,
                                  )
                        }
                    >
                        {status === 'all' ? '★' : '☆'}
                    </StarButton>
                </FolderActions>
            </FolderCard>
        );
    }

    /**
     * One line row. Declared inside the component because it needs the handlers; it stays a plain
     * function (not a nested component) so React never sees a new component type per render.
     */
    function renderRow(line: Line) {
        const path = lineFolder(line);
        const picked = personal.has(line.id);
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
                    {!isServerLine(line) && (
                        <CustomBadge
                            data-testid="line-custom"
                            title="Your own line — created, imported or edited by you"
                        >
                            Custom
                        </CustomBadge>
                    )}
                    <ColorBadge $white={line.userColor === 'w'} data-testid="line-color">
                        as {colorLabel(line.userColor)}
                    </ColorBadge>
                    {/* In Favourite every row is starred, so there it only ever unstars (from
            Favourite, not the database). */}
                    <StarButton
                        type="button"
                        $on={picked}
                        aria-pressed={picked}
                        data-testid="line-personal"
                        aria-label={favouriteToggleLabel(picked)}
                        title={
                            inPersonal
                                ? 'Remove from favourites — the line stays in Openings'
                                : favouriteToggleLabel(picked)
                        }
                        onClick={() => changePersonal([line.id], !picked)}
                    >
                        {picked ? '★' : '☆'}
                    </StarButton>
                </RowHead>

                <Meta>
                    <span data-testid="line-moves">{lineSizeLabel(line.tree)}</span>
                    <MetaSep>·</MetaSep>
                    <span data-testid="line-updated">
                        updated {formatTimestamp(line.updatedAt)}
                    </span>
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
                        to={drillLinePath(line.id, folder, set)}
                        $variant="primary"
                        $size="sm"
                        data-testid="line-drill"
                    >
                        Drill
                    </LinkButton>
                    <Button
                        size="sm"
                        data-testid="line-explore"
                        onClick={() => openInExplore(line)}
                    >
                        Explore
                    </Button>
                    {/* Always the database line: Personal holds ids, and an edited bundled line
            stays personal under its new id (`storage/lines.ts`). */}
                    <LinkButton
                        to={editLinePath(line.id, folder, set)}
                        $size="sm"
                        data-testid="line-edit"
                    >
                        Edit
                    </LinkButton>
                    <Button
                        size="sm"
                        data-testid="line-analyze"
                        onClick={() => openInAnalyze(line)}
                    >
                        Analyze
                    </Button>
                    {/* Deleting is a database operation; Favourite only ever unstars. */}
                    {!inPersonal && (
                        <Button
                            variant="danger"
                            size="sm"
                            data-testid="line-delete"
                            onClick={() => setPendingDelete(line)}
                        >
                            Delete
                        </Button>
                    )}
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

const SetTabs = styled.div`
    display: flex;
    align-self: flex-start;
    padding: 2px;
    background: ${(p) => p.theme.color.surfaceAlt};
    border: 1px solid ${(p) => p.theme.color.border};
    border-radius: ${(p) => p.theme.radius.md};
`;

const SetTab = styled.button<{ $active: boolean }>`
    min-height: 44px;
    padding: 0 ${(p) => p.theme.space.md};
    border: 0;
    border-radius: ${(p) => p.theme.radius.sm};
    background: ${(p) => (p.$active ? p.theme.color.accent : 'none')};
    color: ${(p) => (p.$active ? p.theme.color.accentText : p.theme.color.textMuted)};
    font-family: inherit;
    font-size: ${(p) => p.theme.font.size.md};
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    @media ${(p) => p.theme.media.wide} {
        min-height: 36px;
    }

    &:focus-visible {
        outline: 2px solid ${(p) => p.theme.color.focus};
        outline-offset: 2px;
    }
`;

const TabStar = styled.span`
    color: ${(p) => p.theme.color.star};
`;

/** The favourite toggle on line rows and folder cards: ★ when starred, ☆ when not. */
const StarButton = styled.button<{ $on: boolean }>`
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    border: 0;
    border-radius: ${(p) => p.theme.radius.sm};
    background: none;
    color: ${(p) => (p.$on ? p.theme.color.star : p.theme.color.textFaint)};
    font-family: inherit;
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    @media ${(p) => p.theme.media.wide} {
        min-width: 32px;
        min-height: 32px;
    }

    &:hover {
        color: ${(p) => p.theme.color.star};
    }

    &:focus-visible {
        outline: 2px solid ${(p) => p.theme.color.focus};
        outline-offset: 2px;
    }
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

/** Takes what the panel title leaves, so the buttons know how much room they have. */
const FileActions = styled.div`
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: flex-end;
    gap: ${(p) => p.theme.space.xs};
    min-width: 0;
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
    flex-wrap: wrap;
    align-items: center;
    gap: ${(p) => p.theme.space.sm};
    min-width: 0;
    padding: ${(p) => p.theme.space.xs} ${(p) => p.theme.space.md};
    background: ${(p) => p.theme.color.surfaceAlt};
    border: 1px solid ${(p) => p.theme.color.border};
    border-radius: ${(p) => p.theme.radius.md};
`;

/** Wraps under the folder name on a narrow screen rather than squeezing it. */
const FolderActions = styled.div`
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: ${(p) => p.theme.space.xs};
    min-width: 0;
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

const FilterRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${(p) => p.theme.space.xs};
`;

const CustomBadge = styled.span`
    flex: 0 0 auto;
    padding: 2px ${(p) => p.theme.space.sm};
    border-radius: 999px;
    border: 1px solid ${(p) => p.theme.color.accent};
    color: ${(p) => p.theme.color.accent};
    font-size: ${(p) => p.theme.font.size.sm};
    font-weight: 600;
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
