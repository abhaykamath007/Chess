"use client";

import { useState, useEffect, useRef } from "react";
import { ChessGame, type Color, type GameState } from "@repo/chess";
import type { ClientMessage, ServerMessage } from "@repo/protocol";
import confetti from "canvas-confetti";

export default function Home() {
  const [status, setStatus] = useState("connecting...");
  const [socket, setSocket] = useState<WebSocket>();
  const [gameId, setGameId] = useState<string>();
  const [color, setColor] = useState<Color>();
  const [gameState, setGameState] = useState<GameState>();
  const [error, setError] = useState<string>();
  const [joinId, setJoinId] = useState<string>("");
  const [selected, setSelected] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  const engineRef = useRef<Worker>(undefined);
  const localGameRef = useRef<ChessGame>(undefined);
  const computerTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [mode, setMode] = useState<"multiplayer" | "computer">();
  const [difficulty, setDifficulty] = useState(10);
  const [timeControl, setTimeControl] = useState(5);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: string;
    to: string;
  }>();

  function boardFromFen(fen: string): string[] {
    const placement = fen.split(" ")[0];
    const ranks = placement.split("/");

    return ranks.flatMap((rank) => {
      const squares: string[] = [];
      for (const char of rank) {
        if (/\d/.test(char)) {
          squares.push(...Array(Number(char)).fill(""));
        } else {
          squares.push(char);
        }
      }
      return squares;
    });
  }

  function squareName(index: number): string {
    const row = Math.floor(index / 8);
    const col = index % 8;
    const file = String.fromCharCode(97 + col);
    const rank = 8 - row;
    return `${file}${rank}`;
  }

  function squareToIndex(square: string): number {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    const row = 8 - rank;
    return row * 8 + file;
  }

  function isPromotion(from: string, to: string): boolean {
    const piece = board[squareToIndex(from)];
    if (!piece || piece.toLowerCase() !== "p") return false;
    return to[1] === "8" || to[1] === "1";
  }

  function submitMove(from: string, to: string, promotion?: string) {
    if (mode === "computer") {
      makeLocalMove(from, to, promotion);
    } else {
      sendMessage({ type: "move", from, to, promotion });
    }
  }

  function handleSquareClick(square: string) {
    if (!gameState || gameState.status !== "active" || gameState.turn !== color)
      return;

    if (selected) {
      if (isPromotion(selected, square)) {
        setPendingPromotion({ from: selected, to: square });
      } else {
        submitMove(selected, square);
      }
      setSelected(undefined);
    } else {
      setSelected(square);
    }
  }

  function handleResign() {
    if (mode === "computer") {
      const game = localGameRef.current;
      if (!game || !color) return;
      if (computerTimeoutRef.current) {
        clearTimeout(computerTimeoutRef.current);
      }
      setGameState(game.resign(color));
    } else {
      sendMessage({ type: "resign" });
    }
  }

  async function copyGameId() {
    if (!gameId) return;
    await navigator.clipboard.writeText(gameId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function getComputerMove(
    fen: string,
  ): Promise<{ from: string; to: string; promotion?: string }> {
    return new Promise((resolve) => {
      const engine = engineRef.current;
      if (!engine) return;

      const handleMessage = (e: MessageEvent) => {
        const line = e.data as string;
        if (line.startsWith("bestmove")) {
          engine.removeEventListener("message", handleMessage);
          const move = line.split(" ")[1];
          resolve({
            from: move.slice(0, 2),
            to: move.slice(2, 4),
            promotion: move.length > 4 ? move[4] : undefined,
          });
        }
      };

      engine.addEventListener("message", handleMessage);
      engine.postMessage(`position fen ${fen}`);
      engine.postMessage("go depth 12");
    });
  }

  function scheduleComputerTimeoutCheck(game: ChessGame) {
    if (computerTimeoutRef.current) {
      clearTimeout(computerTimeoutRef.current);
    }
    if (timeControl === 0) return;

    const state = game.getState();
    const remaining =
      state.turn === "white" ? state.whiteTimeMs : state.blackTimeMs;
    computerTimeoutRef.current = setTimeout(() => {
      setGameState(game.flagTimeout(state.turn));
    }, remaining);
  }

  function startComputerGame() {
    const engine = engineRef.current;
    const targetElo = difficulty === 0 ? 1320 : difficulty;
    engine?.postMessage("setoption name UCI_LimitStrength value true");
    engine?.postMessage(`setoption name UCI_Elo value ${targetElo}`);

    const game = new ChessGame(undefined, (timeControl || 5) * 60 * 1000);
    game.start();
    localGameRef.current = game;
    scheduleComputerTimeoutCheck(game);
    setMode("computer");
    setColor("white");
    setGameState(game.getState());
  }

  async function makeLocalMove(from: string, to: string, promotion?: string) {
    const game = localGameRef.current;
    if (!game) return;

    try {
      const afterHuman = game.move(from, to, promotion);
      setGameState(afterHuman);
      setError(undefined);
      scheduleComputerTimeoutCheck(game);

      if (afterHuman.status === "active") {
        let computerMove: { from: string; to: string; promotion?: string };

        if (difficulty === 0 && Math.random() < 0.4) {
          const options = game.allLegalMoves();
          computerMove = options[Math.floor(Math.random() * options.length)];
        } else {
          computerMove = await getComputerMove(afterHuman.fen);
        }

        const afterComputer = game.move(
          computerMove.from,
          computerMove.to,
          computerMove.promotion,
        );
        setGameState(afterComputer);
        scheduleComputerTimeoutCheck(game);
      }
    } catch {
      setError("Invalid move");
    }
  }

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:3001");

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("disconnected");
    ws.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);

      if (message.type === "error") {
        setError(message.message);
        return;
      }
      setError(undefined);

      if (message.type === "game_created" || message.type === "game_joined") {
        setGameId(message.gameId);
        setColor(message.color);
      }
      setTimeControl(message.timeControl);
      setGameState(message.state);
    };
    setSocket(ws);
    return () => ws.close();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (
      gameState &&
      gameState.status !== "active" &&
      gameState.status !== "waiting" &&
      gameState.winner === color
    ) {
      confetti({ particleCount: 250, spread: 100, origin: { y: 0.6 } });
    }
  }, [gameState?.status, gameState?.winner, color]);

  useEffect(() => {
    const engine = new Worker("/stockfish/stockfish-18-lite-single.js");
    engine.postMessage("uci");
    engineRef.current = engine;
    return () => engine.terminate();
  }, []);

  const sendMessage = (message: ClientMessage) => {
    socket?.send(JSON.stringify(message));
  };

  const legalTargets =
    selected && gameState
      ? new ChessGame(gameState.fen).legalMoves(selected)
      : [];

  const board = gameState ? boardFromFen(gameState.fen) : [];

  function pieceImage(piece: string): string {
    const color = piece === piece.toUpperCase() ? "w" : "b";
    return `/pieces/${color}${piece.toUpperCase()}.svg`;
  }

  function displayTime(c: Color): number {
    if (!gameState) return 0;
    const base = c === "white" ? gameState.whiteTimeMs : gameState.blackTimeMs;
    if (gameState.turn !== c || gameState.status !== "active") return base;
    const elapsed = now - gameState.lastMoveAt;
    return Math.max(0, base - elapsed);
  }

  function formatTime(ms: number): string {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function ClockBar(barColor: Color) {
    const isActive =
      gameState?.turn === barColor && gameState?.status === "active";
    return (
      <div
        className={`w-full max-w-[512px] flex items-center justify-between px-4 py-2 rounded-md font-mono text-lg ${
          isActive ? "bg-white text-black" : "bg-[#4b4847] text-neutral-300"
        }`}
      >
        <span className="capitalize">{barColor}</span>
        <span>{formatTime(displayTime(barColor))}</span>
      </div>
    );
  }

  function resetGame() {
    if (computerTimeoutRef.current) {
      clearTimeout(computerTimeoutRef.current);
    }
    localGameRef.current = undefined;
    setMode(undefined);
    setGameState(undefined);
    setGameId(undefined);
    setColor(undefined);
    setSelected(undefined);
    setError(undefined);
    setPendingPromotion(undefined);
    setJoinId("");
  }

  return (
    <main className="min-h-screen bg-[#302e2b] text-neutral-100 flex flex-col items-center gap-6 py-10 px-4">
      <h1 className="text-3xl font-bold">Chess</h1>

      <div className="flex items-center gap-2 text-sm text-neutral-400">
        <span
          className={`w-2 h-2 rounded-full ${
            status === "connected" ? "bg-green-500" : "bg-red-500"
          }`}
        />
        {status}
      </div>

      {!gameState && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-[#3c3a37] rounded-lg shadow p-4">
          <button
            onClick={() => sendMessage({ type: "create_game", timeControl })}
            className="px-4 py-2 rounded-md bg-[#81b64c] text-white font-semibold hover:bg-[#6fa23f] transition"
          >
            Create Game
          </button>
          <select
            value={timeControl}
            onChange={(e) => setTimeControl(Number(e.target.value))}
            className="border border-neutral-600 bg-[#2a2926] text-neutral-100 rounded-md px-3 py-2 text-sm"
          >
            <option value={5}>5 min</option>
            <option value={10}>10 min</option>
            <option value={20}>20 min</option>
            <option value={0}>No limit</option>
          </select>
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            placeholder="Enter Game ID"
            className="border border-neutral-600 bg-[#2a2926] text-neutral-100 rounded-md px-3 py-2 text-sm placeholder-neutral-500"
          />
          <button
            onClick={() => sendMessage({ type: "join_game", gameId: joinId })}
            className="px-4 py-2 rounded-md bg-neutral-600 text-white font-semibold hover:bg-neutral-500 transition"
          >
            Join Game
          </button>
          <button
            onClick={startComputerGame}
            className="px-4 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
          >
            Play vs Computer
          </button>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
            className="border border-neutral-600 bg-[#2a2926] text-neutral-100 rounded-md px-3 py-2 text-sm"
          >
            <option value={0}>Very Easy</option>
            <option value={1320}>Easy</option>
            <option value={1800}>Medium</option>
            <option value={2400}>Hard</option>
            <option value={3190}>Max</option>
          </select>
        </div>
      )}

      {(gameId || color || error) && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-400">
          {gameId && (
            <span className="flex items-center gap-2">
              Game ID:{" "}
              <span className="font-mono text-neutral-200">{gameId}</span>
              <button
                onClick={copyGameId}
                aria-label="Copy game ID"
                className="p-1.5 rounded bg-neutral-600 hover:bg-neutral-500 transition text-neutral-200"
              >
                {copied ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  </svg>
                )}
              </button>
            </span>
          )}

          {color && (
            <span>
              You are:{" "}
              <span className="font-semibold text-neutral-200">{color}</span>
            </span>
          )}
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}

      {gameState && (
        <div className="flex flex-col items-center gap-2">
          {timeControl !== 0 && ClockBar(color === "black" ? "white" : "black")}

          <div className="grid grid-cols-[repeat(8,64px)] rounded-md overflow-hidden shadow-2xl">
            {Array.from({ length: 64 }).map((_, index) => {
              const displayIndex = color === "black" ? 63 - index : index;
              const piece = board[displayIndex];
              const square = squareName(displayIndex);
              const row = Math.floor(index / 8);
              const col = index % 8;
              const isLight = (row + col) % 2 === 0;
              const isLegalTarget = legalTargets.includes(square);
              const isLastMove =
                gameState.lastMove &&
                (square === gameState.lastMove.from ||
                  square === gameState.lastMove.to);

              return (
                <div
                  key={index}
                  onClick={() => handleSquareClick(square)}
                  className={`w-16 h-16 relative flex items-center justify-center cursor-pointer ${
                    square === selected
                      ? "bg-[#f6f669]"
                      : isLight
                        ? "bg-[#eeeed2]"
                        : "bg-[#769656]"
                  }`}
                >
                  {" "}
                  {isLastMove && (
                    <div className="absolute inset-0 bg-yellow-300/50" />
                  )}
                  {piece && (
                    <img
                      src={pieceImage(piece)}
                      alt={piece}
                      className="w-12 h-12 relative z-10"
                    />
                  )}
                  {isLegalTarget && !piece && (
                    <div className="absolute w-6 h-6 rounded-full bg-black/20" />
                  )}
                  {isLegalTarget && piece && (
                    <div className="absolute inset-0 rounded-full ring-[6px] ring-inset ring-black/20" />
                  )}
                </div>
              );
            })}
          </div>

          {timeControl !== 0 && ClockBar(color === "black" ? "black" : "white")}

          {pendingPromotion && (
            <div className="flex gap-2 bg-[#3c3a37] p-3 rounded-lg">
              {["q", "r", "b", "n"].map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    submitMove(pendingPromotion.from, pendingPromotion.to, p);
                    setPendingPromotion(undefined);
                  }}
                  className="w-12 h-12 flex items-center justify-center bg-neutral-600 hover:bg-neutral-500 rounded"
                >
                  <img
                    src={pieceImage(color === "white" ? p.toUpperCase() : p)}
                    alt={p}
                    className="w-10 h-10"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {gameState && gameState.status === "active" && (
        <button
          onClick={handleResign}
          className="px-4 py-2 rounded-md bg-red-700 text-white font-semibold hover:bg-red-800 transition"
        >
          Resign
        </button>
      )}

      {gameState &&
        gameState.status !== "active" &&
        gameState.status !== "waiting" && (
          <div className="flex flex-col items-center gap-3">
            <p className="px-4 py-2 rounded-md bg-[#3c3a37] shadow text-neutral-100 font-medium">
              Game Over — {gameState.status}
              {gameState.winner && ` — ${gameState.winner} wins`}
            </p>
            <button
              onClick={resetGame}
              className="px-4 py-2 rounded-md bg-[#81b64c] text-white font-semibold hover:bg-[#6fa23f] transition"
            >
              New Game
            </button>
          </div>
        )}
    </main>
  );
}
