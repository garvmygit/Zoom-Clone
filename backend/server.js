// backend/server.js
const express = require("express");
const app = express();
const http = require("http").Server(app);
const io = require("socket.io")(http);
const path = require("path");

// Serve static files
app.use(express.static(path.join(__dirname, "../frontend/public")));

// Routes
const routes = require("./routes/index");
app.use("/", routes);

// WebSocket Signaling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", (roomId, userId) => {
    socket.join(roomId);
    console.log(`User ${userId} joined room: ${roomId}`);
    socket.to(roomId).emit("user-connected", userId);

    // Relay WebRTC offer, answer, and ICE candidates
    socket.on("offer", (data) => {
      socket.to(roomId).emit("offer", data);
    });

    socket.on("answer", (data) => {
      socket.to(roomId).emit("answer", data);
    });

    socket.on("ice-candidate", (data) => {
      socket.to(roomId).emit("ice-candidate", data);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", userId);
      socket.to(roomId).emit("user-disconnected", userId);
    });
  });
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
