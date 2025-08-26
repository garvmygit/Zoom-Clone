/* room.js - advanced client for Zoom Clone (mesh WebRTC) */
/* Assumes socket.io served at same origin and server handles: join, peers, peer-joined, peer-left, signal events. */

const socket = io();
const grid = document.getElementById("gallery");
const stageWrap = document.getElementById("stage-video-wrap");
const stageName = document.getElementById("stage-name");
const participantsList = document.getElementById("participants-list");
const participantsCount = document.getElementById("participants-count");
const messagesEl = document.getElementById("messages");

const muteBtn = document.getElementById("muteBtn");
const videoBtn = document.getElementById("videoBtn");
const shareBtn = document.getElementById("shareBtn");
const layoutBtn = document.getElementById("layoutBtn");
const leaveBtn = document.getElementById("leaveBtn");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const raiseHandBtn = document.getElementById("raiseHandBtn");
const recordBtn = document.getElementById("recordBtn");

const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let localStream = null;
let screenStream = null;
let userId = socket.id || generateId();
let displayName = (typeof USER_NAME !== "undefined" && USER_NAME) ? USER_NAME : `User-${Math.floor(Math.random()*9000)+1000}`;
const peers = new Map(); // socketId -> { pc, videoEl, name, senders }

let pinned = null; // socketId of pinned (spotlight) user
let layoutMode = "gallery"; // gallery | stage

// Helper to create tile and video element
function createTile(id, name, isSelf=false) {
  const wrapper = document.createElement("div");
  wrapper.className = "tile";
  wrapper.dataset.id = id;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  if (isSelf) video.muted = true;

  const nameBadge = document.createElement("div");
  nameBadge.className = "badge-name";
  nameBadge.textContent = name;

  wrapper.appendChild(video);
  wrapper.appendChild(nameBadge);
  grid.appendChild(wrapper);

  return { wrapper, video };
}

// Stage rendering: move video element into stage
function showOnStage(videoEl, name) {
  // clear stage and append this video
  stageWrap.innerHTML = "";
  const stageBox = document.createElement("div");
  stageBox.style.width = "100%";
  stageBox.appendChild(videoEl);
  stageWrap.appendChild(stageBox);
  stageName.textContent = name;
}

// Add local tile
async function setupLocalMedia() {
  if (localStream) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { width:640 }, audio: true });
  } catch (e) {
    alert("Could not access camera/microphone: " + e.message);
    throw e;
  }
  const { wrapper, video } = createTile("self", `${displayName} (You)`, true);
  video.srcObject = localStream;
  peers.set("self", { pc: null, videoEl: video, name: displayName, senders: [] });

  // show self on stage initially
  showOnStage(video, `${displayName} (You)`);
}

// Create RTCPeerConnection for remote peer
function createPeerConnection(remoteId) {
  const pc = new RTCPeerConnection(ICE);

  pc.ontrack = (ev) => {
    // remote streams delivered here
    const stream = ev.streams[0];
    const entry = peers.get(remoteId) || {};
    if (entry.videoEl) {
      // already have tile, update srcObject (handles screen/camera)
      entry.videoEl.srcObject = stream;
    } else {
      // create new tile
      const { wrapper, video } = createTile(remoteId, entry.name || remoteId, false);
      video.srcObject = stream;
      entry.videoEl = video;
      peers.set(remoteId, entry);
    }
    // If pinned to stage show it
    if (pinned === remoteId) {
      showOnStage(peers.get(remoteId).videoEl, peers.get(remoteId).name);
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("signal", { to: remoteId, data: { candidate: e.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === "failed" || st === "disconnected" || st === "closed") {
      removePeer(remoteId);
    }
  };

  return pc;
}

// Add local tracks to a PC and save senders
function addLocalTracks(pc, remoteId) {
  const entry = peers.get(remoteId) || { senders: [] };
  entry.senders = [];
  localStream.getTracks().forEach(track => {
    const sender = pc.addTrack(track, localStream);
    entry.senders.push(sender);
  });
  peers.set(remoteId, entry);
}

// Replace a track across all peers (used for screen share)
async function replaceVideoTrackForAll(newTrack) {
  for (const [id, entry] of peers.entries()) {
    if (id === "self" || !entry || !entry.pc) continue;
    const sender = entry.pc.getSenders().find(s => s.track && s.track.kind === "video");
    if (sender) {
      try { await sender.replaceTrack(newTrack); } catch (e) { console.warn(e); }
    }
  }
}

// Create offer to a peer
async function callPeer(remoteId, name) {
  if (!localStream) await setupLocalMedia();
  const pc = createPeerConnection(remoteId);
  // store
  peers.set(remoteId, { pc, videoEl: null, name: name || remoteId, senders: [] });

  addLocalTracks(pc, remoteId);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: remoteId, data: { sdp: pc.localDescription } });
}

// Handle incoming signal
async function handleSignal(from, data) {
  let entry = peers.get(from);
  if (!entry || !entry.pc) {
    const pc = createPeerConnection(from);
    entry = peers.get(from) || { pc, videoEl: null, name: from, senders: [] };
    entry.pc = pc;
    peers.set(from, entry);
    addLocalTracks(pc, from);
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
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) { console.warn("ICE add error", e); }
  }
}

// Remove peer UI and close PC
function removePeer(id) {
  const entry = peers.get(id);
  if (!entry) return;
  try { if (entry.pc) entry.pc.close(); } catch (e) {}
  if (entry.videoEl && entry.videoEl.parentElement) {
    const tile = entry.videoEl.parentElement.parentElement;
    if (tile && tile.parentElement) tile.parentElement.removeChild(tile);
  }
  peers.delete(id);
  updateParticipantsUI();
}

// Participants UI
function updateParticipantsUI() {
  const arr = [];
  participantsList.innerHTML = "";
  for (const [id, entry] of peers.entries()) {
    if (id === "self") continue;
    arr.push({ id, name: entry.name || id });
    const li = document.createElement("li");
    li.innerHTML = `<div class="d-flex align-items-center w-100 justify-content-between">
      <div><img src="/assets/logos/logo.png" alt="avatar" onerror="this.style.display='none'"> <strong>${entry.name||id}</strong></div>
      <div><button class="btn btn-sm btn-outline-light btn-pin" data-id="${id}">Pin</button></div>
    </div>`;
    participantsList.appendChild(li);
  }
  participantsCount.textContent = Math.max(0, arr.length + 1); // including self
  // wire pin buttons
  document.querySelectorAll(".btn-pin").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      pinned = id;
      const entry = peers.get(id);
      if (entry && entry.videoEl) showOnStage(entry.videoEl, entry.name);
    };
  });
}

// Chat UI functions
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("message", { roomId: ROOM_ID, userName: displayName, msg: text });
  appendMessage(displayName, text, true);
  chatInput.value = "";
});
function appendMessage(name, text, self=false) {
  const li = document.createElement("li");
  li.innerHTML = `<strong>${name}:</strong> ${text}`;
  if (self) li.style.opacity = "0.8";
  messagesEl.appendChild(li);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
}

// Toggle local audio/video
muteBtn.addEventListener("click", () => {
  if (!localStream) return;
  const t = localStream.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  muteBtn.textContent = t.enabled ? "Mute" : "Unmute";
});
videoBtn.addEventListener("click", () => {
  if (!localStream) return;
  const t = localStream.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  videoBtn.textContent = t.enabled ? "Stop Video" : "Start Video";
});

// Screen share
shareBtn.addEventListener("click", async () => {
  try {
    if (!screenStream) {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      // replace across peers
      await replaceVideoTrackForAll(screenTrack);
      // show on self tile
      const selfEntry = peers.get("self");
      if (selfEntry && selfEntry.videoEl) selfEntry.videoEl.srcObject = screenStream;
      document.getElementById('share-indicator').classList.remove('d-none');

      screenTrack.onended = async () => {
        // revert to camera
        const camTrack = localStream.getVideoTracks()[0];
        await replaceVideoTrackForAll(camTrack);
        if (selfEntry && selfEntry.videoEl) selfEntry.videoEl.srcObject = localStream;
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
        document.getElementById('share-indicator').classList.add('d-none');
      };
      shareBtn.textContent = "Stop Share";
    } else {
      // stop sharing
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
      // revert on all peers handled by onended
      shareBtn.textContent = "Share Screen";
    }
  } catch (e) {
    console.warn("Screen share failed", e);
  }
});

// Leave
leaveBtn.addEventListener("click", () => {
  leaveRoom();
});
function leaveRoom() {
  try { socket.emit("leave", { roomId: ROOM_ID }); } catch(e){}
  for (const [id] of peers) if (id !== "self") removePeer(id);
  if (localStream) localStream.getTracks().forEach(t=>t.stop());
  window.location.href = "/";
}

// Record (local) - optional simple MediaRecorder
recordBtn.addEventListener("click", async () => {
  if (!localStream) { alert("No stream."); return; }
  if (!window._recorder) {
    const recStream = new MediaStream([...localStream.getTracks()]);
    const recorder = new MediaRecorder(recStream);
    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `recording-${Date.now()}.webm`;
      a.click();
      window._recorder = null;
      recordBtn.textContent = "Record (local)";
    };
    recorder.start();
    window._recorder = recorder;
    recordBtn.textContent = "Stop Recording";
  } else {
    window._recorder.stop();
  }
});

// Raise hand (emit UI reaction)
raiseHandBtn.addEventListener("click", () => {
  socket.emit("reaction", { roomId: ROOM_ID, userName: displayName, type: "hand" });
  floatReaction("✋");
});

// reactions: display floating emoji
function floatReaction(emoji) {
  const el = document.createElement("div");
  el.className = "reaction";
  el.textContent = emoji;
  el.style.position = "absolute";
  el.style.right = `${Math.random()*40 + 10}%`;
  el.style.bottom = "70px";
  el.style.fontSize = "26px";
  el.style.opacity = "0.95";
  document.body.appendChild(el);
  setTimeout(()=> el.style.transform = "translateY(-120px)", 50);
  setTimeout(()=> el.remove(), 2400);
}

// Signaling / socket handlers
async function joinRoom() {
  await setupLocalMedia();
  socket.emit("join", { roomId: ROOM_ID, userId: socket.id, userName: displayName });

  // server returns existing peers
  socket.on("peers", async ({ peers: existing }) => {
    for (const peerId of existing) {
      if (peerId === socket.id) continue;
      callPeer(peerId, "Guest");
    }
  });

  socket.on("peer-joined", ({ socketId, user }) => {
    // user is { userId, userName } optionally
    peers.set(socketId, { pc: null, videoEl: null, name: user?.userName || "Guest", senders: [] });
    // create offer to them
    callPeer(socketId, user?.userName);
    updateParticipantsUI();
  });

  socket.on("peer-left", ({ socketId }) => {
    removePeer(socketId);
    updateParticipantsUI();
  });

  socket.on("signal", async ({ from, data }) => {
    await handleSignal(from, data);
    updateParticipantsUI();
  });

  socket.on("message", ({ userName, msg }) => {
    appendMessage(userName, msg, false);
  });

  socket.on("reaction", ({ userName, type }) => {
    // show reaction
    floatReaction(type === "hand" ? "✋" : "✨");
  });

  // initial UI
  updateParticipantsUI();
}

// Utilities
function generateId(){ return 'u'+Math.floor(Math.random()*1000000); }

// start
joinRoom().catch(e => console.error("Join error", e));
