import { Chess, type Square } from "chess.js";

export type Color = "white" | "black";
export type GameStatus =
  "waiting" | "active" | "checkmate" | "draw" | "resigned" | "timeout";

export type GameState = {
  fen: string;
  turn: Color;
  status: GameStatus;
  winner: Color | null;
  lastMove: { from: string; to: string; san: string } | null;
  whiteTimeMs: number;
  blackTimeMs: number;
  lastMoveAt: number;
};

export class ChessGame {
  private readonly chess: Chess;
  private status: GameStatus = "waiting";
  private winner: Color | null = null;
  private lastMove: GameState["lastMove"] = null;
  private whiteTimeMs: number;
  private blackTimeMs: number;
  private lastMoveAt = Date.now();

  constructor(fen?: string, startingTimeMs: number = 5 * 60 * 1000) {
    this.chess = new Chess(fen);
    this.whiteTimeMs = startingTimeMs;
    this.blackTimeMs = startingTimeMs;
  }

  start(): GameState {
    this.status = "active";
    this.lastMoveAt = Date.now();
    return this.getState();
  }

  move(from: string, to: string, promotion?: string): GameState {
    if (this.status !== "active") {
      throw new Error("Game is already over");
    }

    const mover = this.chess.turn() === "w" ? "white" : "black";
    const result = this.chess.move({ from, to, promotion });

    const now = Date.now();
    const elapsed = now - this.lastMoveAt;
    if (mover === "white") {
      this.whiteTimeMs -= elapsed;
    } else {
      this.blackTimeMs -= elapsed;
    }
    this.lastMoveAt = now;

    this.lastMove = { from: result.from, to: result.to, san: result.san };
    this.updateStatus();
    return this.getState();
  }

  getState(): GameState {
    return {
      fen: this.chess.fen(),
      turn: this.chess.turn() === "w" ? "white" : "black",
      status: this.status,
      winner: this.winner,
      lastMove: this.lastMove,
      whiteTimeMs: this.whiteTimeMs,
      blackTimeMs: this.blackTimeMs,
      lastMoveAt: this.lastMoveAt,
    };
  }

  private updateStatus() {
    if (this.chess.isCheckmate()) {
      this.status = "checkmate";
      this.winner = this.chess.turn() === "w" ? "black" : "white";
    } else if (this.chess.isDraw()) {
      this.status = "draw";
    }
  }

  legalMoves(square: string): string[] {
    return this.chess
      .moves({ square: square as Square, verbose: true })
      .map((move) => move.to);
  }

  allLegalMoves(): { from: string; to: string }[] {
    return this.chess
      .moves({ verbose: true })
      .map((move) => ({ from: move.from, to: move.to }));
  }

  resign(color: Color): GameState {
    this.status = "resigned";
    this.winner = color === "white" ? "black" : "white";
    return this.getState();
  }

  flagTimeout(color: Color): GameState {
    if (color === "white") {
      this.whiteTimeMs = 0;
    } else {
      this.blackTimeMs = 0;
    }
    this.status = "timeout";
    this.winner = color === "white" ? "black" : "white";
    return this.getState();
  }
}
