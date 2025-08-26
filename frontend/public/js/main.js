// ====== BASIC CONFIG ======
const socket = io(); // Connect to your Express + Socket.IO server

// Get roomId from EJS or URL (?room=xxxx)
const roomId =
  typeof ROOM_ID !== "undefined" && ROOM_ID
    ? ROOM_ID
    : new URLSearchParams(location.search).get("room");

// Optional: get a display name (fallback to random)
const displayName =
  window.USER_NAME ||
  localStorage.getItem("zoomclone_name") ||
  `user-${Math.floor(Math.random() * 1000)}`;
localStorage.setItem("zoomclone_name", displayName);

// DOM elements
const grid = document.getElementById("video-grid");
const muteBtn = document.getElementById("muteBtn");
const videoBtn = document.getElementById("videoBtn");
const shareBtn = document.getElementById("shareBtn");
const leaveBtn = document.getElementById("leaveBtn");

// State
let localStream = null;
let screenStream = null;
const peers = new Map(); // socketId -> { pc, videoEl, name, senders: [] }

// ICE servers (use your TURN here for reliability)
const iceConfig = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] },
    // { urls: ["turn:your.turn.server:3478"], username: "user", credential: "pass" },
  ],
};

// ====== MEDIA SETUP ======
async function getLocalMedia() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  addLocalTile(localStream, displayName);
  return localStream;
}

function addLocalTile(stream, name) {
  const el = createVideoTile("You", stream, true);
  // Keep reference so we can update if needed
  peers.set("self", { pc: null, videoEl: el, name: "You", senders: [] });
}

function createVideoTile(label, stream, isSelf = false) {
  const wrapper = document.createElement("div");
  wrapper.className = "col-12 col-sm-6 col-md-4 col-lg-3";

  const box = document.createElement("div");
  box.className = "position-relative bg-black rounded-3 overflow-hidden shadow";

  const v = document.createElement("video");
  v.playsInline = true;
  v.autoplay = true;
  if (isSelf) v.muted = true;
  v.srcObject = stream;

  const nameTag = document.createElement("div");
  nameTag.className =
    "position-absolute bottom-0 start-0 m-2 px-2 py-1 rounded-2 text-white bg-dark bg-opacity-50";
  nameTag.style.fontSize = "0.85rem";
  nameTag.textContent = label;

  box.appendChild(v);
  box.appendChild(nameTag);
  wrapper.appendChild(box);
  grid.appendChild(wrapper);

  // Ensure play after metadata loads
  v.addEventListener("loadedmetadata", () => v.play().catch(() => {}));
  return v;
}

// ====== PEER CONNECTION HELPERS ======
function createPeerConnection(remoteId, label) {
  const pc = new RTCPeerConnection(iceConfig);

  // Create a tile for the remote stream when it arrives
  pc.ontrack = (event) => {
    const existing = peers.get(remoteId);
    if (existing && existing.videoEl) return; // already created
    const videoEl = createVideoTile(label || remoteId, event.streams[0], false);
    const s = peers.get(remoteId);
    if (s) s.videoEl = videoEl;
    else peers.set(remoteId, { pc, videoEl, name: label, senders: [] });
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { to: remoteId, data: { candidate: event.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === "failed" || st === "disconnected" || st === "closed") {
      removePeer(remoteId);
    }
  };

  // Track senders so we can replace tracks (screen share)
  const entry = peers.get(remoteId) || { pc, videoEl: null, name: label, senders: [] };
  entry.pc = pc;
  peers.set(remoteId, entry);
  return pc;
}

function removePeer(remoteId) {
  const entry = peers.get(remoteId);
  if (!entry) return;
  try {
    if (entry.pc) {
      entry.pc.getSenders().forEach((s) => s.track && s.track.stop && s.track.stop());
      entry.pc.close();
    }
  } catch {}
  if (entry.videoEl && entry.videoEl.parentElement?.parentElement) {
    entry.videoEl.parentElement.parentElement.remove();
  }
  peers.delete(remoteId);
}

// Add local tracks to pc and store senders
function addLocalTracksTo(pc, remoteId) {
  const entry = peers.get(remoteId);
  if (!entry) return;

  entry.senders = [];
  localStream.getTracks().forEach((track) => {
    const sender = pc.addTrack(track, localStream);
    entry.senders.push(sender);
  });
  peers.set(remoteId, entry);
}

// Replace video track for screen share / camera switch
async function replaceVideoTrackForAll(newTrack) {
  for (const [id, entry] of peers.entries()) {
    if (id === "self" || !entry || !entry.pc) continue;
    const sender = entry.pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");
    if (sender) await sender.replaceTrack(newTrack);
  }
}

// ====== SIGNALING FLOW ======
async function joinRoom() {
  if (!roomId) {
    alert("No room specified. Add ?room=ROOM_ID to the URL or set ROOM_ID in EJS.");
    return;
  }
  await getLocalMedia();

  socket.emit("join", { roomId, user: displayName });

  // Receive current peers
  socket.on("peers", async ({ peers: existingPeers }) => {
    // Create offers to existing peers
    for (const peerId of existingPeers) {
      await callPeer(peerId);
    }
  });

  // New peer joined later
  socket.on("peer-joined", async ({ socketId, user }) => {
    await callPeer(socketId, user);
  });

  // Peer left
  socket.on("peer-left", ({ socketId }) => {
    removePeer(socketId);
  });

  // Handle signaling data
  socket.on("signal", async ({ from, data }) => {
    let entry = peers.get(from);
    if (!entry || !entry.pc) {
      const pc = createPeerConnection(from, from);
      addLocalTracksTo(pc, from);
    }
    entry = peers.get(from);
    const pc = entry.pc;

    if (data.sdp) {
      const desc = new RTCSessionDescription(data.sdp);
      await pc.setRemoteDescription(desc);
      if (desc.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", { to: from, data: { sdp: pc.localDescription } });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.warn("Error adding ICE candidate", e);
      }
    }
  });
}

async function callPeer(remoteId, label) {
  // Create connection + add tracks
  const pc = createPeerConnection(remoteId, label);
  addLocalTracksTo(pc, remoteId);

  // Create offer
  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: remoteId, data: { sdp: pc.localDescription } });
}

// ====== UI CONTROLS ======
function wireControls() {
  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      if (!localStream) return;
      const track = localStream.getAudioTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      muteBtn.classList.toggle("btn-outline-light");
      muteBtn.classList.toggle("btn-light");
      muteBtn.title = track.enabled ? "Mute" : "Unmute";
    });
  }

  if (videoBtn) {
    videoBtn.addEventListener("click", () => {
      if (!localStream) return;
      const track = localStream.getVideoTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      videoBtn.classList.toggle("btn-outline-light");
      videoBtn.classList.toggle("btn-light");
      videoBtn.title = track.enabled ? "Stop Video" : "Start Video";
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      try {
        if (!screenStream) {
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
          const screenTrack = screenStream.getVideoTracks()[0];
          await replaceVideoTrackForAll(screenTrack);

          // Show local tile as screen too
          const self = peers.get("self");
          if (self?.videoEl) self.videoEl.srcObject = screenStream;

          // When user stops sharing, revert to camera
          screenTrack.onended = async () => {
            if (!localStream) return;
            const camTrack = localStream.getVideoTracks()[0];
            await replaceVideoTrackForAll(camTrack);
            if (self?.videoEl) self.videoEl.srcObject = localStream;
            screenStream.getTracks().forEach((t) => t.stop());
            screenStream = null;
          };
        } else {
          // Stop screen share manually
          screenStream.getTracks().forEach((t) => t.stop());
          const camTrack = localStream.getVideoTracks()[0];
          await replaceVideoTrackForAll(camTrack);
          const self = peers.get("self");
          if (self?.videoEl) self.videoEl.srcObject = localStream;
          screenStream = null;
        }
      } catch (e) {
        console.error("Screen share error:", e);
      }
    });
  }

  if (leaveBtn) {
    leaveBtn.addEventListener("click", () => {
      leaveRoom();
    });
  }
}

function leaveRoom() {
  try {
    socket.emit("leave", { roomId });
  } catch {}
  for (const [id] of peers) {
    if (id !== "self") removePeer(id);
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
  }
  const self = peers.get("self");
  if (self?.videoEl?.parentElement?.parentElement) {
    self.videoEl.parentElement.parentElement.remove();
  }
  peers.clear();
  window.location.href = "/";
}

// ====== INIT ======
(async function init() {
  try {
    wireControls();
    await joinRoom();
  } catch (e) {
    console.error(e);
    alert("Could not start media or join the room.");
  }
})();
