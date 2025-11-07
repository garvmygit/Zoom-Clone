const express = require("express");
const { v4: uuidV4 } = require("uuid");

const router = express.Router();

// Home page
router.get("/", (req, res) => {
  res.render("index");
});

// Create new room
router.get("/create", (req, res) => {
  res.redirect(`/room/${uuidV4()}`);
});

// Room page
router.get("/room/:roomId", (req, res) => {
  res.render("room", { roomId: req.params.roomId });
});

module.exports = router;
