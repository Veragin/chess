import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import styled from 'styled-components';
import { Button } from '../../../components/ui';

/** One action of the group: a button inline, a menu item once collapsed. */
export interface OverflowAction {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  testId?: string;
}

interface OverflowActionsProps {
  actions: readonly OverflowAction[];
  /** Accessible name of the ⋮ button. */
  menuLabel?: string;
}

/**
 * A row of small buttons that folds into a ⋮ (kebab) menu when it does not fit on one line.
 *
 * Collapsing is all or nothing, so an action never moves between the row and the menu as the
 * width changes. The row's natural width is measured while it is shown (in a layout effect, so a
 * row that does not fit is never painted); once collapsed, that remembered width is what the
 * available space is compared with to bring the row back. A change of labels resets the
 * measurement, since the row's width changes with them. The buttons themselves are watched too,
 * so a row that grows in place (a web font arriving late) still folds instead of being clipped.
 */
export function OverflowActions({ actions, menuLabel = 'More actions' }: OverflowActionsProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const naturalWidth = useRef(0);
  const signature = actions.map((action) => action.label).join('\u0000');
  /**
   * The labels the row was collapsed for. New labels, new width: the row is shown again and
   * re-measured before the next paint.
   */
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  const collapsed = collapsedFor === signature;
  const setCollapsed = useCallback(
    (on: boolean) => setCollapsedFor(on ? signature : null),
    [signature],
  );

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const row = rowRef.current;
    if (collapsed || outer === null || row === null) return;
    naturalWidth.current = row.scrollWidth;
    if (naturalWidth.current > outer.clientWidth) setCollapsed(true);
  }, [collapsed, setCollapsed]);

  useEffect(() => {
    const outer = outerRef.current;
    if (outer === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const row = rowRef.current;
      if (row !== null) naturalWidth.current = row.scrollWidth;
      setCollapsed(naturalWidth.current > outer.clientWidth);
    });
    observer.observe(outer);
    const row = rowRef.current;
    if (row !== null) for (const button of Array.from(row.children)) observer.observe(button);
    return () => observer.disconnect();
  }, [collapsed, setCollapsed]);

  return (
    <Outer ref={outerRef} $collapsed={collapsed}>
      {collapsed ? (
        <KebabMenu actions={actions} label={menuLabel} />
      ) : (
        <InlineRow ref={rowRef}>
          {actions.map((action) => (
            <Button
              key={action.key}
              size="sm"
              data-testid={action.testId}
              disabled={action.disabled}
              title={action.title}
              onClick={action.onSelect}
            >
              {action.label}
            </Button>
          ))}
        </InlineRow>
      )}
    </Outer>
  );
}

function KebabMenu({ actions, label }: { actions: readonly OverflowAction[]; label: string }) {
  /** Where the open menu is pinned (viewport coordinates), or null while closed. */
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const open = anchor !== null;
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus: boolean) => {
    setAnchor(null);
    if (refocus) toggleRef.current?.focus();
  }, []);

  /**
   * The menu is `position: fixed` because panels clip their content (`overflow: hidden`), so it
   * is pinned under the ⋮ button when opened and simply closes if the page scrolls or resizes.
   */
  const openMenu = () => {
    const rect = toggleRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setAnchor({ top: rect.bottom + 4, right: document.documentElement.clientWidth - rect.right });
  };

  // A press anywhere outside closes the menu, as does Escape (handled on the menu itself).
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    };
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  // Focus moves into the menu without scrolling the page, which would close it again. With every
  // item disabled the menu itself takes focus, so Escape still reaches it.
  useEffect(() => {
    if (open) focusQuietly(menuItems(menuRef.current)[0] ?? menuRef.current);
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      focusQuietly(items[(index + step + items.length) % items.length]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusQuietly(items[event.key === 'Home' ? 0 : items.length - 1]);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div ref={wrapRef}>
      <Button
        ref={toggleRef}
        size="sm"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="actions-menu"
        onClick={() => (open ? close(false) : openMenu())}
      >
        <Kebab aria-hidden="true">⋮</Kebab>
      </Button>
      {anchor !== null && (
        <Menu
          ref={menuRef}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          style={{ top: anchor.top, right: anchor.right }}
          onKeyDown={onMenuKeyDown}
        >
          {actions.map((action) => (
            <MenuItem
              key={action.key}
              type="button"
              role="menuitem"
              data-testid={action.testId}
              disabled={action.disabled}
              title={action.title}
              onClick={() => {
                close(true);
                action.onSelect();
              }}
            >
              {action.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}

function focusQuietly(element: HTMLElement | null | undefined) {
  element?.focus({ preventScroll: true });
}

function menuItems(menu: HTMLElement | null): HTMLButtonElement[] {
  if (menu === null) return [];
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
}

/**
 * Takes the space the header leaves, so its width is what the row has to fit in. Once collapsed it
 * keeps room for the ⋮ button.
 */
const Outer = styled.div<{ $collapsed: boolean }>`
  display: flex;
  flex: 1 1 0;
  justify-content: flex-end;
  min-width: ${(p) => (p.$collapsed ? 'auto' : '0')};
`;

const InlineRow = styled.div`
  display: flex;
  flex-wrap: nowrap;
  gap: ${(p) => p.theme.space.xs};
  min-width: 0;
  overflow: hidden;

  & > * {
    flex: 0 0 auto;
    white-space: nowrap;
  }
`;

const Kebab = styled.span`
  font-size: 1.2rem;
  line-height: 1;
`;

const Menu = styled.div`
  position: fixed;
  z-index: ${(p) => p.theme.z.nav + 1};
  display: flex;
  flex-direction: column;
  min-width: 180px;
  padding: ${(p) => p.theme.space.xs};
  background: ${(p) => p.theme.color.surface};
  border: 1px solid ${(p) => p.theme.color.border};
  border-radius: ${(p) => p.theme.radius.md};
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);

  &:focus {
    outline: none;
  }
`;

const MenuItem = styled.button`
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 0 ${(p) => p.theme.space.md};
  background: none;
  color: ${(p) => p.theme.color.text};
  border: 0;
  border-radius: ${(p) => p.theme.radius.sm};
  font-family: inherit;
  font-size: ${(p) => p.theme.font.size.sm};
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;

  @media ${(p) => p.theme.media.wide} {
    min-height: 34px;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    background: ${(p) => p.theme.color.surfaceAlt};
    outline: none;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;
