import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  * {
    margin: 0;
    padding: 0;
  }

  html {
    -webkit-text-size-adjust: 100%;
    /* Never scroll the page sideways — the board sizes to its container instead. */
    overflow-x: hidden;
  }

  body {
    margin: 0;
    min-height: 100dvh;
    overflow-x: hidden;
    background: ${({ theme }) => theme.color.bg};
    color: ${({ theme }) => theme.color.text};
    font-family: ${({ theme }) => theme.font.body};
    font-size: ${({ theme }) => theme.font.size.md};
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  #root {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  img,
  svg {
    display: block;
    max-width: 100%;
  }

  button,
  input,
  select,
  textarea {
    font: inherit;
    color: inherit;
  }

  button {
    background: none;
    border: none;
    cursor: pointer;
    touch-action: manipulation;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  ul,
  ol {
    list-style: none;
  }

  :focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.focus};
    outline-offset: 2px;
  }

  h1, h2, h3, h4 {
    font-weight: 600;
    line-height: 1.2;
  }
`;
