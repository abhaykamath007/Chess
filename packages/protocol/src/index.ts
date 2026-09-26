import type { Color, GameState } from "@repo/chess";

export type ClientMessage =
  | { type: "create_game"; timeControl: number }
  | { type: "join_game"; gameId: string }
  | { type: "move"; from: string; to: string; promotion?: string }
  | { type: "resign" };

export type ServerMessage =
  | {
      type: "game_created";
      gameId: string;
      color: Color;
      state: GameState;
      timeControl: number;
    }
  | {
      type: "game_joined";
      gameId: string;
      color: Color;
      state: GameState;
      timeControl: number;
    }
  | { type: "state_update"; state: GameState; timeControl: number }
  | { type: "error"; message: string };
