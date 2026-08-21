# Chess

- A service for chess players
- everything is running in browser - no server needed
- typescript react vite app
- suitable ui for web and mobile
- chessjs https://github.com/jhlywa/chess.js/
- stockfish https://stockfishchess.org/

## Sections

service contains 3 sections

### Analyze

User can play and analyze positions with stockfish engine

- start - will start analyze from starting position
- custom - user can set starting position and than start

### Training

User can train his saved lines (mewns starting position + series of moves)

- Saved lines
    - list of all saved lines
    - open line to analyze it
    - manage lines edit/delete/add new one
    - option to play it interactively (user can play as opponent to swicth between lines)

- Drill
    - its for testing the user memory
    - user can see only chess board (no analyze, moves etc)
    - user will get starting posiiton of random line (displayed on board)
    - he has to make a correct move (according to the line)
    - once he make correct move the app will play opponents according to line
    - and so on till the end of the line
    - hint button (to show the user his correct move)

### Blind chess

2 players can blind chess on one mobile

- there is only empty board
- toggle button to reveal/hide pieces
- push to talk button, while holding user can say the move
- app will repeat recorded move and if possible execute it
- players are switching turns
- works even if app is on background

## Steps to implement

0. setup enviroment
    - typescript
    - react
    - vite
    - styled-components
1. Chess board
    - display board and chess pieces
    - download images from chess.com (eg. https://assets-themes.chess.com/image/ejgfv/150/wk.png)
    - allowed valid moves
    - use chessjs: https://github.com/jhlywa/chess.js/
    - button to rotate board (swith playing as white or black)
    - user can make moves
2. implement play history
    - track the history of moves
    - display it next to the board
    - buttons back/forwad to move in history
3. stockfish
    - use https://stockfishchess.org/ in webassembly
    - implement eval bar next to the board
    - next to the board above the history display best moves in current position
4. Implement anaylze section
    - user can start analyze
    - user can setup custom position and start analyze
5. Implement Training section
    - managment of lines add/edit/delete
    - save the line to local sotrage
    - allow user to export them to files
    - load from file
    - user can view the line in analyze
6. Implement Drill
    - random pick line and test user
7. Implement Blind chess
