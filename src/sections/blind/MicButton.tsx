import type { PointerEvent as ReactPointerEvent } from 'react';
import styled from 'styled-components';

/**
 * The push-to-talk target: recognition starts on **pointer-down** and stops on pointer-up
 * (README §7 Phase 8, §8.8). Both callbacks are invoked straight from the handler, with no
 * intervening `await` or timer, because iOS only grants the microphone to a live user gesture —
 * a programmatic restart is refused silently.
 *
 * Pointer Events only (README §8.6): one code path for touch, pen and mouse, `touch-action:
 * none` so a press-and-hold never turns into a page scroll, and pointer capture so lifting the
 * finger outside the circle still stops recognition.
 */

const Button = styled.button<{ $listening: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${(p) => p.theme.space.xs};
  width: 100%;
  min-height: 96px;
  padding: ${(p) => p.theme.space.md};
  border-radius: ${(p) => p.theme.radius.lg};
  border: 2px solid
    ${(p) => (p.$listening ? p.theme.color.good : p.theme.color.accent)};
  background: ${(p) => (p.$listening ? p.theme.color.good : p.theme.color.accent)};
  color: ${(p) => p.theme.color.accentText};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.lg};
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    transform 80ms ease;

  ${(p) => (p.$listening ? 'transform: scale(0.98);' : '')}

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 3px;
  }

  &:disabled {
    background: ${(p) => p.theme.color.surfaceAlt};
    border-color: ${(p) => p.theme.color.border};
    color: ${(p) => p.theme.color.textFaint};
    cursor: not-allowed;
    transform: none;
  }
`;

const Glyph = styled.span`
  font-size: 1.6rem;
  line-height: 1;
`;

const Hint = styled.span`
  font-size: ${(p) => p.theme.font.size.sm};
  font-weight: 600;
  opacity: 0.85;
`;

export interface MicButtonProps {
  listening: boolean;
  disabled?: boolean;
  /** Called synchronously on pointer-down — this is the user gesture. */
  onPressStart: () => void;
  /** Called on pointer-up / pointer-cancel. */
  onPressEnd: () => void;
}

export function MicButton({
  listening,
  disabled = false,
  onPressStart,
  onPressEnd,
}: MicButtonProps) {
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (disabled || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Capture so the release is still delivered if the finger drifts off the button.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Best effort; a plain press still works without capture. */
    }
    onPressStart();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!event.isPrimary) return;
    onPressEnd();
  };

  return (
    <Button
      type="button"
      $listening={listening}
      disabled={disabled}
      aria-pressed={listening}
      data-listening={listening ? 'true' : 'false'}
      data-testid="mic-button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Glyph aria-hidden="true">{listening ? '🎙️' : '🎤'}</Glyph>
      {listening ? 'Listening…' : 'Hold to speak'}
      <Hint>{listening ? 'Release when you have said the move' : 'Press and hold, say the move'}</Hint>
    </Button>
  );
}
