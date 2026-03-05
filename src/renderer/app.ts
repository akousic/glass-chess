import { ChessGame, type GameMode, type Move, type PieceType, type ThemeName } from '../shared/chess';
import { ChessScene } from './scene';

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      versions: {
        chrome: string;
        electron: string;
        node: string;
      };
    };
  }
}

export class ChessApp {
  private readonly game = new ChessGame();
  private readonly boardContainer = this.getElement<HTMLDivElement>('board-root');
  private readonly statusElement = this.getElement<HTMLDivElement>('status-text');
  private readonly moveListElement = this.getElement<HTMLOListElement>('move-list');
  private readonly modeButton = this.getElement<HTMLButtonElement>('mode-button');
  private readonly themeButton = this.getElement<HTMLButtonElement>('theme-button');
  private readonly newGameButton = this.getElement<HTMLButtonElement>('new-game-button');
  private readonly undoButton = this.getElement<HTMLButtonElement>('undo-button');
  private readonly footerElement = this.getElement<HTMLSpanElement>('footer-version');
  private readonly promotionDialog = this.getElement<HTMLDivElement>('promotion-dialog');
  private readonly promotionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-promotion]'));

  private readonly scene = new ChessScene(this.boardContainer, (square) => this.handleSquareClick(square));
  private mode: GameMode = 'hva';
  private theme: ThemeName = 'glass';
  private selectedSquare: number | null = null;
  private selectedMoves: Move[] = [];
  private aiTimer: number | null = null;
  private pendingPromotionMoves: Move[] = [];

  public mount(): void {
    this.newGameButton.addEventListener('click', () => this.startNewGame());
    this.undoButton.addEventListener('click', () => this.undoMove());
    this.themeButton.addEventListener('click', () => this.toggleTheme());
    this.modeButton.addEventListener('click', () => this.toggleMode());

    for (const button of this.promotionButtons) {
      button.addEventListener('click', () => {
        const promotion = button.dataset.promotion as PieceType;
        const move = this.pendingPromotionMoves.find((candidate) => candidate.promotion === promotion);
        if (!move) {
          return;
        }
        this.hidePromotionDialog();
        this.commitMove(move);
      });
    }

    const electron = window.electronAPI;
    this.footerElement.textContent = electron
      ? `Electron ${electron.versions.electron} • Chrome ${electron.versions.chrome} • Node ${electron.versions.node}`
      : 'Electron runtime';

    this.scene.setTheme(this.theme);
    this.render();
  }

  private startNewGame(): void {
    this.clearAiTimer();
    this.hidePromotionDialog();
    this.clearSelection();
    this.game.reset();
    this.render();
  }

  private undoMove(): void {
    this.clearAiTimer();
    this.hidePromotionDialog();
    this.clearSelection();

    const history = this.game.getMoveHistory();
    if (history.length === 0) {
      return;
    }

    const lastMove = history[history.length - 1];
    const undoSteps = this.mode === 'hva' && this.game.getTurn() === 'w' && lastMove.move.piece.color === 'b' ? 2 : 1;

    for (let step = 0; step < undoSteps; step += 1) {
      if (!this.game.undo()) {
        break;
      }
    }

    this.render();
  }

  private toggleTheme(): void {
    this.theme = this.theme === 'glass' ? 'marble' : 'glass';
    this.scene.setTheme(this.theme);
    this.render();
  }

  private toggleMode(): void {
    this.clearAiTimer();
    this.hidePromotionDialog();
    this.clearSelection();
    this.mode = this.mode === 'hva' ? 'hvh' : 'hva';
    this.render();
    this.scheduleAiMoveIfNeeded();
  }

  private handleSquareClick(square: number): void {
    if (this.pendingPromotionMoves.length > 0 || !this.isHumanTurn()) {
      return;
    }

    const board = this.game.getBoard();
    const clickedPiece = board[square];

    if (this.selectedSquare !== null) {
      const matchingMoves = this.selectedMoves.filter((move) => move.to === square);
      if (matchingMoves.length > 0) {
        const promotionMoves = matchingMoves.filter((move) => move.promotion);
        if (promotionMoves.length > 0) {
          this.pendingPromotionMoves = promotionMoves;
          this.promotionDialog.hidden = false;
          return;
        }

        this.commitMove(matchingMoves[0]);
        return;
      }
    }

    if (clickedPiece && clickedPiece.color === this.game.getTurn()) {
      this.selectedSquare = square;
      this.selectedMoves = this.game.getLegalMovesFrom(square);
      this.render();
      return;
    }

    this.clearSelection();
    this.render();
  }

  private commitMove(move: Move): void {
    this.clearSelection();
    this.game.makeMove(move.from, move.to, move.promotion);
    this.render();
    this.scheduleAiMoveIfNeeded();
  }

  private scheduleAiMoveIfNeeded(): void {
    this.clearAiTimer();

    if (this.mode !== 'hva' || this.game.getTurn() !== 'b') {
      return;
    }

    const status = this.game.getStatus();
    if (status.checkmate || status.stalemate) {
      return;
    }

    this.aiTimer = window.setTimeout(() => {
      this.aiTimer = null;
      const aiMove = this.game.chooseAIMove(2);
      if (!aiMove) {
        this.render();
        return;
      }
      this.game.makeMove(aiMove.from, aiMove.to, aiMove.promotion);
      this.render();
    }, 450);

    this.render();
  }

  private render(): void {
    const status = this.game.getStatus();
    const moveHistory = this.game.getMoveHistory();
    const isAiThinking = this.mode === 'hva' && this.game.getTurn() === 'b' && this.aiTimer !== null;

    this.statusElement.textContent = isAiThinking ? 'Black is thinking...' : status.message;
    this.modeButton.textContent = `Mode: ${this.mode === 'hva' ? 'Human vs AI' : 'Human vs Human'}`;
    this.themeButton.textContent = `Theme: ${this.theme === 'glass' ? 'Glass' : 'Marble'}`;
    this.undoButton.disabled = moveHistory.length === 0;

    const highlightSquares = this.selectedMoves.map((move) => move.to);
    this.scene.renderPosition(this.game.getBoard(), {
      selectedSquare: this.selectedSquare,
      highlightSquares,
      theme: this.theme,
      interactive: this.isHumanTurn() && this.pendingPromotionMoves.length === 0
    });

    this.moveListElement.innerHTML = '';
    for (let index = 0; index < moveHistory.length; index += 2) {
      const whiteMove = moveHistory[index];
      const blackMove = moveHistory[index + 1];
      const item = document.createElement('li');
      item.className = 'move-row';
      item.innerHTML = `
        <span class="move-number">${Math.floor(index / 2) + 1}.</span>
        <span class="move-san">${whiteMove?.san ?? ''}</span>
        <span class="move-san move-san-black">${blackMove?.san ?? ''}</span>
      `;
      this.moveListElement.appendChild(item);
    }
  }

  private isHumanTurn(): boolean {
    const status = this.game.getStatus();
    if (status.checkmate || status.stalemate) {
      return false;
    }

    if (this.mode === 'hvh') {
      return true;
    }

    return this.game.getTurn() === 'w';
  }

  private clearSelection(): void {
    this.selectedSquare = null;
    this.selectedMoves = [];
  }

  private hidePromotionDialog(): void {
    this.pendingPromotionMoves = [];
    this.promotionDialog.hidden = true;
  }

  private clearAiTimer(): void {
    if (this.aiTimer !== null) {
      window.clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
  }

  private getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element: ${id}`);
    }
    return element as T;
  }
}
