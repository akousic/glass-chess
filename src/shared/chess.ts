export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type ThemeName = 'glass' | 'marble';
export type GameMode = 'hvh' | 'hva';

export interface Piece {
  color: Color;
  type: PieceType;
}

export interface Move {
  from: number;
  to: number;
  piece: Piece;
  captured?: Piece | null;
  promotion?: PieceType;
  isEnPassant?: boolean;
  isCastling?: boolean;
  castleSide?: 'king' | 'queen';
}

export interface CompletedMove {
  move: Move;
  san: string;
}

interface CastlingRights {
  w: { k: boolean; q: boolean };
  b: { k: boolean; q: boolean };
}

interface GameState {
  board: Array<Piece | null>;
  turn: Color;
  castling: CastlingRights;
  enPassant: number | null;
  halfmoveClock: number;
  fullmoveNumber: number;
}

interface GameSnapshot {
  state: GameState;
}

export interface GameStatus {
  inCheck: boolean;
  checkmate: boolean;
  stalemate: boolean;
  winner: Color | null;
  message: string;
}

const FILES = 'abcdefgh';
const KNIGHT_OFFSETS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2]
] as const;
const KING_OFFSETS = [
  [1, 1],
  [1, 0],
  [1, -1],
  [0, 1],
  [0, -1],
  [-1, 1],
  [-1, 0],
  [-1, -1]
] as const;
const BISHOP_DIRECTIONS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
] as const;
const ROOK_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
] as const;

export function indexToSquare(index: number): string {
  return `${FILES[fileOf(index)]}${rankOf(index) + 1}`;
}

export function squareToIndex(square: string): number {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return rank * 8 + file;
}

export function oppositeColor(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

export class ChessGame {
  private state: GameState;
  private history: GameSnapshot[] = [];
  private completedMoves: CompletedMove[] = [];

  constructor() {
    this.state = createInitialState();
  }

  public reset(): void {
    this.state = createInitialState();
    this.history = [];
    this.completedMoves = [];
  }

  public clone(): ChessGame {
    const game = new ChessGame();
    game.state = cloneState(this.state);
    game.history = this.history.map((entry) => ({ state: cloneState(entry.state) }));
    game.completedMoves = this.completedMoves.map((entry) => ({
      move: cloneMove(entry.move),
      san: entry.san
    }));
    return game;
  }

  public getBoard(): Array<Piece | null> {
    return this.state.board.map((piece) => (piece ? { ...piece } : null));
  }

  public getTurn(): Color {
    return this.state.turn;
  }

  public getMoveHistory(): CompletedMove[] {
    return this.completedMoves.map((entry) => ({
      move: cloneMove(entry.move),
      san: entry.san
    }));
  }

  public getStatus(): GameStatus {
    return evaluateStatus(this.state);
  }

  public undo(): boolean {
    const snapshot = this.history.pop();
    if (!snapshot) {
      return false;
    }

    this.state = cloneState(snapshot.state);
    this.completedMoves.pop();
    return true;
  }

  public getLegalMoves(color: Color = this.state.turn): Move[] {
    return generateLegalMoves(this.state, color);
  }

  public getLegalMovesFrom(square: number): Move[] {
    const piece = this.state.board[square];
    if (!piece || piece.color !== this.state.turn) {
      return [];
    }

    return this.getLegalMoves(this.state.turn).filter((move) => move.from === square);
  }

  public makeMove(from: number, to: number, promotion?: PieceType): CompletedMove | null {
    const legalMoves = this.getLegalMoves(this.state.turn).filter((move) => {
      return move.from === from && move.to === to && (promotion ? move.promotion === promotion : true);
    });
    const chosenMove =
      legalMoves.find((move) => move.promotion === promotion) ??
      (promotion ? null : legalMoves.find((move) => move.promotion === undefined)) ??
      null;

    if (!chosenMove) {
      return null;
    }

    const snapshot = cloneState(this.state);
    const movingColor = this.state.turn;
    const san = this.createSan(chosenMove, this.getLegalMoves(movingColor));
    this.history.push({ state: snapshot });
    applyMove(this.state, chosenMove);

    const completedMove = { move: cloneMove(chosenMove), san };
    this.completedMoves.push(completedMove);
    return completedMove;
  }

  public chooseAIMove(depth = 2): Move | null {
    const legalMoves = this.getLegalMoves(this.state.turn);
    if (legalMoves.length === 0) {
      return null;
    }

    let bestScore = Number.NEGATIVE_INFINITY;
    let bestMoves: Move[] = [];
    const maximizingColor = this.state.turn;

    for (const move of legalMoves) {
      const nextState = cloneState(this.state);
      applyMove(nextState, move);
      const score = minimax(nextState, depth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, false, maximizingColor);
      if (score > bestScore) {
        bestScore = score;
        bestMoves = [move];
      } else if (score === bestScore) {
        bestMoves.push(move);
      }
    }

    return bestMoves[Math.floor(Math.random() * bestMoves.length)] ?? legalMoves[0];
  }

  private createSan(move: Move, allLegalMoves: Move[]): string {
    const nextState = cloneState(this.state);
    applyMove(nextState, move);
    const nextStatus = evaluateStatus(nextState);

    if (move.isCastling) {
      return `${move.castleSide === 'king' ? 'O-O' : 'O-O-O'}${nextStatus.checkmate ? '#' : nextStatus.inCheck ? '+' : ''}`;
    }

    const pieceLetter = move.piece.type === 'p' ? '' : move.piece.type.toUpperCase();
    const capture = Boolean(move.captured || move.isEnPassant);
    let disambiguation = '';

    if (move.piece.type !== 'p' && move.piece.type !== 'k') {
      const collisions = allLegalMoves.filter((candidate) => {
        return (
          !(candidate.from === move.from && candidate.to === move.to && candidate.promotion === move.promotion) &&
          candidate.to === move.to &&
          candidate.piece.type === move.piece.type &&
          candidate.piece.color === move.piece.color
        );
      });

      if (collisions.length > 0) {
        const fileConflict = collisions.some((candidate) => fileOf(candidate.from) === fileOf(move.from));
        const rankConflict = collisions.some((candidate) => rankOf(candidate.from) === rankOf(move.from));
        if (!fileConflict) {
          disambiguation = FILES[fileOf(move.from)];
        } else if (!rankConflict) {
          disambiguation = String(rankOf(move.from) + 1);
        } else {
          disambiguation = `${FILES[fileOf(move.from)]}${rankOf(move.from) + 1}`;
        }
      }
    }

    const pawnPrefix = move.piece.type === 'p' && capture ? FILES[fileOf(move.from)] : '';
    const captureMark = capture ? 'x' : '';
    const destination = indexToSquare(move.to);
    const promotion = move.promotion ? `=${move.promotion.toUpperCase()}` : '';
    const suffix = nextStatus.checkmate ? '#' : nextStatus.inCheck ? '+' : '';

    return `${pieceLetter}${disambiguation}${pawnPrefix}${captureMark}${destination}${promotion}${suffix}`;
  }
}

function createInitialState(): GameState {
  const board: Array<Piece | null> = Array.from({ length: 64 }, () => null);
  const backRank: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

  for (let file = 0; file < 8; file += 1) {
    board[file] = { color: 'w', type: backRank[file] };
    board[8 + file] = { color: 'w', type: 'p' };
    board[48 + file] = { color: 'b', type: 'p' };
    board[56 + file] = { color: 'b', type: backRank[file] };
  }

  return {
    board,
    turn: 'w',
    castling: {
      w: { k: true, q: true },
      b: { k: true, q: true }
    },
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1
  };
}

function cloneState(state: GameState): GameState {
  return {
    board: state.board.map((piece) => (piece ? { ...piece } : null)),
    turn: state.turn,
    castling: {
      w: { ...state.castling.w },
      b: { ...state.castling.b }
    },
    enPassant: state.enPassant,
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber
  };
}

function cloneMove(move: Move): Move {
  return {
    ...move,
    piece: { ...move.piece },
    captured: move.captured ? { ...move.captured } : move.captured
  };
}

function fileOf(index: number): number {
  return index % 8;
}

function rankOf(index: number): number {
  return Math.floor(index / 8);
}

function isOnBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

function toIndex(file: number, rank: number): number {
  return rank * 8 + file;
}

function applyMove(state: GameState, move: Move): void {
  const movingPiece = state.board[move.from];
  if (!movingPiece) {
    throw new Error(`No piece at ${move.from}`);
  }

  const from = move.from;
  const to = move.to;
  const color = movingPiece.color;
  const enemy = oppositeColor(color);
  const targetBeforeMove = state.board[to];
  const capturedPiece = move.isEnPassant
    ? state.board[to + (color === 'w' ? -8 : 8)]
    : targetBeforeMove;

  state.board[from] = null;

  if (move.isEnPassant) {
    const captureSquare = to + (color === 'w' ? -8 : 8);
    state.board[captureSquare] = null;
  }

  if (move.isCastling) {
    if (move.castleSide === 'king') {
      const rookFrom = color === 'w' ? 7 : 63;
      const rookTo = to - 1;
      state.board[rookTo] = state.board[rookFrom];
      state.board[rookFrom] = null;
    } else {
      const rookFrom = color === 'w' ? 0 : 56;
      const rookTo = to + 1;
      state.board[rookTo] = state.board[rookFrom];
      state.board[rookFrom] = null;
    }
  }

  const placedPiece: Piece = move.promotion ? { color, type: move.promotion } : { ...movingPiece };
  state.board[to] = placedPiece;

  state.enPassant = null;

  if (movingPiece.type === 'p' && Math.abs(to - from) === 16) {
    state.enPassant = from + (color === 'w' ? 8 : -8);
  }

  if (movingPiece.type === 'k') {
    state.castling[color].k = false;
    state.castling[color].q = false;
  }

  if (movingPiece.type === 'r') {
    if (from === 0) state.castling.w.q = false;
    if (from === 7) state.castling.w.k = false;
    if (from === 56) state.castling.b.q = false;
    if (from === 63) state.castling.b.k = false;
  }

  if (capturedPiece?.type === 'r') {
    if (to === 0) state.castling.w.q = false;
    if (to === 7) state.castling.w.k = false;
    if (to === 56) state.castling.b.q = false;
    if (to === 63) state.castling.b.k = false;
  }

  state.halfmoveClock = movingPiece.type === 'p' || capturedPiece ? 0 : state.halfmoveClock + 1;

  if (color === 'b') {
    state.fullmoveNumber += 1;
  }

  state.turn = enemy;
}

function generateLegalMoves(state: GameState, color: Color): Move[] {
  const pseudoMoves = generatePseudoLegalMoves(state, color);
  return pseudoMoves.filter((move) => {
    const nextState = cloneState(state);
    applyMove(nextState, move);
    return !isInCheck(nextState, color);
  });
}

function generatePseudoLegalMoves(state: GameState, color: Color): Move[] {
  const moves: Move[] = [];

  state.board.forEach((piece, index) => {
    if (!piece || piece.color !== color) {
      return;
    }

    switch (piece.type) {
      case 'p':
        addPawnMoves(state, index, piece, moves);
        break;
      case 'n':
        addLeaperMoves(state, index, piece, moves, KNIGHT_OFFSETS);
        break;
      case 'b':
        addSliderMoves(state, index, piece, moves, BISHOP_DIRECTIONS);
        break;
      case 'r':
        addSliderMoves(state, index, piece, moves, ROOK_DIRECTIONS);
        break;
      case 'q':
        addSliderMoves(state, index, piece, moves, [...BISHOP_DIRECTIONS, ...ROOK_DIRECTIONS]);
        break;
      case 'k':
        addLeaperMoves(state, index, piece, moves, KING_OFFSETS);
        addCastlingMoves(state, index, piece, moves);
        break;
      default:
        break;
    }
  });

  return moves;
}

function addPawnMoves(state: GameState, from: number, piece: Piece, moves: Move[]): void {
  const file = fileOf(from);
  const rank = rankOf(from);
  const direction = piece.color === 'w' ? 1 : -1;
  const startRank = piece.color === 'w' ? 1 : 6;
  const promotionRank = piece.color === 'w' ? 7 : 0;
  const oneForwardRank = rank + direction;

  if (isOnBoard(file, oneForwardRank)) {
    const oneForward = toIndex(file, oneForwardRank);
    if (!state.board[oneForward]) {
      if (oneForwardRank === promotionRank) {
        for (const promotion of ['q', 'r', 'b', 'n'] as PieceType[]) {
          moves.push({ from, to: oneForward, piece, promotion });
        }
      } else {
        moves.push({ from, to: oneForward, piece });
      }

      const twoForwardRank = rank + direction * 2;
      const twoForward = toIndex(file, twoForwardRank);
      if (rank === startRank && !state.board[twoForward]) {
        moves.push({ from, to: twoForward, piece });
      }
    }
  }

  for (const fileOffset of [-1, 1]) {
    const targetFile = file + fileOffset;
    const targetRank = rank + direction;
    if (!isOnBoard(targetFile, targetRank)) {
      continue;
    }

    const to = toIndex(targetFile, targetRank);
    const targetPiece = state.board[to];
    if (targetPiece && targetPiece.color !== piece.color) {
      if (targetRank === promotionRank) {
        for (const promotion of ['q', 'r', 'b', 'n'] as PieceType[]) {
          moves.push({ from, to, piece, captured: targetPiece, promotion });
        }
      } else {
        moves.push({ from, to, piece, captured: targetPiece });
      }
    } else if (state.enPassant === to) {
      const capturedSquare = to + (piece.color === 'w' ? -8 : 8);
      const captured = state.board[capturedSquare];
      if (captured?.type === 'p' && captured.color !== piece.color) {
        moves.push({ from, to, piece, captured, isEnPassant: true });
      }
    }
  }
}

function addLeaperMoves(
  state: GameState,
  from: number,
  piece: Piece,
  moves: Move[],
  offsets: ReadonlyArray<readonly [number, number]>
): void {
  const baseFile = fileOf(from);
  const baseRank = rankOf(from);

  for (const [fileOffset, rankOffset] of offsets) {
    const targetFile = baseFile + fileOffset;
    const targetRank = baseRank + rankOffset;
    if (!isOnBoard(targetFile, targetRank)) {
      continue;
    }
    const to = toIndex(targetFile, targetRank);
    const target = state.board[to];
    if (!target || target.color !== piece.color) {
      moves.push({
        from,
        to,
        piece,
        captured: target ?? undefined
      });
    }
  }
}

function addSliderMoves(
  state: GameState,
  from: number,
  piece: Piece,
  moves: Move[],
  directions: ReadonlyArray<readonly [number, number]>
): void {
  const baseFile = fileOf(from);
  const baseRank = rankOf(from);

  for (const [fileDirection, rankDirection] of directions) {
    let targetFile = baseFile + fileDirection;
    let targetRank = baseRank + rankDirection;

    while (isOnBoard(targetFile, targetRank)) {
      const to = toIndex(targetFile, targetRank);
      const target = state.board[to];
      if (!target) {
        moves.push({ from, to, piece });
      } else {
        if (target.color !== piece.color) {
          moves.push({ from, to, piece, captured: target });
        }
        break;
      }

      targetFile += fileDirection;
      targetRank += rankDirection;
    }
  }
}

function addCastlingMoves(state: GameState, from: number, piece: Piece, moves: Move[]): void {
  if (isInCheck(state, piece.color)) {
    return;
  }

  if (piece.color === 'w' && from === 4) {
    const kingSideRook = state.board[7];
    if (
      state.castling.w.k &&
      kingSideRook?.type === 'r' &&
      kingSideRook.color === 'w' &&
      !state.board[5] &&
      !state.board[6] &&
      !isSquareAttacked(state, 5, 'b') &&
      !isSquareAttacked(state, 6, 'b')
    ) {
      moves.push({ from, to: 6, piece, isCastling: true, castleSide: 'king' });
    }

    const queenSideRook = state.board[0];
    if (
      state.castling.w.q &&
      queenSideRook?.type === 'r' &&
      queenSideRook.color === 'w' &&
      !state.board[1] &&
      !state.board[2] &&
      !state.board[3] &&
      !isSquareAttacked(state, 3, 'b') &&
      !isSquareAttacked(state, 2, 'b')
    ) {
      moves.push({ from, to: 2, piece, isCastling: true, castleSide: 'queen' });
    }
  }

  if (piece.color === 'b' && from === 60) {
    const kingSideRook = state.board[63];
    if (
      state.castling.b.k &&
      kingSideRook?.type === 'r' &&
      kingSideRook.color === 'b' &&
      !state.board[61] &&
      !state.board[62] &&
      !isSquareAttacked(state, 61, 'w') &&
      !isSquareAttacked(state, 62, 'w')
    ) {
      moves.push({ from, to: 62, piece, isCastling: true, castleSide: 'king' });
    }

    const queenSideRook = state.board[56];
    if (
      state.castling.b.q &&
      queenSideRook?.type === 'r' &&
      queenSideRook.color === 'b' &&
      !state.board[57] &&
      !state.board[58] &&
      !state.board[59] &&
      !isSquareAttacked(state, 59, 'w') &&
      !isSquareAttacked(state, 58, 'w')
    ) {
      moves.push({ from, to: 58, piece, isCastling: true, castleSide: 'queen' });
    }
  }
}

function isInCheck(state: GameState, color: Color): boolean {
  const kingSquare = state.board.findIndex((piece) => piece?.type === 'k' && piece.color === color);
  if (kingSquare === -1) {
    return false;
  }
  return isSquareAttacked(state, kingSquare, oppositeColor(color));
}

function isSquareAttacked(state: GameState, square: number, attackingColor: Color): boolean {
  const targetFile = fileOf(square);
  const targetRank = rankOf(square);

  const pawnRank = targetRank + (attackingColor === 'w' ? -1 : 1);
  for (const fileOffset of [-1, 1]) {
    const pawnFile = targetFile + fileOffset;
    if (!isOnBoard(pawnFile, pawnRank)) {
      continue;
    }
    const piece = state.board[toIndex(pawnFile, pawnRank)];
    if (piece?.color === attackingColor && piece.type === 'p') {
      return true;
    }
  }

  for (const [fileOffset, rankOffset] of KNIGHT_OFFSETS) {
    const file = targetFile + fileOffset;
    const rank = targetRank + rankOffset;
    if (!isOnBoard(file, rank)) {
      continue;
    }
    const piece = state.board[toIndex(file, rank)];
    if (piece?.color === attackingColor && piece.type === 'n') {
      return true;
    }
  }

  for (const [fileDirection, rankDirection] of BISHOP_DIRECTIONS) {
    let file = targetFile + fileDirection;
    let rank = targetRank + rankDirection;
    while (isOnBoard(file, rank)) {
      const piece = state.board[toIndex(file, rank)];
      if (piece) {
        if (piece.color === attackingColor && (piece.type === 'b' || piece.type === 'q')) {
          return true;
        }
        break;
      }
      file += fileDirection;
      rank += rankDirection;
    }
  }

  for (const [fileDirection, rankDirection] of ROOK_DIRECTIONS) {
    let file = targetFile + fileDirection;
    let rank = targetRank + rankDirection;
    while (isOnBoard(file, rank)) {
      const piece = state.board[toIndex(file, rank)];
      if (piece) {
        if (piece.color === attackingColor && (piece.type === 'r' || piece.type === 'q')) {
          return true;
        }
        break;
      }
      file += fileDirection;
      rank += rankDirection;
    }
  }

  for (const [fileOffset, rankOffset] of KING_OFFSETS) {
    const file = targetFile + fileOffset;
    const rank = targetRank + rankOffset;
    if (!isOnBoard(file, rank)) {
      continue;
    }
    const piece = state.board[toIndex(file, rank)];
    if (piece?.color === attackingColor && piece.type === 'k') {
      return true;
    }
  }

  return false;
}

function evaluateStatus(state: GameState): GameStatus {
  const turn = state.turn;
  const inCheck = isInCheck(state, turn);
  const legalMoves = generateLegalMoves(state, turn);

  if (legalMoves.length === 0 && inCheck) {
    return {
      inCheck: true,
      checkmate: true,
      stalemate: false,
      winner: oppositeColor(turn),
      message: `${colorName(oppositeColor(turn))} wins by checkmate.`
    };
  }

  if (legalMoves.length === 0) {
    return {
      inCheck: false,
      checkmate: false,
      stalemate: true,
      winner: null,
      message: 'Draw by stalemate.'
    };
  }

  return {
    inCheck,
    checkmate: false,
    stalemate: false,
    winner: null,
    message: `${colorName(turn)} to move${inCheck ? ' - check.' : '.'}`
  };
}

function evaluateBoard(state: GameState, perspective: Color): number {
  const values: Record<PieceType, number> = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 0
  };

  const status = evaluateStatus(state);
  if (status.checkmate) {
    return status.winner === perspective ? 100000 : -100000;
  }
  if (status.stalemate) {
    return 0;
  }

  let score = 0;
  for (const piece of state.board) {
    if (!piece) {
      continue;
    }
    const value = values[piece.type];
    score += piece.color === perspective ? value : -value;
  }

  const mobility = generateLegalMoves(state, perspective).length - generateLegalMoves(state, oppositeColor(perspective)).length;
  return score + mobility * 5;
}

function minimax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  perspective: Color
): number {
  const status = evaluateStatus(state);
  if (depth <= 0 || status.checkmate || status.stalemate) {
    return evaluateBoard(state, perspective);
  }

  const moves = generateLegalMoves(state, state.turn);
  if (maximizing) {
    let value = Number.NEGATIVE_INFINITY;
    for (const move of moves) {
      const nextState = cloneState(state);
      applyMove(nextState, move);
      value = Math.max(value, minimax(nextState, depth - 1, alpha, beta, false, perspective));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) {
        break;
      }
    }
    return value;
  }

  let value = Number.POSITIVE_INFINITY;
  for (const move of moves) {
    const nextState = cloneState(state);
    applyMove(nextState, move);
    value = Math.min(value, minimax(nextState, depth - 1, alpha, beta, true, perspective));
    beta = Math.min(beta, value);
    if (alpha >= beta) {
      break;
    }
  }
  return value;
}

function colorName(color: Color): string {
  return color === 'w' ? 'White' : 'Black';
}
