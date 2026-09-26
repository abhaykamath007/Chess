import {Chess} from "chess.js";

const game = new Chess();
console.log(game.ascii());

const result = game.move({from: "e2", to: "e4"});
console.log(result);
console.log(game.ascii());

// try {
//     const bad = game.move({from: "e2", to: "e5"});
//     console.log("returned", bad);
// } catch (error) {
//     console.error("Error occurred:", error);
// }
console.log(game.turn());
game.move({from: "e7", to: "e6"});
console.log(game.moves({square: "g1", verbose: true}));
console.log(game.moves({square: "g1", verbose: false}));

console.log("fen:", game.fen());
console.log("turn:", game.turn());
console.log("isCheck:", game.isCheck());
console.log("isCheckmate:", game.isCheckmate());
console.log("isDraw:", game.isDraw());
console.log("isGameOver:", game.isGameOver());

const g2 = new Chess();
g2.move("f3");
g2.move("e5");
g2.move("g4");
g2.move("Qh4");
console.log(g2.ascii());
console.log("isCheckmate:", g2.isCheckmate());
console.log("turn:", g2.turn());
