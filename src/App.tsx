import { HashRouter, Navigate, NavLink, Route, Routes } from 'react-router';
import styled from 'styled-components';
import { AnalyzeSection } from './sections/analyze/AnalyzeSection';
import { TrainingSection } from './sections/training/TrainingSection';
import { BlindSection } from './sections/blind/BlindSection';

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 100dvh;
  min-width: 0;
`;

const Header = styled.header`
  position: sticky;
  top: 0;
  z-index: ${({ theme }) => theme.z.nav};
  background: ${({ theme }) => theme.color.surface};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  padding-top: env(safe-area-inset-top);
`;

const HeaderInner = styled.div`
  width: 100%;
  max-width: ${({ theme }) => theme.layout.maxWidth};
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.md};
  padding: 0 ${({ theme }) => theme.space.md};
  min-height: ${({ theme }) => theme.layout.navHeight};

  @media ${({ theme }) => theme.media.narrow} {
    /* Stack the brand above the nav so both stay tappable on a narrow phone. */
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.sm} 0;
  }
`;

const Brand = styled.span`
  font-weight: 700;
  letter-spacing: 0.02em;
  font-size: ${({ theme }) => theme.font.size.lg};
  white-space: nowrap;

  @media ${({ theme }) => theme.media.narrow} {
    font-size: ${({ theme }) => theme.font.size.md};
    padding: 0 ${({ theme }) => theme.space.xs};
  }
`;

const Nav = styled.nav`
  display: flex;
  gap: ${({ theme }) => theme.space.xs};
  min-width: 0;

  @media ${({ theme }) => theme.media.narrow} {
    /* Full-width equal thirds: comfortable thumb targets. */
    width: 100%;
    gap: ${({ theme }) => theme.space.xs};
  }
`;

const NavItem = styled(NavLink)`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.md};
  min-height: 44px;
  border-radius: ${({ theme }) => theme.radius.md} ${({ theme }) => theme.radius.md} 0 0;
  color: ${({ theme }) => theme.color.textMuted};
  font-weight: 600;
  border-bottom: 2px solid transparent;
  white-space: nowrap;

  &.active {
    color: ${({ theme }) => theme.color.text};
    background: ${({ theme }) => theme.color.surfaceAlt};
    border-bottom-color: ${({ theme }) => theme.color.accent};
  }

  @media ${({ theme }) => theme.media.narrow} {
    flex: 1 1 0;
    padding: ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.xs};
    font-size: ${({ theme }) => theme.font.size.sm};
  }
`;

const Main = styled.main`
  flex: 1;
  width: 100%;
  max-width: ${({ theme }) => theme.layout.maxWidth};
  margin: 0 auto;
  min-width: 0;
  padding: ${({ theme }) => theme.space.md};
  padding-bottom: calc(${({ theme }) => theme.space.xl} + env(safe-area-inset-bottom));

  @media ${({ theme }) => theme.media.wide} {
    padding: ${({ theme }) => theme.space.lg};
  }
`;

const ROUTES = [
  { to: '/analyze', label: 'Analyze' },
  { to: '/training', label: 'Training' },
  { to: '/blind', label: 'Blind' },
] as const;

export function App() {
  return (
    <HashRouter>
      <Shell>
        <Header>
          <HeaderInner>
            <Brand>Chess Trainer</Brand>
            <Nav aria-label="Sections">
              {ROUTES.map((r) => (
                <NavItem key={r.to} to={r.to}>
                  {r.label}
                </NavItem>
              ))}
            </Nav>
          </HeaderInner>
        </Header>
        <Main>
          <Routes>
            <Route path="/" element={<Navigate to="/analyze" replace />} />
            <Route path="/analyze" element={<AnalyzeSection />} />
            {/* Splat: the training section hosts its own nested routes (list, editor, play, drill). */}
            <Route path="/training/*" element={<TrainingSection />} />
            <Route path="/blind" element={<BlindSection />} />
            <Route path="*" element={<Navigate to="/analyze" replace />} />
          </Routes>
        </Main>
      </Shell>
    </HashRouter>
  );
}
