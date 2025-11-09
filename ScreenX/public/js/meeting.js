function setupMeeting() {
const socket = io();
const section = document.querySelector('section[data-meeting-id]');
if (section) {
  const meetingId = section.getAttribute('data-meeting-id');
  const isHost = section.getAttribute('data-is-host') === 'true';
  const displayNameFromAttr = section.getAttribute('data-display-name');
  const displayName = displayNameFromAttr || (window.SCREENX_USER && window.SCREENX_USER.name) || `Guest-${Math.random().toString(36).slice(2,6)}`;
  
  // Store participant names mapping: socketId -> { name, isHost }
  const participantNames = new Map();
  participantNames.set('local', { name: displayName, isHost });

  const localVideo = document.createElement('video');
  localVideo.muted = true;
  const peers = new Map(); // id -> RTCPeerConnection
  const streams = new Map(); // id -> MediaStream
  let localStream;
  let screenStream;
  let mediaRecorder;
  let recordedChunks = [];

  const grid = document.getElementById('video-grid');
  const chatPanel = document.getElementById('chatPanel');
  const chatMessages = document.getElementById('chatMessages');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const chatbotPanel = document.getElementById('chatbotPanel');
  const chatbotMessages = document.getElementById('chatbotMessages');
  const chatbotForm = document.getElementById('chatbotForm');
  const chatbotInput = document.getElementById('chatbotInput');
  const tabChat = document.getElementById('tabChat');
  const tabAssistant = document.getElementById('tabAssistant');

  function addVideoTile(id, stream, name, isHostUser = false) {
    let tile = document.getElementById(`tile-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.id = `tile-${id}`;
      tile.className = 'video-tile aspect-video';
      const v = document.createElement('video');
      v.autoplay = true; v.playsInline = true;
      const label = document.createElement('div');
      label.className = 'video-name';
      
      // Build name display with host badge
      const nameText = document.createTextNode(name || id);
      label.appendChild(nameText);
      
      if (isHostUser) {
        const hostBadge = document.createElement('span');
        hostBadge.className = 'host-badge';
        hostBadge.textContent = ' 👑 Host';
        label.appendChild(hostBadge);
      }
      
      tile.appendChild(v); 
      tile.appendChild(label);
      grid.appendChild(tile);
    } else {
      // Update existing tile name if needed
      const label = tile.querySelector('.video-name');
      if (label && name) {
        label.innerHTML = '';
        label.appendChild(document.createTextNode(name));
        if (isHostUser) {
          const hostBadge = document.createElement('span');
          hostBadge.className = 'host-badge';
          hostBadge.textContent = ' 👑 Host';
          label.appendChild(hostBadge);
        }
      }
    }
    const video = tile.querySelector('video');
    if (video && video.srcObject !== stream) video.srcObject = stream;
    
    // Update grid layout after adding tile
    updateVideoGridLayout();
  }

  function removeVideoTile(id) {
    const tile = document.getElementById(`tile-${id}`);
    if (tile) tile.remove();
    updateVideoGridLayout();
  }

  // Update video grid layout based on participant count
  function updateVideoGridLayout() {
    const tiles = grid.querySelectorAll('.video-tile');
    const count = tiles.length;
    
    // Remove all existing participant count classes
    grid.classList.remove('participants-1', 'participants-2', 'participants-3', 
                          'participants-4', 'participants-5', 'participants-6', 
                          'participants-7', 'participants-8', 'participants-9');
    
    // Add appropriate class based on count
    if (count >= 1 && count <= 9) {
      grid.classList.add(`participants-${count}`);
    } else if (count > 9) {
      grid.classList.add('participants-9'); // Max 3x3 grid
    }
    
    // Update participant count in header if element exists
    const participantCountEl = document.getElementById('participantCount');
    if (participantCountEl) {
      participantCountEl.textContent = count;
    }
  }

  async function initMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      addVideoTile('local', localStream, `${displayName} (You)`, isHost);
      // Ensure initial layout is set
      updateVideoGridLayout();
    } catch (e) {
      alert('Camera/Microphone access denied or unavailable. You can still join in listen-only mode.');
      localStream = new MediaStream();
      addVideoTile('local', localStream, `${displayName} (You)`, isHost);
      // Ensure initial layout is set even without media
      updateVideoGridLayout();
    }
  }

  function createPeer(targetId, polite = true) {
    if (!localStream) return null;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });
    // Always add audio tracks from camera/mic stream
    localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
    // For video, prefer screen if active
    const activeVideoTrack = (screenStream && screenStream.getVideoTracks()[0]) || localStream.getVideoTracks()[0];
    if (activeVideoTrack) pc.addTrack(activeVideoTrack, screenStream || localStream);
    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      streams.set(targetId, stream);
      // Get participant name from our mapping
      const participant = participantNames.get(targetId);
      const participantName = participant ? participant.name : targetId;
      const isHostUser = participant ? participant.isHost : false;
      addVideoTile(targetId, stream, participantName, isHostUser);
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) socket.emit('signal', { to: targetId, data: { candidate: ev.candidate } });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        peers.delete(targetId);
        removeVideoTile(targetId);
      }
    };
    peers.set(targetId, pc);
    return pc;
  }

  // UI controls - Tab switching
  let currentTab = 'chat';
  const chatWidget = document.getElementById('chatWidget');
  const toggleChatBtn = document.getElementById('toggleChatBtn');
  const chatIcon = document.getElementById('chatIcon');
  const toggleChatWidget = document.getElementById('toggleChatWidget');
  const closeChatWidget = document.getElementById('closeChatWidget');
  const chatWidgetHeader = chatWidget?.querySelector('.chat-widget-header');
  const videoGrid = document.getElementById('video-grid');
  
  // Chat widget state: 'expanded', 'minimized', or 'hidden'
  let chatWidgetState = 'minimized'; // Chat starts minimized so it doesn't block video content
  
  function updateChatButtonState() {
    if (toggleChatBtn && chatIcon) {
      if (chatWidgetState === 'hidden') {
        toggleChatBtn.classList.add('active');
        chatIcon.className = 'fas fa-comment-slash';
        toggleChatBtn.setAttribute('data-tooltip', 'Open Chat');
      } else {
        toggleChatBtn.classList.remove('active');
        chatIcon.className = 'fas fa-comments';
        toggleChatBtn.setAttribute('data-tooltip', 'Close Chat');
      }
    }
  }
  
  function setChatWidgetState(state) {
    if (!chatWidget) return;
    
    chatWidgetState = state;
    
    // Remove all state classes
    chatWidget.classList.remove('expanded', 'minimized', 'hidden');
    
    // Add the appropriate state class
    if (state === 'minimized') {
      chatWidget.classList.add('minimized');
      if (toggleChatWidget) {
        toggleChatWidget.setAttribute('data-tooltip', 'Expand Chat');
        const icon = toggleChatWidget.querySelector('i');
        if (icon) icon.className = 'fas fa-chevron-up';
      }
    } else if (state === 'hidden') {
      chatWidget.classList.add('hidden');
      // Remove any padding from video grid when chat is hidden
      if (videoGrid) {
        videoGrid.classList.remove('chat-visible');
      }
    } else {
      // expanded
      chatWidget.classList.add('expanded');
      if (toggleChatWidget) {
        toggleChatWidget.setAttribute('data-tooltip', 'Minimize Chat');
        const icon = toggleChatWidget.querySelector('i');
        if (icon) icon.className = 'fas fa-chevron-down';
      }
      // Add class to video grid when chat is visible (for potential styling)
      if (videoGrid) {
        videoGrid.classList.add('chat-visible');
      }
    }
    
    updateChatButtonState();
  }
  
  function toggleChatWidgetVisibility() {
    if (!chatWidget) return;
    
    // If hidden, show as expanded
    // If minimized or expanded, hide completely
    if (chatWidgetState === 'hidden') {
      setChatWidgetState('expanded');
    } else {
      setChatWidgetState('hidden');
    }
  }
  
  function toggleChatWidgetMinimize() {
    if (!chatWidget) return;
    
    if (chatWidgetState === 'minimized') {
      setChatWidgetState('expanded');
    } else {
      setChatWidgetState('minimized');
    }
  }
  
  function switchTab(tab) {
    currentTab = tab;
    if (tab === 'chat') {
      chatPanel.classList.remove('hidden');
      chatbotPanel.classList.add('hidden');
      if (tabChat) {
        tabChat.classList.remove('tab-inactive');
        tabChat.classList.add('tab-active');
      }
      if (tabAssistant) {
        tabAssistant.classList.remove('tab-active');
        tabAssistant.classList.add('tab-inactive');
      }
    } else {
      chatPanel.classList.add('hidden');
      chatbotPanel.classList.remove('hidden');
      if (tabChat) {
        tabChat.classList.remove('tab-active');
        tabChat.classList.add('tab-inactive');
      }
      if (tabAssistant) {
        tabAssistant.classList.remove('tab-inactive');
        tabAssistant.classList.add('tab-active');
      }
    }
  }
  
  // Initialize tab state
  if (tabChat && tabAssistant) {
    tabChat.classList.add('tab-active');
    tabAssistant.classList.add('tab-inactive');
  }

  tabChat?.addEventListener('click', () => switchTab('chat'));
  tabAssistant?.addEventListener('click', () => switchTab('assistant'));
  
  // Toggle chat widget visibility from toolbar button (hide/show completely)
  toggleChatBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleChatWidgetVisibility();
  });
  
  // Toggle chat widget minimize/expand from widget header button
  toggleChatWidget?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleChatWidgetMinimize();
  });
  
  // Close chat widget completely from close button
  closeChatWidget?.addEventListener('click', (e) => {
    e.stopPropagation();
    setChatWidgetState('hidden');
  });
  
  // Click on header to expand when minimized (but not on buttons)
  chatWidgetHeader?.addEventListener('click', (e) => {
    // Only expand if minimized and click wasn't on buttons
    if (chatWidgetState === 'minimized' && 
        !e.target.closest('.chat-widget-toggle') && 
        !e.target.closest('.chat-widget-close') &&
        !e.target.closest('.tab')) {
      setChatWidgetState('expanded');
    }
  });
  
  // Initialize chat widget state (start minimized to not block video content)
  setChatWidgetState('minimized');
  updateChatButtonState();
  document.getElementById('btnShare')?.addEventListener('click', async () => {
    try {
      if (!screenStream) {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        // Show screen in local tile
        const localTile = document.getElementById('tile-local');
        if (localTile) {
          const v = localTile.querySelector('video');
          if (v && v.srcObject !== screenStream) v.srcObject = screenStream;
        }
        // Replace outgoing track for all peers
        for (const pc of peers.values()) {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender && screenStream.getVideoTracks()[0]) sender.replaceTrack(screenStream.getVideoTracks()[0]);
        }
        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
          try {
            for (const pc of peers.values()) {
              const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
              if (sender && localStream.getVideoTracks()[0]) sender.replaceTrack(localStream.getVideoTracks()[0]);
            }
            const localTile2 = document.getElementById('tile-local');
            if (localTile2) {
              const v2 = localTile2.querySelector('video');
              if (v2 && v2.srcObject !== localStream) v2.srcObject = localStream;
            }
          } finally {
            screenStream = null;
          }
        });
      }
    } catch {}
  });

  document.getElementById('btnRecord')?.addEventListener('click', () => {
    if (!mediaRecorder) {
      const mixed = localStream; // simple local recording
      mediaRecorder = new MediaRecorder(mixed, { mimeType: 'video/webm;codecs=vp9,opus' });
      recordedChunks = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `screenx-${Date.now()}.webm`; a.click();
        URL.revokeObjectURL(url);
      };
      mediaRecorder.start();
      alert('Recording started');
    } else {
      mediaRecorder.stop();
      mediaRecorder = null;
    }
  });

  document.getElementById('btnToggleMic')?.addEventListener('click', () => {
    try {
      let tracks = localStream ? localStream.getAudioTracks() : [];
      if (!tracks || tracks.length === 0) {
        navigator.mediaDevices.getUserMedia({ audio: true }).then((aStream) => {
          const track = aStream.getAudioTracks()[0];
          if (!track) return;
          localStream.addTrack(track);
          for (const pc of peers.values()) pc.addTrack(track, localStream);
        }).catch(() => {
          alert('Microphone not available or permission denied.');
        });
        return;
      }
      const next = !tracks[0].enabled;
      tracks.forEach(t => t.enabled = next);
      const btn = document.getElementById('btnToggleMic');
      if (btn) {
        btn.classList.toggle('active', next);
        if (!next) {
          btn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
        } else {
          btn.style.background = '';
        }
      }
    } catch {}
  });
  document.getElementById('btnToggleCam')?.addEventListener('click', () => {
    const tracks = localStream.getVideoTracks();
    const isEnabled = tracks.length > 0 && tracks[0].enabled;
    tracks.forEach(t => t.enabled = !isEnabled);
    const btn = document.getElementById('btnToggleCam');
    if (btn) {
      btn.classList.toggle('active', !isEnabled);
      if (!isEnabled) {
        btn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
      } else {
        btn.style.background = '';
      }
    }
  });
  document.getElementById('btnFlip')?.addEventListener('click', () => {
    const tile = document.getElementById('tile-local');
    if (tile) tile.classList.toggle('mirrored');
  });

  // Admin buttons
  // Meeting timer
  let meetingStartTime = Date.now();
  let timerInterval = null;
  
  function updateMeetingTimer() {
    const timerEl = document.getElementById('meetingTimer');
    if (!timerEl) return;
    
    const elapsed = Math.floor((Date.now() - meetingStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  
  // Start timer
  timerInterval = setInterval(updateMeetingTimer, 1000);
  updateMeetingTimer();
  
  // Lock Meeting button state management
  let isMeetingLocked = false;
  const lockBtn = document.querySelector('[data-admin="lock"]');
  
  function updateLockButtonState(locked) {
    isMeetingLocked = locked;
    if (lockBtn) {
      if (locked) {
        lockBtn.classList.add('active');
        lockBtn.setAttribute('data-tooltip', 'Meeting Locked - Click to unlock');
        const icon = lockBtn.querySelector('i');
        if (icon) icon.className = 'fas fa-lock';
      } else {
        lockBtn.classList.remove('active');
        lockBtn.setAttribute('data-tooltip', 'Lock Meeting');
        const icon = lockBtn.querySelector('i');
        if (icon) icon.className = 'fas fa-lock-open';
      }
    }
  }
  
  // Admin action handlers
  document.querySelectorAll('[data-admin]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-admin');
      
      if (action === 'lock') {
        const newLockState = !isMeetingLocked;
        socket.emit('admin-action', { meetingId, action: newLockState ? 'lock' : 'unlock' });
        // Optimistic update
        updateLockButtonState(newLockState);
        
        // Show toast notification
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.textContent = newLockState ? 'Meeting locked' : 'Meeting unlocked';
        toast.style.cssText = 'position: fixed; top: 20px; right: 20px; background: rgba(99, 102, 241, 0.9); color: white; padding: 1rem 1.5rem; border-radius: 8px; z-index: 10000; animation: fadeInUp 0.3s ease-out;';
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.animation = 'fadeOut 0.3s ease-out';
          setTimeout(() => toast.remove(), 300);
        }, 3000);
      } else if (action === 'mute-all') {
        socket.emit('admin-action', { meetingId, action: 'mute-all' });
        
        // Show toast notification
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.textContent = 'All participants muted';
        toast.style.cssText = 'position: fixed; top: 20px; right: 20px; background: rgba(99, 102, 241, 0.9); color: white; padding: 1rem 1.5rem; border-radius: 8px; z-index: 10000; animation: fadeInUp 0.3s ease-out;';
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.animation = 'fadeOut 0.3s ease-out';
          setTimeout(() => toast.remove(), 300);
        }, 3000);
      } else {
        socket.emit('admin-action', { meetingId, action });
      }
    });
  });

  // Leave Meeting button handler
  document.getElementById('btnLeave')?.addEventListener('click', () => {
    console.log('[Meeting] Leave button clicked');
    
    // Confirm before leaving
    if (!confirm('Are you sure you want to leave the meeting?')) {
      return;
    }
    
    try {
      // Stop all local media tracks
      if (localStream) {
        console.log('[Meeting] Stopping local media tracks');
        localStream.getTracks().forEach(track => {
          track.stop();
          console.log('[Meeting] Stopped track:', track.kind);
        });
        localStream = null;
      }
      
      // Stop screen share if active
      if (screenStream) {
        console.log('[Meeting] Stopping screen share');
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
      }
      
      // Stop recording if active
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        console.log('[Meeting] Stopping recording');
        mediaRecorder.stop();
        mediaRecorder = null;
      }
      
      // Close all peer connections
      console.log('[Meeting] Closing peer connections:', peers.size);
      peers.forEach((pc, id) => {
        try {
          pc.close();
          console.log('[Meeting] Closed peer connection:', id);
        } catch (e) {
          console.error('[Meeting] Error closing peer:', id, e);
        }
      });
      peers.clear();
      streams.clear();
      
      // Notify server via socket
      if (socket && socket.connected) {
        console.log('[Meeting] Emitting leave-room event');
        socket.emit('leave-room', { meetingId, displayName });
        socket.disconnect();
      }
      
      // Redirect to home page
      console.log('[Meeting] Redirecting to home page');
      window.location.href = '/';
    } catch (error) {
      console.error('[Meeting] Error leaving meeting:', error);
      // Still redirect even if cleanup fails
      window.location.href = '/';
    }
  });
  
  // Handle browser close/tab close
  window.addEventListener('beforeunload', () => {
    if (socket && socket.connected) {
      socket.emit('leave-room', { meetingId, displayName });
    }
    // Stop media tracks
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
    }
  });

  // Chat
  chatForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (!message) return;
    const ts = Date.now();
    appendMsg(displayName, message, ts);
    chatInput.value = '';
    socket.emit('chat-message', { meetingId, sender: displayName, message, ts });
    try { await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId, sender: displayName, message }) }); } catch {}
  });

  socket.on('chat-message', ({ sender, message, ts }) => appendMsg(sender, message, ts));
  function appendMsg(sender, message, ts) {
    const isOwn = sender === displayName;
    const el = document.createElement('div');
    el.className = `chat-message ${isOwn ? 'own' : 'other'}`;
    el.innerHTML = `
      <div class="message-bubble">
        <div class="font-semibold mb-1">${escapeHtml(sender)}</div>
        <div>${escapeHtml(message)}</div>
        <div class="message-time">${new Date(ts).toLocaleTimeString()}</div>
      </div>
    `;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Chatbot functionality
  function appendChatbotMessage(sender, text, isUser = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = isUser ? 'chatbot-msg chatbot-msg-user' : 'chatbot-msg chatbot-msg-bot';
    
    const bubble = document.createElement('div');
    bubble.className = 'chatbot-bubble';
    bubble.innerHTML = escapeHtml(text).replace(/\n/g, '<br/>');
    
    const time = document.createElement('div');
    time.className = 'chatbot-bubble-time';
    time.textContent = new Date().toLocaleTimeString();
    bubble.appendChild(time);
    
    msgDiv.appendChild(bubble);
    chatbotMessages.appendChild(msgDiv);
    chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
  }

  function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.id = 'chatbotTyping';
    typingDiv.className = 'chatbot-msg chatbot-msg-bot';
    typingDiv.innerHTML = '<div class="chatbot-bubble chatbot-typing"><span></span><span></span><span></span></div>';
    chatbotMessages.appendChild(typingDiv);
    chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
  }

  function removeTypingIndicator() {
    const typing = document.getElementById('chatbotTyping');
    if (typing) typing.remove();
  }

  // Auto-greeting when assistant panel is first opened
  let greetingShown = false;
  function showGreeting() {
    if (!greetingShown) {
      greetingShown = true;
      setTimeout(() => {
        appendChatbotMessage('ScreenX Assistant', `Hi! I'm ScreenX Assistant. I can help you with:\n\n• Answering questions about the meeting\n• Summarizing discussions\n• Executing commands (if you're the host)\n• General questions and assistance\n\nHow can I help you today?`, false);
      }, 500);
    }
  }

  // Chatbot form submission
  chatbotForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = chatbotInput.value.trim();
    if (!prompt) return;
    
    appendChatbotMessage('You', prompt, true);
    chatbotInput.value = '';
    showTypingIndicator();
    
    try {
      console.log('[Chatbot] Sending request:', { meetingId, prompt, isHost });
      
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, prompt, isHost })
      });
      
      console.log('[Chatbot] Response status:', res.status);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        removeTypingIndicator();

        // Handle rate limit errors gracefully
        const errorMsg = errorData.error || errorData.message || 'Request failed';
        if (errorMsg.includes('Rate limit') || errorMsg.includes('rate limit') || res.status === 429) {
          appendChatbotMessage('ScreenX Assistant', 'AI assistant temporarily unavailable. Please try again in a moment.', false);
        } else {
          appendChatbotMessage('ScreenX Assistant', `Error: ${errorMsg}`, false);
        }
        console.error('[Chatbot] API error:', errorData);
        return;
      }
      
      const data = await res.json();
      console.log('[Chatbot] Response data:', data);
      removeTypingIndicator();
      
      if (data.error) {
        // Handle rate limit errors gracefully
        const errorMsg = data.error;
        if (errorMsg.includes('Rate limit') || errorMsg.includes('rate limit')) {
          appendChatbotMessage('ScreenX Assistant', 'AI assistant temporarily unavailable. Please try again in a moment.', false);
        } else {
          appendChatbotMessage('ScreenX Assistant', `Error: ${errorMsg}`, false);
        }
        return;
      }
      
      // Defensive check for reply
      const reply = data.reply;
      if (!reply || reply.trim() === '') {
        console.error('[Chatbot] Empty reply received:', data);
        appendChatbotMessage('ScreenX Assistant', 'Sorry, I received an empty response. Please try again.', false);
        return;
      }
      
      appendChatbotMessage('ScreenX Assistant', reply, false);
      
      // Handle commands
      if (data.command && data.requiresAction && isHost) {
        const commandMap = {
          'mute-all': () => {
            socket.emit('admin-action', { meetingId, action: 'mute-all' });
            appendChatbotMessage('ScreenX Assistant', '✅ Muted all participants', false);
          },
          'lock': () => {
            socket.emit('admin-action', { meetingId, action: 'lock' });
            appendChatbotMessage('ScreenX Assistant', '✅ Meeting locked', false);
          },
          'unlock': () => {
            socket.emit('admin-action', { meetingId, action: 'unlock' });
            appendChatbotMessage('ScreenX Assistant', '✅ Meeting unlocked', false);
          },
          'end': () => {
            if (confirm('Are you sure you want to end the meeting?')) {
              socket.emit('admin-action', { meetingId, action: 'end' });
            }
          },
          'summarize': async () => {
            showTypingIndicator();
            try {
              const summaryRes = await fetch('/api/summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meetingId })
              });
              const summaryData = await summaryRes.json();
              removeTypingIndicator();
              if (summaryRes.ok) {
                appendChatbotMessage('ScreenX Assistant', `📝 Meeting Summary:\n\n${summaryData.summary}`, false);
              } else {
                appendChatbotMessage('ScreenX Assistant', `Error generating summary: ${summaryData.error || 'Unknown error'}`, false);
              }
            } catch (error) {
              removeTypingIndicator();
              appendChatbotMessage('ScreenX Assistant', 'Error generating summary. Please try again.', false);
            }
          }
        };
        
        if (commandMap[data.command]) {
          commandMap[data.command]();
        }
      }
    } catch (error) {
      removeTypingIndicator();
      console.error('Error sending message to assistant:', error);

      // Handle network errors and rate limits gracefully
      if (error.message && (error.message.includes('rate') || error.message.includes('429'))) {
        appendChatbotMessage('ScreenX Assistant', 'AI assistant temporarily unavailable. Please try again in a moment.', false);
      } else {
        appendChatbotMessage('ScreenX Assistant', 'Sorry, I encountered an error. Please try again.', false);
      }
    }
  });

  // Quick action buttons
  document.getElementById('btnQuickSummary')?.addEventListener('click', async () => {
    chatbotInput.value = 'summarize the meeting';
    chatbotForm.dispatchEvent(new Event('submit'));
  });

  document.getElementById('btnQuickHelp')?.addEventListener('click', () => {
    chatbotInput.value = 'What can you help me with?';
    chatbotForm.dispatchEvent(new Event('submit'));
  });

  // Show greeting when assistant tab is clicked
  tabAssistant?.addEventListener('click', () => {
    setTimeout(showGreeting, 100);
  });
  // Toast notification function
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease-in';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Summary display elements
  const summaryContainer = document.getElementById('summaryContainer');
  const summaryOutput = document.getElementById('summaryOutput');
  const btnDownloadSummary = document.getElementById('btnDownloadSummary');
  const btnCloseSummary = document.getElementById('btnCloseSummary');
  let currentSummary = null;

  // Download summary function
  btnDownloadSummary?.addEventListener('click', () => {
    if (!currentSummary) return;
    
    const blob = new Blob([currentSummary], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-summary-${meetingId}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Summary downloaded successfully!', 'success');
  });

  // Close summary function
  btnCloseSummary?.addEventListener('click', () => {
    summaryContainer?.classList.add('hidden');
    currentSummary = null;
  });

  // Generate Summary button handler
  document.getElementById('btnSummary')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnSummary');
    if (!btn) return;

    try {
      btn.disabled = true;
      btn.innerHTML = '⏳ Generating...';
      btn.classList.add('opacity-75', 'cursor-not-allowed');
      
      showToast('Generating meeting summary...', 'info');
      
      const res = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId })
      });
      
      const data = await res.json();
      
      if (!res.ok || !data.success) {
        const errorMsg = data.message || data.error || 'Failed to generate summary';
        console.error('[Frontend] Summary generation failed:', errorMsg);
        showToast(errorMsg, 'error');
        appendMsg('Summary Error', errorMsg.replace(/\n/g,'<br/>'), Date.now());
        return;
      }
      
      if (!data.summary) {
        showToast('Summary generated but is empty', 'error');
        return;
      }
      
      // Display summary in dedicated container
      currentSummary = data.summary;
      if (summaryOutput) {
        summaryOutput.textContent = data.summary;
      }
      if (summaryContainer) {
        summaryContainer.classList.remove('hidden');
      }
      
      // Also append to chat for visibility
      appendMsg('AI Summary', data.summary.replace(/\n/g,'<br/>'), Date.now());
      
      // Show success message
      const participantCount = data.participants?.length || 0;
      const messageCount = data.messageCount || 0;
      showToast(`Summary generated successfully! (${messageCount} messages, ${participantCount} participants)`, 'success');
      
      console.log('[Frontend] Summary generated successfully:', {
        length: data.summary.length,
        participants: data.participants,
        messageCount: data.messageCount
      });
      
    } catch (error) {
      console.error('[Frontend] Error generating summary:', error);
      showToast('Network error. Please check your connection and try again.', 'error');
      appendMsg('Summary Error', 'Failed to generate summary. Please try again later.', Date.now());
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🧠 Generate AI Summary';
      btn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
  });

  function escapeHtml(str) {
    return str.replace(/[&<>"]+/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
  }

  // Signaling
  // Delay joining until media is initialized
  (async () => {
    await initMedia();
    socket.emit('join-room', { meetingId, displayName, isHost });
  })();

  socket.on('peers', async (peerInfo) => {
    // peerInfo is now an array of { id, name, isHost } objects
    if (Array.isArray(peerInfo)) {
      for (const peer of peerInfo) {
        if (peer.id) {
          // Store participant info
          participantNames.set(peer.id, { 
            name: peer.name || peer.id, 
            isHost: peer.isHost || false 
          });
          await callPeer(peer.id);
        }
      }
    } else {
      // Fallback for old format (array of IDs)
      for (const pid of peerInfo) await callPeer(pid);
    }
  });
  socket.on('user-joined', async ({ id, name, isHost: userIsHost }) => { 
    console.log('[Meeting] User joined:', { id, name, isHost: userIsHost });
    // Store participant info
    if (name) {
      participantNames.set(id, { name, isHost: userIsHost || false });
      
      // Update video tile if it already exists
      const existingTile = document.getElementById(`tile-${id}`);
      if (existingTile) {
        const label = existingTile.querySelector('.video-name');
        if (label) {
          label.innerHTML = '';
          label.appendChild(document.createTextNode(name));
          if (userIsHost) {
            const hostBadge = document.createElement('span');
            hostBadge.className = 'host-badge';
            hostBadge.textContent = ' 👑 Host';
            label.appendChild(hostBadge);
          }
        }
      }
    }
    await callPeer(id); 
  });
  socket.on('user-left', ({ id, name }) => { 
    console.log('[Meeting] User left:', { id, name });
    participantNames.delete(id);
    peers.get(id)?.close(); 
    peers.delete(id); 
    removeVideoTile(id); 
  });

  socket.on('signal', async ({ from, data }) => {
    let pc = peers.get(from) || createPeer(from);
    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { to: from, data: { sdp: pc.localDescription } });
      }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
    }
  });

  async function callPeer(id) {
    if (peers.has(id)) return;
    if (!localStream) await initMedia();
    const pc = createPeer(id);
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: id, data: { sdp: pc.localDescription } });
  }

  // Admin inbound
  socket.on('remote-mute', () => { 
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = false);
      // Update mic button state
      const micBtn = document.getElementById('btnToggleMic');
      if (micBtn) {
        micBtn.classList.add('active');
        const icon = micBtn.querySelector('i');
        if (icon) icon.className = 'fas fa-microphone-slash';
      }
    }
  });
  
  socket.on('meeting-locked', () => {
    updateLockButtonState(true);
    appendMsg('System', 'Meeting locked by host', Date.now());
  });
  
  socket.on('meeting-unlocked', () => {
    updateLockButtonState(false);
    appendMsg('System', 'Meeting unlocked by host', Date.now());
  });
  
  socket.on('meeting-ended', () => { 
    alert('Meeting ended by host'); 
    window.location.href = '/'; 
  });
  
  socket.on('error-message', (message) => {
    // Show error toast
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    toast.style.cssText = 'position: fixed; top: 20px; right: 20px; background: rgba(239, 68, 68, 0.9); color: white; padding: 1rem 1.5rem; border-radius: 8px; z-index: 10000; animation: fadeInUp 0.3s ease-out;';
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
    
    // If meeting is locked, redirect after a delay
    if (message.includes('locked')) {
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    }
  });

  // Start (handled above before join)
}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupMeeting);
} else {
  setupMeeting();
}

