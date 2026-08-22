import { useState, type FormEvent } from 'react';
import styled from 'styled-components';
import { Button } from '../../components/ui';

/**
 * Typed-move fallback (README §8.7). Two reasons it exists, and both matter:
 *
 *  - Firefox has no `SpeechRecognition` at all, so `createRecognizer` returns `null`.
 *  - A phone that supports it can still have the microphone permission denied.
 *
 * So it is reachable even when speech works. What it must NOT be is a second, more permissive
 * way in: the text is handed to the very same `resolveSpokenMove` pipeline as a transcript, so
 * "knight f3", "Nf3" and a typo all behave exactly as they would if spoken.
 */

const Form = styled.form`
  display: flex;
  gap: ${(p) => p.theme.space.sm};
  align-items: stretch;
`;

const Input = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 44px;
  padding: 0 ${(p) => p.theme.space.md};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  background: ${(p) => p.theme.color.bg};
  color: ${(p) => p.theme.color.text};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.md};

  &::placeholder {
    color: ${(p) => p.theme.color.textFaint};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.5;
  }
`;

export interface TypedMoveEntryProps {
  /** Receives the raw text, to be resolved exactly like a spoken transcript. */
  onSubmitMove: (text: string) => void;
  disabled?: boolean;
}

export function TypedMoveEntry({ onSubmitMove, disabled = false }: TypedMoveEntryProps) {
  const [text, setText] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = text.trim();
    if (disabled || trimmed.length === 0) return;
    // Clear either way: a rejected move leaves the position alone, and a stale string in the
    // box invites a second accidental submit.
    setText('');
    onSubmitMove(trimmed);
  };

  return (
    <Form onSubmit={submit}>
      <Input
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label="Type a move"
        placeholder="e4, Nf3, castles short…"
        value={text}
        disabled={disabled}
        data-testid="typed-move-input"
        onChange={(event) => setText(event.target.value)}
      />
      <Button type="submit" variant="primary" disabled={disabled || text.trim().length === 0}>
        Play
      </Button>
    </Form>
  );
}
