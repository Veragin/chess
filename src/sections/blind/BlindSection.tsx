import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Board } from '../../components/Board';
import { Button, Panel, RotateButton, Row, Stack, Toggle } from '../../components/ui';
import { flipOrientation, type Orientation } from '../../chess/position';
import {
  createRecognizer,
  isSpeechRecognitionSupported,
  type Recognizer,
} from '../../speech/recognizer';
import { cancelSpeech, speak } from '../../speech/speak';
import {
  blindStorageWarning,
  clearBlindGame,
  loadBlindGame,
  saveBlindGame,
  type BlindGameRecord,
} from '../../storage/blindGame';
import { MicButton } from './MicButton';
import { TypedMoveEntry } from './TypedMoveEntry';
import { useWakeLock } from './useWakeLock';
import {
  applySpoken,
  clearFeedback,
  describePlyCount,
  hasProgress,
  moveNumberText,
  newSession,
  resultText,
  sessionFromRecord,
  setRevealed,
  toRecord,
  turnText,
  undoLast,
  withFeedback,
  type BlindSession,
  type FeedbackKind,
} from './session';

/**
 * Blind chess (README §7 Phase 8): two players sharing one phone, playing a real game with the
 * pieces hidden and the moves spoken aloud.
 *
 * The four things this section is really about, and where each lives:
 *
 *  - **All game logic is in `session.ts`** — pure, unit-tested, and the only place a move can be
 *    applied. In particular a misheard or illegal phrase provably cannot move a piece, and
 *    revealing the pieces provably cannot change the position (README §9, Phase 8).
 *  - **Push-to-talk** starts on pointer-down and stops on pointer-up, synchronously, because
 *    iOS only grants the mic to a live gesture (README §8.8). Recognition is never restarted
 *    programmatically.
 *  - **The echo is spoken before the move is applied** ("knight f3"), which is why
 *    `applySpoken` hands the utterance back instead of speaking it itself.
 *  - **Durable state and an explicit resume** (README §2.3–2.4): every move is persisted, and
 *    coming back from the background stops recognition and asks for a tap rather than
 *    pretending the mic was still open.
 *
 * What it deliberately does not show: the move list. Two players reading the SAN off the screen
 * are not playing blind — the spoken echo of the last move is the only confirmation offered.
 */

const Wrap = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.md};
  min-width: 0;
`;

const Heading = styled.h1`
  font-size: ${(p) => p.theme.font.size.xl};
  line-height: 1.2;
`;

const Columns = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: ${(p) => p.theme.space.md};
  min-width: 0;

  @media ${(p) => p.theme.media.wide} {
    grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
    align-items: start;
  }
`;

const BoardColumn = styled(Stack)`
  min-width: 0;
  /* The board is square; cap it on a wide screen so it does not dwarf the controls. */
  max-width: 100%;

  @media ${(p) => p.theme.media.wide} {
    max-width: min(100%, 70vh);
  }
`;

const TurnLine = styled.p<{ $over: boolean }>`
  font-size: ${(p) => p.theme.font.size.lg};
  font-weight: 700;
  color: ${(p) => (p.$over ? p.theme.color.warn : p.theme.color.text)};
`;

const Muted = styled.p`
  color: ${(p) => p.theme.color.textMuted};
  font-size: ${(p) => p.theme.font.size.sm};
  line-height: 1.45;
`;

const FEEDBACK_COLOR: Record<FeedbackKind, 'text' | 'good' | 'warn' | 'danger' | 'textMuted'> = {
  idle: 'textMuted',
  move: 'good',
  ambiguous: 'warn',
  unrecognised: 'warn',
  error: 'danger',
  info: 'textMuted',
};

const FeedbackLine = styled.p<{ $kind: FeedbackKind }>`
  min-height: 1.4em;
  font-size: ${(p) => p.theme.font.size.md};
  font-weight: 600;
  line-height: 1.4;
  color: ${(p) => p.theme.color[FEEDBACK_COLOR[p.$kind]]};
  overflow-wrap: anywhere;
`;

const Candidates = styled.p`
  font-family: ${(p) => p.theme.font.mono};
  font-size: ${(p) => p.theme.font.size.sm};
  color: ${(p) => p.theme.color.textMuted};
  overflow-wrap: anywhere;
`;

const Notice = styled.div<{ $tone: 'accent' | 'warn' }>`
  display: flex;
  flex-direction: column;
  gap: ${(p) => p.theme.space.sm};
  padding: ${(p) => p.theme.space.md};
  border: 1px solid ${(p) => (p.$tone === 'warn' ? p.theme.color.warn : p.theme.color.accent)};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => p.theme.color.surfaceAlt};
  font-size: ${(p) => p.theme.font.size.md};
  line-height: 1.45;
  min-width: 0;
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid ${(p) => p.theme.color.border};
`;

const RevealToggle = styled(Toggle)`
  font-weight: 600;
`;

export function BlindSection() {
  /**
   * The saved game is read once, in a state initialiser rather than an effect: a read never
   * writes (`storage/blindGame.ts` guarantees that), so this is safe to do during
   * initialisation and means the resume prompt is on screen in the very first paint.
   * A corrupt record reads as `null` plus a warning — "no resume available", never a crash.
   */
  const [savedGame] = useState<BlindGameRecord | null>(() => loadBlindGame());
  const [session, setSession] = useState<BlindSession>(() => newSession());
  const [orientation, setOrientation] = useState<Orientation>('white');

  /** A validated saved game waiting for an explicit Resume/Discard decision. */
  const [resumeOffer, setResumeOffer] = useState<BlindGameRecord | null>(() =>
    savedGame !== null && savedGame.moves.length > 0 ? savedGame : null,
  );
  /** Set when the page was backgrounded: the UI asks for a tap before listening again. */
  const [needsTap, setNeedsTap] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  /**
   * `isSpeechRecognitionSupported()` decides the first paint; `createRecognizer` can still
   * come back `null` (constructor threw), which `startListening` handles by falling back to
   * typing rather than leaving a dead button.
   */
  const [micSupported, setMicSupported] = useState<boolean>(() => isSpeechRecognitionSupported());
  const [listening, setListening] = useState(false);
  const [typedOpen, setTypedOpen] = useState(false);
  const [storageNote, setStorageNote] = useState<string | null>(() => blindStorageWarning());

  const recognizerRef = useRef<Recognizer | null>(null);
  /**
   * Mirror of `session`, kept in step by `commit` (the single writer). Handlers driven by the
   * speech API fire outside React's event flow, and this is what lets them read the current
   * position without going through a state updater — the echo has to be spoken *before* the
   * new state is committed, which a pure updater function could not do.
   */
  const sessionRef = useRef(session);

  const result = useMemo(() => resultText(session), [session]);
  const gameOver = result !== null;
  /** Nothing may be played while a decision is pending, after a background, or once over. */
  const inputBlocked = resumeOffer !== null || needsTap || gameOver;

  // Wake lock for the duration of the game (README §2.1); re-acquisition on visibilitychange
  // lives inside the hook.
  const wakeLock = useWakeLock(resumeOffer === null && !gameOver);

  // ------------------------------------------------------------------------------- persist
  /**
   * Writes the record on **every** state change that matters (README §2.3), so backgrounding,
   * returning, or an outright reload resumes the exact position. Persisting here rather than in
   * an effect keeps it tied to the action that caused it — and keeps the resume prompt from
   * ever overwriting the game it is offering.
   */
  const commit = useCallback((next: BlindSession) => {
    sessionRef.current = next;
    setSession(next);
    if (next.moves.length === 0) clearBlindGame();
    else saveBlindGame(toRecord(next));
    setStorageNote(blindStorageWarning());
  }, []);

  // ---------------------------------------------------------------------------- recognition
  /**
   * Resolves a transcript (or typed text) and applies it. The echo is spoken *before* the new
   * session is committed, which is the ordering the spec asks for.
   */
  const submitAlternatives = useCallback(
    (alternatives: string[]) => {
      if (inputBlocked) return;
      const outcome = applySpoken(sessionRef.current, alternatives);
      speak(outcome.utterance);
      commit(outcome.session);
    },
    [commit, inputBlocked],
  );

  /**
   * The recogniser is created once and keeps the callbacks it was given, so the latest
   * `submitAlternatives` is reached through a ref that an effect keeps up to date.
   */
  const submitRef = useRef(submitAlternatives);
  useEffect(() => {
    submitRef.current = submitAlternatives;
  }, [submitAlternatives]);

  useEffect(() => {
    const recognizer = createRecognizer({
      onResult: (alternatives) => submitRef.current(alternatives),
      onError: (message) => {
        setListening(false);
        // Whatever went wrong (blocked mic, no network, nothing heard), typing always works.
        setTypedOpen(true);
        commit(withFeedback(sessionRef.current, { kind: 'error', message }));
      },
      onStateChange: setListening,
    });
    recognizerRef.current = recognizer;

    return () => {
      recognizer?.dispose();
      recognizerRef.current = null;
    };
    // `commit` is stable, so this still runs exactly once.
  }, [commit]);

  // ------------------------------------------------------------------ foreground / resume UX
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') return;
      // Recognition is dead the moment the page is hidden; stop it explicitly and require a
      // tap on the way back rather than pretending it was still listening (README §2.4).
      recognizerRef.current?.stop();
      cancelSpeech();
      setListening(false);
      setNeedsTap(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // -------------------------------------------------------------------------------- actions
  const startListening = useCallback(() => {
    if (inputBlocked) return;
    const recognizer = recognizerRef.current;
    if (recognizer === null) {
      // The API exists but the object could not be constructed. Never leave a dead button.
      setMicSupported(false);
      setTypedOpen(true);
      return;
    }
    // Synchronous, straight from the pointer-down handler: this is the user gesture (§8.8).
    recognizer.start();
    cancelSpeech();
    commit(clearFeedback(sessionRef.current));
  }, [commit, inputBlocked]);

  const stopListening = useCallback(() => {
    recognizerRef.current?.stop();
  }, []);

  const startNewGame = useCallback(() => {
    recognizerRef.current?.stop();
    cancelSpeech();
    setResumeOffer(null);
    setNeedsTap(false);
    setConfirmNew(false);
    // A fresh game has no moves, so `commit` clears the saved record for us.
    commit(newSession());
  }, [commit]);

  const resumeSaved = useCallback(() => {
    if (resumeOffer === null) return;
    // Belt and braces: the record was validated before it was offered.
    const restored = sessionFromRecord(resumeOffer) ?? newSession();
    setResumeOffer(null);
    setNeedsTap(false);
    setConfirmNew(false);
    commit(restored);
  }, [commit, resumeOffer]);

  const requestNewGame = useCallback(() => {
    if (hasProgress(sessionRef.current)) setConfirmNew(true);
    else startNewGame();
  }, [startNewGame]);

  const takeBack = useCallback(() => {
    recognizerRef.current?.stop();
    cancelSpeech();
    commit(undoLast(sessionRef.current));
  }, [commit]);

  const toggleReveal = useCallback(
    (next: boolean) => {
      // Presentation only, by construction: `setRevealed` copies the position through
      // untouched, and the reveal flag is the only thing the write below changes.
      commit(setRevealed(sessionRef.current, next));
    },
    [commit],
  );

  const continueAfterBackground = useCallback(() => {
    setNeedsTap(false);
    commit(clearFeedback(sessionRef.current));
  }, [commit]);

  // --------------------------------------------------------------------------------- render
  const plies = session.moves.length;
  const showMic = micSupported && !typedOpen;

  return (
    <Wrap>
      <Heading>Blind chess</Heading>

      {storageNote !== null && (
        <Notice $tone="warn" role="status" data-testid="storage-note">
          {storageNote}
        </Notice>
      )}

      <Columns>
        <BoardColumn $gap="sm">
          {/* Empty by default: squares and coordinates only. `hidePieces` is presentation
              only — the Board guarantees it and nothing here shadows that. Read-only too:
              moves arrive by voice or by typing, never by touching the board. */}
          <Board
            fen={session.fen}
            orientation={orientation}
            hidePieces={!session.revealed}
            showCoordinates
          />
          <Row $gap="sm" $justify="space-between" $wrap>
            <RevealToggle
              checked={session.revealed}
              onChange={toggleReveal}
              label={session.revealed ? 'Pieces shown' : 'Reveal pieces'}
            />
            <RotateButton
              orientation={orientation}
              onClick={() => setOrientation((current) => flipOrientation(current))}
            />
          </Row>
        </BoardColumn>

        <Stack $gap="md">
          <Panel title="Position">
            <Stack $gap="xs">
              <TurnLine $over={gameOver} data-testid="turn-indicator">
                {turnText(session)}
              </TurnLine>
              <Muted data-testid="move-count">
                {moveNumberText(session)} · {describePlyCount(plies)} played
              </Muted>
            </Stack>
          </Panel>

          {resumeOffer !== null && (
            <Notice $tone="accent" data-testid="resume-offer">
              <strong>Game in progress</strong>
              <span>
                A saved blind game with {describePlyCount(resumeOffer.moves.length)} was found.
              </span>
              <Row $gap="sm" $wrap>
                <Button variant="primary" onClick={resumeSaved} data-testid="resume-button">
                  Resume game
                </Button>
                <Button variant="danger" onClick={startNewGame} data-testid="discard-button">
                  Discard, start new
                </Button>
              </Row>
            </Notice>
          )}

          {resumeOffer === null && needsTap && (
            <Notice $tone="accent" data-testid="continue-banner">
              <strong>Tap to continue</strong>
              <span>
                Listening stopped while the app was in the background. Nothing was lost — the
                position is exactly where you left it.
              </span>
              <Button
                variant="primary"
                onClick={continueAfterBackground}
                data-testid="continue-button"
              >
                Tap to continue
              </Button>
            </Notice>
          )}

          {gameOver && (
            <Notice $tone="warn" data-testid="game-over">
              <strong>{result}</strong>
              <Row $gap="sm" $wrap>
                <Button variant="primary" onClick={startNewGame}>
                  New game
                </Button>
              </Row>
            </Notice>
          )}

          <Panel title="Spoken move">
            <Stack $gap="sm">
              <FeedbackLine
                $kind={session.feedback.kind}
                role="status"
                aria-live="polite"
                data-testid="feedback"
                data-kind={session.feedback.kind}
              >
                {session.feedback.message}
              </FeedbackLine>
              {session.feedback.candidates !== undefined && (
                <Candidates data-testid="candidates">
                  Did you mean: {session.feedback.candidates.join(', ')}?
                </Candidates>
              )}

              {showMic ? (
                <MicButton
                  listening={listening}
                  disabled={inputBlocked}
                  onPressStart={startListening}
                  onPressEnd={stopListening}
                />
              ) : (
                <TypedMoveEntry
                  onSubmitMove={(text) => submitAlternatives([text])}
                  disabled={inputBlocked}
                />
              )}

              {micSupported ? (
                <Button
                  size="sm"
                  onClick={() => setTypedOpen((open) => !open)}
                  data-testid="toggle-typed"
                >
                  {typedOpen ? 'Use the microphone' : 'Type a move instead'}
                </Button>
              ) : (
                <Muted data-testid="no-speech-note">
                  This browser has no speech recognition (Firefox does not implement it), so
                  moves are typed. They go through exactly the same move parser.
                </Muted>
              )}

              <Divider />
              {/* README §2: state the limitation plainly and do not imply a capability that
                  does not exist. Nothing here suggests background listening. */}
              <Muted data-testid="foreground-note">
                Keep this app open and in the foreground while listening — a browser cannot hear
                you once the page is in the background or the phone is locked.
                {wakeLock.supported
                  ? ' The screen is kept awake while a game is on.'
                  : ' This browser cannot keep the screen awake, so it may dim between moves.'}
              </Muted>
            </Stack>
          </Panel>

          <Panel title="Game">
            <Stack $gap="sm">
              {confirmNew ? (
                <Notice $tone="warn" data-testid="confirm-new">
                  <strong>Discard the game in progress?</strong>
                  <span>{describePlyCount(plies)} will be lost.</span>
                  <Row $gap="sm" $wrap>
                    <Button variant="danger" onClick={startNewGame} data-testid="confirm-new-yes">
                      Discard and start over
                    </Button>
                    <Button onClick={() => setConfirmNew(false)}>Keep playing</Button>
                  </Row>
                </Notice>
              ) : (
                <Row $gap="sm" $wrap>
                  <Button onClick={requestNewGame} data-testid="new-game">
                    New game
                  </Button>
                  <Button onClick={takeBack} disabled={plies === 0} data-testid="undo">
                    Take back a move
                  </Button>
                </Row>
              )}
              <Muted>
                Take back a move when a legal move was heard wrongly, then say the move again.
              </Muted>
            </Stack>
          </Panel>
        </Stack>
      </Columns>
    </Wrap>
  );
}
