/* room.js - Zoom Clone client (WebRTC mesh) */
const socket = io();
const ROOM_ID = window.ROOM_ID;
const USER_NAME = window.USER_NAME || `User-${Math.floor(Math.random() * 9000)}`;

const grid = document.getElementById("gallery");
const stageWrap = document.getElementById("stage-video-wrap");
const stageName = document.getElementById("stage-name");
const participantsList = document.getElementById("participants-list");
const participantsCount = document.getElementById("participants-count");
const messagesEl = document.getElementById("messages");

const muteBtn = document.getElementById("muteBtn");
const videoBtn = document.getElementById("videoBtn");
const shareBtn = document.getElementById("shareBtn");
const leaveBtn = document.getElementById("leaveBtn");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const raiseHandBtn = document.getElementById("raiseHandBtn");
const recordBtn = document.getElementById("recordBtn");

const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let localStream = null;
let screenStream = null;
let pinned = null;
let layoutMode = "gallery"; // gallery | stage
const peers = new Map(); // socketId -> { pc, videoEl, name, senders }

// ----------------- UTILS -----------------
function generateId() {
  return "u" + Math.floor(Math.random() * 1000000);
}

// ----------------- UI -----------------
function createTile(id, name, isSelf = false) {
  const wrapper = document.createElement("div");
  wrapper.className = "tile";
  wrapper.dataset.id = id;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  if (isSelf) video.muted = true;

  const badge = document.createElement("div");
  badge.className = "badge-name";
  badge.textContent = name;

  wrapper.appendChild(video);
  wrapper.appendChild(badge);
  grid.appendChild(wrapper);

  return { wrapper, video };
}

function showOnStage(videoEl, name) {
  stageWrap.innerHTML = "";
  const box = document.createElement("div");
  box.style.width = "100%";
  box.appendChild(videoEl);
  stageWrap.appendChild(box);
  stageName.textContent = name;
}

function appendMessage(name, msg, self = false) {
  const li = document.createElement("li");
  li.innerHTML = `<strong>${name}:</strong> ${msg}`;
  if (self) li.style.opacity = "0.8";
  messagesEl.appendChild(li);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
}

function floatReaction(emoji) {
  const el = document.createElement("div");
  el.className = "reaction";
  el.textContent = emoji;
  el.style.position = "absolute";
  el.style.right = `${Math.random() * 40 + 10}%`;
  el.style.bottom = "70px";
  el.style.fontSize = "26px";
  el.style.opacity = "0.95";
  document.body.appendChild(el);
  setTimeout(() => (el.style.transform = "translateY(-120px)"), 50);
  setTimeout(() => el.remove(), 2400);
}

function updateParticipantsUI() {
  participantsList.innerHTML = "";
  let count = 1; // self
  peers.forEach((entry, id) => {
    if (id === "self") return;
    count++;
    const li = document.createElement("li");
    li.innerHTML = `<div class="d-flex align-items-center justify-content-between w-100">
      <div><img src="/assets/logos/logo.png" alt="avatar" onerror="this.style.display='none'"> <strong>${entry.name || id}</strong></div>
      <div><button class="btn btn-sm btn-outline-light btn-pin" data-id="${id}">Pin</button></div>
    </div>`;
    participantsList.appendChild(li);
  });
  participantsCount.textContent = count;

  document.querySelectorAll(".btn-pin").forEach((btn) => {
    btn.onclick = () => {
      pinned = btn.dataset.id;
      const entry = peers.get(pinned);
      if (entry?.videoEl) showOnStage(entry.videoEl, entry.name);
    };
  });
}

// ----------------- MEDIA -----------------
async function setupLocalMedia() {
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640 }, audio: true });
  const { video } = createTile("self", `${USER_NAME} (You)`, true);
  video.srcObject = localStream;
  peers.set("self", { pc: null, videoEl: video, name: USER_NAME, senders: [] });
  showOnStage(video, `${USER_NAME} (You)`);
}

function addLocalTracks(pc, remoteId) {
  const entry = peers.get(remoteId) || { senders: [] };
  entry.senders = [];
  localStream.getTracks().forEach((t) => {
    const sender = pc.addTrack(t, localStream);
    entry.senders.push(sender);
  });
  peers.set(remoteId, entry);
}

async function replaceVideoTrackForAll(newTrack) {
  for (const [id, entry] of peers.entries()) {
    if (id === "self" || !entry?.pc) continue;
    const sender = entry.pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(newTrack);
  }
}

// ----------------- PEER CONNECTION -----------------
function createPeerConnection(remoteId) {
  const pc = new RTCPeerConnection(ICE_CONFIG);

  pc.ontrack = (ev) => {
    const stream = ev.streams[0];
    const entry = peers.get(remoteId) || {};
    if (entry.videoEl) entry.videoEl.srcObject = stream;
    else {
      const { video } = createTile(remoteId, entry.name || remoteId);
      video.srcObject = stream;
      entry.videoEl = video;
      peers.set(remoteId, entry);
    }
    if (pinned === remoteId) showOnStage(peers.get(remoteId).videoEl, peers.get(remoteId).name);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("signal", { to: remoteId, data: { candidate: e.candidate } });
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) removePeer(remoteId);
  };

  return pc;
}

async function callPeer(remoteId, name) {
  if (!localStream) await setupLocalMedia();
  const pc = createPeerConnection(remoteId);
  peers.set(remoteId, { pc, videoEl: null, name: name || remoteId, senders: [] });
  addLocalTracks(pc, remoteId);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: remoteId, data: { sdp: pc.localDescription } });
}

async function handleSignal(from, data) {
  let entry = peers.get(from);
  if (!entry?.pc) {
    const pc = createPeerConnection(from);
    entry = peers.get(from) || { pc, videoEl: null, name: from, senders: [] };
    entry.pc = pc;
    peers.set(from, entry);
    addLocalTracks(pc, from);
  }
  const pc = entry.pc;
  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { to: from, data: { sdp: pc.localDescription } });
    }
  } else if (data.candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.warn);
  }
}

function removePeer(id) {
  const entry = peers.get(id);
  if (!entry) return;
  entry.pc?.close();
  if (entry.videoEl?.parentElement?.parentElement) entry.videoEl.parentElement.parentElement.remove();
  peers.delete(id);
  updateParticipantsUI();
}

// ----------------- EVENTS -----------------
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("message", { roomId: ROOM_ID, userName: USER_NAME, msg: text });
  appendMessage(USER_NAME, text, true);
  chatInput.value = "";
});

muteBtn.addEventListener("click", () => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  muteBtn.textContent = track.enabled ? "Mute" : "Unmute";
});

videoBtn.addEventListener("click", () => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  videoBtn.textContent = track.enabled ? "Stop Video" : "Start Video";
});

shareBtn.addEventListener("click", async () => {
  try {
    if (!screenStream) {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = screenStream.getVideoTracks()[0];
      await replaceVideoTrackForAll(track);
      const selfEntry = peers.get("self");
      if (selfEntry?.videoEl) selfEntry.videoEl.srcObject = screenStream;
      track.onended = async () => {
        const camTrack = localStream.getVideoTracks()[0];
        await replaceVideoTrackForAll(camTrack);
        if (selfEntry?.videoEl) selfEntry.videoEl.srcObject = localStream;
        screenStream = null;
      };
      shareBtn.textContent = "Stop Share";
    } else {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
      shareBtn.textContent = "Share Screen";
    }
  } catch (e) {
    console.warn("Screen share failed", e);
  }
});

leaveBtn.addEventListener
