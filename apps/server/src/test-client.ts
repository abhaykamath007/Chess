const white = new WebSocket("ws://localhost:3001");
const black = new WebSocket("ws://localhost:3001");

white.onmessage = (event) => {
  console.log("white received:", event.data);
  const message = JSON.parse(String(event.data));

  if (message.type === "game_created") {
    black.send(JSON.stringify({ type: "join_game", gameId: message.gameId }));
  }
};

black.onmessage = (event) => {
  console.log("black received:", event.data);
  const message = JSON.parse(String(event.data));

  if (message.type === "game_joined") {
    white.send(JSON.stringify({ type: "move", from: "e2", to: "e4" }));
  }
};

white.onopen = () => {
  white.send(JSON.stringify({ type: "create_game" }));
};
