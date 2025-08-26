const socket = io();
const videoGrid = document.getElementById("video-grid");

const myVideo = document.createElement("video");
myVideo.muted = true;

let peerConnection;
let localStream;

// STUN server (for NAT traversal)
const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

async function init(roomId, userId) {
  // Get camera + mic
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  addVideoStream(myVideo, localStream);

  // Join room
  socket.emit("join-room", roomId, userId);

  socket.on("user-connected", (remoteUserId) => {
    console.log("New user connected:", remoteUserId);
    createOffer(remoteUserId);
  });

  socket.on("offer", async (data) => {
    await createAnswer(data);
  });

  socket.on("answer", async (data) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  });

  socket.on("ice-candidate", async (data) => {
    if (data.candidate) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error("Error adding received ICE candidate", err);
      }
    }
  });

  socket.on("user-disconnected", (remoteUserId) => {
    console.log("User disconnected:", remoteUserId);
  });
}

function addVideoStream(video, stream) {
  video.srcObject = stream;
  video.addEventListener("loadedmetadata", () => {
    video.play();
  });
  videoGrid.append(video);
}

function createPeerConnection(remoteUserId) {
  peerConnection = new RTCPeerConnection(configuration);

  // Send local tracks
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // Remote track handler
  peerConnection.ontrack = (event) => {
    const remoteVideo = document.createElement("video");
    addVideoStream(remoteVideo, event.streams[0]);
  };

  // Send ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { candidate: event.candidate });
    }
  };
}

async function createOffer(remoteUserId) {
  createPeerConnection(remoteUserId);
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("offer", { offer, remoteUserId });
}

async function createAnswer(data) {
  createPeerConnection(data.remoteUserId);
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", { answer, remoteUserId: data.remoteUserId });
}
