/**
 * Database Cache Service
 * Provides caching layer for MongoDB queries with automatic sync
 */

import memoryCache from './memoryCache.js';
import Chat from '../schema/Chat.js';
import Meeting from '../schema/Meeting.js';
import User from '../schema/User.js';

class DBCacheService {
  constructor() {
    // TTL configurations (in seconds)
    this.ttl = {
      chat: 60,        // 60 seconds for chat
      room: 5 * 60,    // 5 minutes for room data
      user: 10 * 60,   // 10 minutes for user info
      participants: 30 // 30 seconds for participants list
    };
  }

  /**
   * Generate cache key
   * @param {string} type - Cache type (chat, room, user, etc.)
   * @param {string} identifier - Unique identifier
   * @returns {string} - Cache key
   */
  getCacheKey(type, identifier) {
    return `db:${type}:${identifier}`;
  }

  /**
   * Get room metadata (cached)
   * @param {string} meetingId - Meeting ID
   * @returns {Promise<Object|null>} - Room data or null
   */
  async getRoom(meetingId) {
    const cacheKey = this.getCacheKey('room', meetingId);
    
    // Check cache
    const cached = memoryCache.get(cacheKey);
    if (cached !== null) {
      console.log(`[Cache] Room HIT: ${meetingId}`);
      return cached;
    }

    // Cache miss - fetch from DB
    console.log(`[Cache] Room MISS: ${meetingId}`);
    const meeting = await Meeting.findOne({ meetingId }).lean();
    
    if (meeting) {
      // Store in cache
      memoryCache.set(cacheKey, meeting, this.ttl.room);
    }
    
    return meeting;
  }

  /**
   * Update room in cache and DB (write-through)
   * @param {string} meetingId - Meeting ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} - Updated meeting
   */
  async updateRoom(meetingId, updateData) {
    // Update DB
    const meeting = await Meeting.findOneAndUpdate(
      { meetingId },
      { $set: updateData },
      { new: true, lean: true }
    );

    if (meeting) {
      // Update cache
      const cacheKey = this.getCacheKey('room', meetingId);
      memoryCache.set(cacheKey, meeting, this.ttl.room);
    }

    return meeting;
  }

  /**
   * Invalidate room cache
   * @param {string} meetingId - Meeting ID
   */
  invalidateRoom(meetingId) {
    const cacheKey = this.getCacheKey('room', meetingId);
    memoryCache.delete(cacheKey);
    console.log(`[Cache] Invalidated room: ${meetingId}`);
  }

  /**
   * Get chat history (cached, limited to 50 messages)
   * @param {string} meetingId - Meeting ID
   * @param {number} limit - Maximum number of messages (default: 50)
   * @returns {Promise<Array>} - Chat messages
   */
  async getChatHistory(meetingId, limit = 50) {
    const cacheKey = this.getCacheKey('chat', meetingId);
    
    // Check cache
    const cached = memoryCache.get(cacheKey);
    if (cached !== null) {
      console.log(`[Cache] Chat HIT: ${meetingId}`);
      return cached;
    }

    // Cache miss - fetch from DB
    console.log(`[Cache] Chat MISS: ${meetingId}`);
    const messages = await Chat.find({ meetingId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Reverse to get chronological order
    const sortedMessages = messages.reverse();

    // Store in cache
    memoryCache.set(cacheKey, sortedMessages, this.ttl.chat);
    
    return sortedMessages;
  }

  /**
   * Add chat message (write-through)
   * @param {string} meetingId - Meeting ID
   * @param {string} sender - Sender name
   * @param {string} message - Message content
   * @returns {Promise<Object>} - Created chat message
   */
  async addChatMessage(meetingId, sender, message) {
    // Create in DB
    const chatMessage = await Chat.create({ meetingId, sender, message });

    // Invalidate chat cache to force refresh
    const cacheKey = this.getCacheKey('chat', meetingId);
    memoryCache.delete(cacheKey);

    return chatMessage;
  }

  /**
   * Get user details (cached)
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} - User data or null
   */
  async getUser(userId) {
    const cacheKey = this.getCacheKey('user', userId);
    
    // Check cache
    const cached = memoryCache.get(cacheKey);
    if (cached !== null) {
      console.log(`[Cache] User HIT: ${userId}`);
      return cached;
    }

    // Cache miss - fetch from DB
    console.log(`[Cache] User MISS: ${userId}`);
    const user = await User.findById(userId).lean();
    
    if (user) {
      // Store in cache
      memoryCache.set(cacheKey, user, this.ttl.user);
    }
    
    return user;
  }

  /**
   * Get active participants list (cached, light version)
   * @param {string} meetingId - Meeting ID
   * @returns {Promise<Array>} - Participants list
   */
  async getParticipants(meetingId) {
    const cacheKey = this.getCacheKey('participants', meetingId);
    
    // Check cache
    const cached = memoryCache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - fetch from DB
    const participants = await Chat.distinct('sender', { meetingId });
    
    // Store in cache
    memoryCache.set(cacheKey, participants, this.ttl.participants);
    
    return participants;
  }

  /**
   * Invalidate all caches for a meeting
   * @param {string} meetingId - Meeting ID
   */
  invalidateMeeting(meetingId) {
    this.invalidateRoom(meetingId);
    const chatKey = this.getCacheKey('chat', meetingId);
    const participantsKey = this.getCacheKey('participants', meetingId);
    memoryCache.delete(chatKey);
    memoryCache.delete(participantsKey);
    console.log(`[Cache] Invalidated all caches for meeting: ${meetingId}`);
  }

  /**
   * Invalidate user cache
   * @param {string} userId - User ID
   */
  invalidateUser(userId) {
    const cacheKey = this.getCacheKey('user', userId);
    memoryCache.delete(cacheKey);
    console.log(`[Cache] Invalidated user: ${userId}`);
  }
}

// Export singleton instance
const dbCacheService = new DBCacheService();

export default dbCacheService;

