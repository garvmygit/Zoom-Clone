// backend/server.js
const express = require("express");
const path = require("path");
const http = require("http");
const { v4: uuidV4 } = require("uuid");
const socketIO = require("socket.io");
const morgan = require("morgan");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 5000;

// Logging requests
app.use(morgan("dev"));

// Set EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../frontend/views"));

// Serve static files (CSS, JS, images)
app.use(express.static(path.join(__dirname, "../frontend/public")));

// Routes
app.get("/", (req, res) => {
  res.render("index");
});

// Generate unique room and redirect
app.get("/room", (req, res) => {
  const roomId = req.query.id || uuidV4();
  res.render("room", { roomId });
});

// Socket.io connection
io.on("connection", (socket) => {
  socket.on("join-room", (roomId, userId) => {
    socket.join(roomId);
    socket.to(roomId).emit("user-connected", userId);

    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-disconnected", userId);
    });
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Backend server running at http://localhost:${PORT}`);
});
