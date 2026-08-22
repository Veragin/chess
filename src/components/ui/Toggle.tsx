import styled from 'styled-components';

const Wrapper = styled.button`
  display: inline-flex;
  align-items: center;
  gap: ${(p) => p.theme.space.sm};
  min-height: 44px;
  padding: 0 ${(p) => p.theme.space.sm};
  background: none;
  border: none;
  border-radius: ${(p) => p.theme.radius.md};
  color: ${(p) => p.theme.color.text};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.md};
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;

  @media ${(p) => p.theme.media.wide} {
    min-height: 36px;
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.color.focus};
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const Track = styled.span<{ $on: boolean }>`
  position: relative;
  flex: none;
  width: 38px;
  height: 22px;
  border-radius: 11px;
  background: ${(p) => (p.$on ? p.theme.color.accent : p.theme.color.border)};
  transition: background 140ms ease;
`;

const Knob = styled.span<{ $on: boolean }>`
  position: absolute;
  top: 3px;
  left: ${(p) => (p.$on ? '19px' : '3px')};
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: ${(p) => (p.$on ? p.theme.color.accentText : p.theme.color.textMuted)};
  transition: left 140ms ease;
`;

const Label = styled.span`
  white-space: nowrap;
`;

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Labelled on/off switch. `role="switch"` so screen readers announce the state. */
export function Toggle({ checked, onChange, label, disabled = false, className }: ToggleProps) {
  return (
    <Wrapper
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={className}
      onClick={() => onChange(!checked)}
    >
      <Track $on={checked} aria-hidden="true">
        <Knob $on={checked} />
      </Track>
      <Label>{label}</Label>
    </Wrapper>
  );
}
