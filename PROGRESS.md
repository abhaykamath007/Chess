# Chess Project — Progress Log

Goal: build a multiplayer chess app yourself (monorepo: rules engine +
WebSocket server + web client), learning each piece rather than having it
generated. Starting order: backend first (chess rules -> server), frontend
later.

## Decisions made so far

- **Package manager / runtime**: Bun (`bun install`, `bun run ...`).
- **Structure**: monorepo using workspaces — `apps/*` for runnable
  applications, `packages/*` for shared code between them.
- **Scope for v1**: multiplayer from the start (not local-only).
- **Chess rules**: use the `chess.js` library rather than writing your own
  move-generation engine. It lives only inside `packages/chess`; other
  packages will never import `chess.js` directly, only your wrapper.
- **Frontend framework**: Next.js (kept from the `create-turbo` scaffold,
  chose not to switch to Vite).
- **Build orchestration**: skipped `turbo` task-running for now — running
  package scripts by hand is fine at this size.
- **Room/player tracking in the server**: fixed `white`/`black` fields on
  `GameRoom` instead of a `Map<playerId, Player>` — a chess game always has
  exactly two players (not an arbitrary/growing count), so a lookup map was
  the wrong tool. Reasoning: match the data structure to how many of a
  thing can actually exist and whether you need to fetch one by ID.
  Spectators, if added later, would need their own `Set` alongside these
  two fields, since "how many spectators" genuinely is unbounded.
- **Workflow preference**: code is given as snippets in chat for you to
  type/paste yourself, not written directly to files — except when you
  explicitly ask for a direct edit (e.g. reordering class members).

## Steps completed, in order

1. **Wiped the folder and started clean.**
   - Deleted the old fully-generated app (server/web/chess package) that
     had been built in an earlier session — moved to `reference/` first,
     then deleted entirely once you chose to start over completely.
   - `git init`, added a `.gitignore` (`node_modules/`, `dist/`, `.turbo/`,
     `.env`), made an initial commit.

2. **Scaffolded a turborepo skeleton** with the official tool:
   ```
   bunx create-turbo@latest .
   ```
   This generated `apps/docs`, `apps/web` (both Next.js demo apps),
   `packages/ui` (shared demo components), `packages/eslint-config`,
   `packages/typescript-config`, plus root `package.json` / `turbo.json`.

3. **Cleaned up the scaffold**:
   - Deleted `apps/docs` (demo docs site, unrelated to the project).
   - Deleted `packages/ui` (demo UI components you don't need).
   - `apps/web` also got deleted along the way (originally by accident,
     but fine — it was only demo content anyway). It will be recreated
     from scratch with `create-next-app` once you get to the frontend.
   - Kept `packages/eslint-config` and `packages/typescript-config` —
     shared lint rules / shared `tsconfig.json` base settings used by
     every package in the repo.

4. **Fixed a Node.js version problem.** `next dev` failed because your
   system-wide Node.js was v20.1.0, but Next.js 16 needs >=20.9.0 (this
   matters even though you use Bun as the package manager, because
   `next`'s CLI shells out to the real system `node.exe`). Fixed via:
   ```
   winget install OpenJS.NodeJS.LTS
   ```
   Verified with `node -v` afterward.

5. **Created `packages/chess`** — the shared rules-engine package that both
   the server and the web app depend on.
   - `packages/chess/package.json`: named `@repo/chess`, `"type": "module"`,
     `"main": "./src/index.ts"` (Bun runs TypeScript directly, no build
     step needed yet), depends on `chess.js`, dev-depends on
     `@repo/typescript-config` for shared compiler settings.
   - `packages/chess/tsconfig.json`: `extends` the shared
     `@repo/typescript-config/base.json` instead of repeating compiler
     options.
   - Ran `bun install` — confirmed in `bun.lock` that `@repo/chess` is
     recognized as a workspace package and `chess.js@1.4.0` resolved
     correctly.

6. **Explored the `chess.js` API hands-on** via `packages/chess/src/scratch.ts`
   before writing any real code — starting position, making a legal move
   and inspecting the returned object's shape, confirming illegal moves
   *throw* rather than returning falsy, comparing verbose vs plain
   `.moves()` output, state-reading methods (`fen()`, `turn()`,
   `isCheckmate()`, `isDraw()`), and playing out a scripted checkmate.

7. **Built the `ChessGame` class** in `packages/chess/src/index.ts`, piece
   by piece (types → constructor → `move()` → `getState()` → `legalMoves()`
   → `resign()`), typechecking after each addition. Final shape:
   - `Color`, `GameStatus` — string literal union types.
   - `GameState` — the full snapshot shape (`fen`, `turn`, `status`,
     `winner`, `lastMove`).
   - `move(from, to, promotion?)` — refuses to move if the game already
     ended; otherwise calls `chess.js`, letting illegal-move errors
     **propagate uncaught** (a deliberate choice, revisited once the
     server exists and it's clear whether catching here or at the call
     site is more useful in practice).
   - `getState()` — translates `chess.js`'s raw state (`"w"`/`"b"`, etc.)
     into the app's own `Color`/`GameStatus` types.
   - `legalMoves(square)` — for the future UI, to highlight valid target
     squares.
   - `resign(color)` — ends the game outside normal chess rules, so it's
     handled entirely in this class rather than via `chess.js`.
   - Along the way: covered generics (`ServerWebSocket<SocketData>`-style
     syntax preview via `Map<K, V>`), discriminated unions, `try/catch`
     for a throwing library call, `private`/`readonly` field access.

8. **Built `apps/server` completely — the full WebSocket game server.**
   - `apps/server/package.json`: named `server`, depends on `@repo/chess`,
     dev-depends on `@types/bun` for Bun's runtime types.
   - `apps/server/tsconfig.json`: extends the shared base config. Hit and
     fixed a real bug here — `"types": ["bun-types"]` was wrong; the
     installed package is `@types/bun`, and TypeScript's `types` array
     wants the unscoped name (`"bun"`), not the old package name
     (`"bun-types"`). Fixed, typecheck passes clean.
   - Designed the room/connection tracking (before writing code) using a
     "list the nouns, draw arrows between them, only then pick a data
     structure per arrow" process: connection -> playerId -> gameId ->
     room -> game. Traced a full example (Alice creates a game, Bob joins
     it) through concrete `Map` values to make it click. Landed on fixed
     `white`/`black` fields over a `Map<playerId, Player>` (see decisions
     above) — a `Set` for spectators was discussed as a future addition,
     not built.
   - Designed the message protocol as two discriminated unions, before
     writing the handler logic:
     ```ts
     type ClientMessage =
       | { type: "create_game" }
       | { type: "join_game"; gameId: string }
       | { type: "move"; from: string; to: string; promotion?: string }
       | { type: "resign" };

     type ServerMessage =
       | { type: "game_created"; gameId: string; color: Color; state: GameState }
       | { type: "game_joined"; gameId: string; color: Color; state: GameState }
       | { type: "state_update"; state: GameState }
       | { type: "error"; message: string };
     ```
   - Wrote `send`/`broadcast`/`getRoom` helpers, then `Bun.serve(...)` with
     `fetch` handling the WebSocket upgrade (assigning each connection a
     random `playerId` via `server.upgrade(request, { data: {...} })`) and
     `websocket: { open, message, close }` lifecycle handlers.
   - Implemented all four message handlers in `message(socket, raw)`,
     one at a time, typechecking after each:
     - `create_game` — makes a room, creator becomes white.
     - `join_game` — validates the room exists and isn't full, joiner
       becomes black, broadcasts `state_update` to both so white also
       learns someone connected (a repurposed use of `state_update` rather
       than a dedicated "opponent joined" message — a known simplification).
     - `move` — looks up the room via `getRoom(socket)`, checks
       `socket.data.color` matches whose turn it is (the server enforces
       turn order; `ChessGame` itself doesn't know who's asking), wraps
       `room.game.move(...)` in `try/catch` since it throws on illegal
       moves. This resolved the open design question from `packages/chess`:
       catching at the call site (here) turned out to be the natural place.
     - `resign` — needs an extra `!socket.data.color` guard beyond just
       `!room`, since `ChessGame.resign` requires a real `Color`, not
       `Color | undefined`.
   - Along the way: covered `Bun.serve`'s `fetch`/`upgrade` pattern (and
     cleared up a mix-up with client-side `fetch`/axios — this one runs the
     *opposite* direction, handling incoming requests, not making outgoing
     ones), `type` vs `interface`, optional (`?:`) vs `| undefined`,
     truthiness/`!`, and why `const` helpers declared after `Bun.serve(...)`
     still work (they're only called later, from inside event callbacks,
     not at module-load time).

9. **Tested the server end-to-end, two ways.**
   - Wrote `apps/server/src/test-client.ts` — opens two `WebSocket`
     connections (simulating white and black), chaining each action inside
     the *previous* response's `.onmessage` handler (create -> on
     `game_created`, join -> on `game_joined`, move), since each step
     depends on data the server hasn't sent back yet. Ran it against a
     live server: create/join/move all worked, `state_update` correctly
     broadcast to both connections after the move.
   - Also tested manually via two browser tabs' DevTools console —
     `new WebSocket(...)`, `ws.onmessage`, `ws.send(JSON.stringify(...))` —
     to directly exercise the turn-order and illegal-move error paths.

10. **Extracted the message protocol into its own shared package,
    `packages/protocol`.** Same reasoning as the earlier `chess.js`
    duplication discussion: `ClientMessage`/`ServerMessage` were only
    defined inside `apps/server/src/server.ts`, and `apps/web` was about
    to need the exact same shapes — rather than retyping them, moved them
    to `@repo/protocol` (depends on `@repo/chess` for `Color`/`GameState`),
    imported by both `apps/server` and `apps/web`. Both typecheck clean
    against the shared types.

11. **Rebuilt `apps/web` and built the full UI, piece by piece.**
    - Recreated with `create-next-app` (kept Next.js, as decided earlier).
      Added `@repo/eslint-config`/`@repo/typescript-config`/`@repo/chess`/
      `@repo/protocol` as dependencies. Hit and fixed two real bugs here:
      a trailing comma in `package.json` (invalid in JSON, unlike a plain
      JS object literal) causing a Tailwind/PostCSS parse error that
      *survived* killing and restarting the dev server — traced to
      Next.js/Turbopack's on-disk `.next/` cache holding the stale failure;
      fixed by deleting that folder. Also added a missing `"typecheck"`
      script to `apps/web/package.json` (the `create-next-app` scaffold
      never included one).
    - **Stage 1** — `"use client"` component with `useState`/`useEffect`
      opening a `WebSocket` to the server, showing connection status.
      Covered: Server vs Client Components, why the socket setup lives in
      `useEffect` with `[]` (run once, not on every re-render) plus its
      cleanup function (`return () => socket.close()`).
    - **Stage 2** — typed message handling using `@repo/protocol`'s types,
      a `create_game` button, storing `gameId`/`color`/`gameState`/`error`
      in state as messages arrive.
    - **Stage 3** — rendering an actual 8x8 board: `boardFromFen(fen)`
      turns the FEN piece-placement field into a flat 64-square array
      (`.split("/")` into ranks, then expand each rank's digits into empty
      squares via `Array(n).fill("")`, `.flatMap` to flatten rank-groups
      into one array — covered in detail, including tracing `"4P3"`
      character by character). CSS Grid (`gridTemplateColumns: repeat(8,
      50px)`) plus `(row + col) % 2` for checkerboard coloring, `index`
      -> `row`/`col` via `Math.floor(index / 8)` / `index % 8`.
    - **Stage 4** — join-game UI (controlled `<input>` + button). Hit a
      real layout/logic bug: the join UI was nested inside `{gameState &&
      (...)}` (so it never appeared on a fresh tab with no game yet) *and*
      was an accidental 65th child of the board's CSS grid. Fixed by
      moving it to always render, outside the grid.
    - **Stage 5** — click-to-move: `selected` state holds the first click's
      square (or nothing); a second click sends the actual `move` message,
      then resets. `squareName(index)` converts a clicked grid position
      back to a real square name (`52` -> `"e2"`) — the reverse of
      `boardFromFen`'s indexing, using the same `row`/`col` math. Client
      does a turn-order check before allowing a click to start a move (a
      UX nicety only — the server remains the authority and would reject
      it anyway), but does *not* duplicate move-legality checking:
      an illegal `from`/`to` just comes back as a server `error`, same
      principle as keeping chess rules in one shared place.
    - **Tested end-to-end with two real browser tabs**: create in tab 1,
      join in tab 2 using the room code, click-to-move a full turn,
      confirmed both tabs' boards update together.

12. **Added a resign button** — `{gameState && gameState.status === "active"
    && (<button onClick={() => sendMessage({ type: "resign" })}>...`. The
    `status === "active"` check hides it once the game's already over, so
    you can't send a pointless resign on a finished game. Hit and fixed a
    real JSX bug while adding it: pasted the button in a way that left a
    stray `&&` glued onto the board's closing `</div>` plus mismatched
    braces — fixed by keeping the board and the resign button as two
    separate, independently-closed `{condition && (...)}` blocks rather
    than trying to chain them together with `&&`. Tested and confirmed
    working across both tabs.

13. **Added legal-move highlighting.** Reused `ChessGame.legalMoves`
    (built back in `packages/chess`, unused until now) directly from the
    web app: `new ChessGame(gameState.fen).legalMoves(selected)` builds a
    disposable, temporary `ChessGame` purely to ask "what can move from
    the selected square," recomputed each render — not the authoritative
    game (the server still holds that), just a local FEN-derived query.
    Extended the square's `backgroundColor` ternary with one more branch
    for squares in `legalTargets`. Confirmed working: selecting a piece
    now visibly lights up its legal destinations.

## Current repo state

```
apps/
  server/   Complete and tested. package.json, tsconfig.json,
            src/server.ts (full WebSocket server, all 4 message types),
            src/test-client.ts (two-socket test script).
  web/      Complete and tested. Next.js app, single page
            (app/page.tsx): connects, create/join UI, renders the board
            from FEN, click-to-move, all typed against @repo/protocol.
packages/
  chess/      @repo/chess — ChessGame class finished and typechecking
  protocol/   @repo/protocol — shared ClientMessage/ServerMessage types
  eslint-config/       from create-turbo, untouched
  typescript-config/   from create-turbo, untouched (shared base.json)
```

The core app is functionally complete and working: two players can create
a room, join it, and play a full game of chess against each other through
the browser.

## Next step (not done yet)

No fixed next step right now — create/join/move/resign, and legal-move
highlighting, are all done and working. Remaining possible directions:
clean up leftover debug `console.log`s and the raw JSON state dump in
`page.tsx`; handle checkmate/draw/resignation end states visually instead
of just raw status text (and stop allowing further clicks once the game
is over); pawn promotion UI (the server accepts a `promotion` field,
nothing sends one yet); move `pieceSymbols`/`boardFromFen`/`squareName`
back outside the component so they aren't recreated every render.
