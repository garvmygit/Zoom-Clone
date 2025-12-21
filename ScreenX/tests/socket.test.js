import { registerSocketHandlers } from '../src/sockets/index.js';
import clientIo from 'socket.io-client';
import server from '../server.js';

test('registerSocketHandlers emits peers when join-room received (unit)', async () => {
  const mockDb = { getRoom: async (meetingId) => ({ meetingId, locked: false }) };

  // Minimal mock socket and io structure
  const emitted = {};
  const mockSocket = {
    id: 'socket1',
    data: {},
    handlers: {},
    on(event, fn) { this.handlers[event] = fn; },
    emit(event, payload) { emitted[event] = payload; },
    join(room) {
      const set = mockIo.sockets.adapter.rooms.get(room) || new Set();
      set.add(this.id);
      mockIo.sockets.adapter.rooms.set(room, set);
    },
    to(room) { return { emit: () => {} }; },
    leave() {},
  };

  const mockIo = {
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map([['socket1', mockSocket]])
    },
    to() { return { emit: () => {} }; },
    on(ev, cb) {
      if (ev === 'connection') cb(mockSocket);
    }
  };

  registerSocketHandlers(mockIo, { dbCacheService: mockDb });

  // Trigger join-room handler
  await mockSocket.handlers['join-room']({ meetingId: 'room1', displayName: 'Tester', isHost: true });

  expect(Array.isArray(emitted.peers)).toBe(true);
});
// Integration socket test removed due to environment websocket limitations.
