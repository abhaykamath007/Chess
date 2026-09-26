import type { ServerWebSocket } from "bun";
import { ChessGame, type GameState, type Color } from "@repo/chess";
import type { ClientMessage, ServerMessage } from "@repo/protocol";
import { randomUUID } from "node:crypto";

type SocketData = {
  playerId: string;
  gameId?: string;
  color?: Color;
};

type GameRoom = {
  game: ChessGame;
  white?: ServerWebSocket<SocketData>;
  black?: ServerWebSocket<SocketData>;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  timeControl: number;
};


const rooms = new Map<string, GameRoom>();

const port = Number(process.env.PORT ?? 3001);

const send = (socket: ServerWebSocket<SocketData>, message: ServerMessage) => {
  socket.send(JSON.stringify(message));
};

const broadcast = (room: GameRoom, message: ServerMessage) => {
  if (room.white) {
    send(room.white, message);
  }
  if (room.black) {
    send(room.black, message);
  }
};

const getRoom = (socket: ServerWebSocket<SocketData>): GameRoom | undefined => {
  return socket.data.gameId ? rooms.get(socket.data.gameId) : undefined;
};

function scheduleTimeoutCheck(room: GameRoom) {
  if (room.timeoutHandle) {
    clearTimeout(room.timeoutHandle);
  }
  if (room.timeControl === 0) return;

  const state = room.game.getState();
  const remaining = state.turn === "white" ? state.whiteTimeMs : state.blackTimeMs;

  room.timeoutHandle = setTimeout(() => {
    const newState = room.game.flagTimeout(state.turn);
    broadcast(room, {
      type: "state_update",
      state: newState,
      timeControl: room.timeControl,
    });
  }, remaining);
}

Bun.serve<SocketData>({
  port,
  fetch(request, server) {
    
    if (server.upgrade(request, { data: { playerId: randomUUID() } })) {
      return;
    }
    return new Response("Chess server is running");
  },
  websocket: {
    open(socket) {
      console.log("connected", socket.data.playerId);
    },
    message(socket, raw) {
      const message: ClientMessage = JSON.parse(String(raw));

      if (message.type === "create_game") {
        const gameId = randomUUID();
        const startingTimeMs = (message.timeControl || 5) * 60 * 1000;
        const room: GameRoom = {
          game: new ChessGame(undefined, startingTimeMs),
          white: socket,
          timeControl: message.timeControl,
        };
        rooms.set(gameId, room);
        socket.data.gameId = gameId;
        socket.data.color = "white";
        send(socket, {
          type: "game_created",
          gameId,
          color: "white",
          state: room.game.getState(),
          timeControl: room.timeControl,
        });
        return;
      }

      if (message.type === "join_game") {
        const room = rooms.get(message.gameId);
        if (!room) {
          send(socket, { type: "error", message: "Game not found" });
          return;
        }
        if (room.black) {
          send(socket, { type: "error", message: "Game is full" });
          return;
        }

        room.black = socket;
        socket.data.gameId = message.gameId;
        socket.data.color = "black";
        room.game.start();

        send(socket, {
          type: "game_joined",
          gameId: message.gameId,
          color: "black",
          state: room.game.getState(),
          timeControl: room.timeControl,
        });
        broadcast(room, {
          type: "state_update",
          state: room.game.getState(),
          timeControl: room.timeControl,
        });
        scheduleTimeoutCheck(room);
        return;
      }

      if (message.type === "move") {
        const room = getRoom(socket);
        if (!room) {
          send(socket, {
            type: "error",
            message: "Join or create a game first",
          });
          return;
        }

        const state = room.game.getState();
        if (state.turn !== socket.data.color) {
          send(socket, { type: "error", message: "It is not your turn" });
          return;
        }

        try {
          const newState = room.game.move(
            message.from,
            message.to,
            message.promotion,
          );
          broadcast(room, {
            type: "state_update",
            state: newState,
            timeControl: room.timeControl,
          });
          scheduleTimeoutCheck(room);
        } catch (error) {
          send(socket, { type: "error", message: "Invalid move" });
        }
        return;
      }

      if (message.type === "resign") {
        const room = getRoom(socket);
        if (!room || !socket.data.color) {
          send(socket, {
            type: "error",
            message: "Join or create a game first",
          });
          return;
        }

        const newState = room.game.resign(socket.data.color);
        if (room.timeoutHandle) {
          clearTimeout(room.timeoutHandle);
        }
        broadcast(room, {
          type: "state_update",
          state: newState,
          timeControl: room.timeControl,
        });
        return;
      }
    },
    close(socket) {
      console.log("disconnected", socket.data.playerId);
    },
  },
});

console.log(`Listening on http://localhost:${port}`);
