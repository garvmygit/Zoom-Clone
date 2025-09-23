// ====== MAIN.JS - Zoom Clone Client ======

// Socket.IO connection
const socket = io();

// Get roomId and displayName from EJS or URL
const roomId = typeof ROOM_ID !== "undefined" && ROOM_ID
  ? ROOM_ID
  : new URLSearchParams(location.search).get("room");

const displayName = window.USER_NAME || localStorage.getItem("zoomclone_name") || `user-${Math.floor(Math.random() * 1000)}`;
localStorage.setItem("zoomclone_name", displayName);

// DOM Elements
const grid = document.getElementById("video-grid");
const muteBtn = document.getElementById("muteBtn");
const videoBtn = document.getElementById("videoBtn");
const shareBtn = document.getElementById("shareBtn");
const leaveBtn = document.getElementById("leaveBtn");

// State
let localStream = null;
let screenStream = null;
const peers = new Map(); // socketId -> { pc, videoEl, name, senders }

// ICE configuration
const ICE_CONFIG = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] },
    // Add TURN server if needed
  ],
};

// ====== MEDIA SETUP ======
async function getLocalMedia() {
  if (localStream) return localStream;

  localStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });

  addLocalTile(localStream, displayName);
  return localStream;
}

function addLocalTile(stream, name) {
  const videoEl = createVideoTile("You", stream, true);
  peers.set("self", { pc: null, videoEl, name: "You", senders: [] });
}

function createVideoTile(label, stream, isSelf = false) {
  const wrapper = document.createElement("div");
  wrapper.className = "col-12 col-sm-6 col-md-4 col-lg-3";

  const box = document.createElement("div");
  box.className = "position-relative bg-black rounded-3 overflow-hidden shadow";

  const video = document.createElement("video");
  video.playsInline = true;
  video.autoplay = true;
  if (isSelf) video.muted = true;
  video.srcObject = stream;

  const nameTag = document.createElement("div");
  nameTag.className = "position-absolute bottom-0 start-0 m-2 px-2 py-1 rounded-2 text-white bg-dark bg-opacity-50";
  nameTag.style.fontSize = "0.85rem";
  nameTag.textContent = label;

  box.appendChild(video);
  box.appendChild(nameTag);
  wrapper.appendChild(box);
  grid.appendChild(wrapper);

  video.addEventListener("loadedmetadata", () => video.play().catch(() => {}));

  return video;
}

// ====== PEER CONNECTION HELPERS ======
function createPeerConnection(remoteId, label) {
  const pc = new RTCPeerConnection(ICE_CONFIG);

  pc.ontrack = (event) => {
    const existing = peers.get(remoteId);
    if (existing?.videoEl) return;

    const videoEl = createVideoTile(label || remoteId, event.streams[0]);
    peers.set(remoteId, { pc, videoEl, name: label, senders: [] });
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { to: remoteId, data: { candidate: event.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) removePeer(remoteId);
  };

  const entry = peers.get(remoteId) || { pc, videoEl: null, name: label, senders: [] };
  entry.pc = pc;
  peers.set(remoteId, entry);

  return pc;
}

function removePeer(remoteId) {
  const entry = peers.get(remoteId);
  if (!entry) return;

  entry.pc?.close();
  if (entry.videoEl?.parentElement?.parentElement) entry.videoEl.parentElement.parentElement.remove();

  peers.delete(remoteId);
}

function addLocalTracksTo(pc, remoteId) {
  const entry = peers.get(remoteId) || { senders: [] };
  entry.senders = [];
  localStream.getTracks().forEach(track => {
    const sender = pc.addTrack(track, localStream);
    entry.senders.push(sender);
  });
  peers.set(remoteId, entry);
}

async function replaceVideoTrackForAll(newTrack) {
  for (const [id, entry] of peers.entries()) {
    if (id === "self" || !entry?.pc) continue;

    const sender = entry.pc.getSenders().find(s => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(newTrack);
  }
}

// ====== SIGNALING ======
async function joinRoom() {
  if (!roomId) return alert("No room specified.");

  await getLocalMedia();
  socket.emit("join", { roomId, user: displayName });

  socket.on("peers", ({ peers: existing }) => {
    existing.forEach(peerId => callPeer(peerId));
  });

  socket.on("peer-joined", ({ socketId, user }) => {
    callPeer(socketId, user);
  });

  socket.on("peer-left", ({ socketId }) => removePeer(socketId));

  socket.on("signal", async ({ from, data }) => {
    let entry = peers.get(from);
    if (!entry?.pc) {
      const pc = createPeerConnection(from, from);
      addLocalTracksTo(pc, from);
      entry = peers.get(from);
    }

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
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e) { console.warn(e); }
    }
  });
}

async function callPeer(remoteId, label) {
  const pc = createPeerConnection(remoteId, label);
  addLocalTracksTo(pc, remoteId);

  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: remoteId, data: { sdp: pc.localDescription } });
}

// ====== UI CONTROLS ======
muteBtn?.addEventListener("click", () => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  muteBtn.classList.toggle("btn-light");
  muteBtn.classList.toggle("btn-outline-light");
});

videoBtn?.addEventListener("click", () => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  videoBtn.classList.toggle("btn-light");
  videoBtn.classList.toggle("btn-outline-light");
});

shareBtn?.addEventListener("click", async () => {
  try {
    if (!screenStream) {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = screenStream.getVideoTracks()[0];
      await replaceVideoTrackForAll(track);
      const self = peers.get("self");
      if (self?.videoEl) self.videoEl.srcObject = screenStream;

      track.onended = async () => {
        const camTrack = localStream.getVideoTracks()[0];
        await replaceVideoTrackForAll(camTrack);
        if (self?.videoEl) self.videoEl.srcObject = localStream;
        screenStream = null;
      };
    } else {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }
  } catch (e) { console.warn("Screen share failed", e); }
});

leaveBtn?.addEventListener("click", () => {
  peers.forEach((_, id) => { if (id !== "self") removePeer(id); });
  localStream?.getTracks().forEach(t => t.stop());
  window.location.href = "/";
});

// ====== INIT ======
(async function init() {
  try {
    await joinRoom();
  } catch (e) {
    console.error(e);
    alert("Could not join room or access media.");
  }
})();
