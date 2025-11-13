import Meeting from '../schema/Meeting.js';
import dbCacheService from '../cache/dbCacheService.js';

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('join-room', async ({ meetingId, displayName, isHost }) => {
      // Use cached room data
      const meeting = await dbCacheService.getRoom(meetingId);
      if (!meeting) return socket.emit('error-message', 'Meeting not found');
      if (meeting.locked && !isHost) return socket.emit('error-message', 'Meeting is locked');

      socket.data.meetingId = meetingId;
      socket.data.displayName = displayName || 'Guest';
      socket.data.isHost = !!isHost;
      socket.join(meetingId);

      console.log('[Socket] User joined room:', { 
        socketId: socket.id, 
        meetingId, 
        displayName: socket.data.displayName, 
        isHost: socket.data.isHost 
      });

      // Notify others in the room about this new user
      socket.to(meetingId).emit('user-joined', { 
        id: socket.id, 
        name: socket.data.displayName,
        isHost: socket.data.isHost 
      });
      
      // Get list of existing peers and send their info
      const peerIds = [...io.sockets.adapter.rooms.get(meetingId) || []].filter((id) => id !== socket.id);
      const peerInfo = peerIds.map(peerId => {
        const peerSocket = io.sockets.sockets.get(peerId);
        return {
          id: peerId,
          name: peerSocket?.data?.displayName || peerId,
          isHost: peerSocket?.data?.isHost || false
        };
      });
      
      socket.emit('peers', peerInfo);
    });

    // WebRTC signaling
    socket.on('signal', ({ to, data }) => {
      io.to(to).emit('signal', { from: socket.id, data });
    });

    // Chat relay in-room
    socket.on('chat-message', ({ meetingId, sender, message, ts }) => {
      socket.to(meetingId).emit('chat-message', { sender, message, ts });
    });

    // Admin controls
    socket.on('admin-action', async ({ meetingId, action, targetId }) => {
      if (!socket.data.isHost) return;
      const target = io.sockets.sockets.get(targetId);
      switch (action) {
        case 'mute':
          if (targetId) {
            io.to(targetId).emit('remote-mute');
          }
          break;
        case 'mute-all':
          // Mute all participants in the meeting room
          io.to(meetingId).emit('remote-mute');
          break;
        case 'remove':
          target?.leave(meetingId);
          target?.emit('removed-from-meeting');
          break;
        case 'lock': {
          await dbCacheService.updateRoom(meetingId, { locked: true });
          io.to(meetingId).emit('meeting-locked');
          break; }
        case 'unlock': {
          await dbCacheService.updateRoom(meetingId, { locked: false });
          io.to(meetingId).emit('meeting-unlocked');
          break; }
        case 'end':
          io.to(meetingId).emit('meeting-ended');
          for (const id of io.sockets.adapter.rooms.get(meetingId) || []) io.sockets.sockets.get(id)?.leave(meetingId);
          break;
        default:
          break;
      }
    });

    // Leave room handler
    socket.on('leave-room', ({ meetingId, displayName }) => {
      const name = displayName || socket.data?.displayName || 'Guest';
      console.log('[Socket] User leaving room:', { socketId: socket.id, meetingId, name });
      if (meetingId) {
        socket.leave(meetingId);
        socket.to(meetingId).emit('user-left', { id: socket.id, name });
      }
    });

    socket.on('disconnect', () => {
      const { meetingId, displayName } = socket.data || {};
      if (meetingId) {
        const name = displayName || 'Guest';
        console.log('[Socket] User disconnected:', { socketId: socket.id, meetingId, name });
        socket.to(meetingId).emit('user-left', { id: socket.id, name });
      }
    });
  });
}





