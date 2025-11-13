/**
 * Frontend Cache Manager
 * Manages browser caching using localStorage, sessionStorage, and IndexedDB
 */

class CacheManager {
  constructor() {
    this.version = '1.0.0';
    this.storagePrefix = 'screenx_';
    this.init();
  }

  /**
   * Initialize cache manager
   */
  init() {
    // Check version and clear old cache if version changed
    const storedVersion = localStorage.getItem(`${this.storagePrefix}version`);
    if (storedVersion && storedVersion !== this.version) {
      console.log('[Cache Manager] Version changed, clearing old cache');
      this.clearAllCaches();
    }
    localStorage.setItem(`${this.storagePrefix}version`, this.version);

    // Initialize IndexedDB if needed
    this.initIndexedDB();
  }

  /**
   * Initialize IndexedDB for large data storage
   */
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ScreenXCache', 1);

      request.onerror = () => {
        console.warn('[Cache Manager] IndexedDB not available');
        resolve(null);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object stores
        if (!db.objectStoreNames.contains('chatMessages')) {
          db.createObjectStore('chatMessages', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('largeData')) {
          db.createObjectStore('largeData', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Save data to local cache (localStorage)
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   */
  saveToLocalCache(key, value) {
    try {
      const fullKey = `${this.storagePrefix}${key}`;
      const data = {
        value,
        timestamp: Date.now()
      };
      localStorage.setItem(fullKey, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('[Cache Manager] Error saving to localStorage:', error);
      // If quota exceeded, try to clear old data
      if (error.name === 'QuotaExceededError') {
        this.clearOldCache();
        try {
          localStorage.setItem(fullKey, JSON.stringify({ value, timestamp: Date.now() }));
          return true;
        } catch (e) {
          console.error('[Cache Manager] Still failed after cleanup:', e);
          return false;
        }
      }
      return false;
    }
  }

  /**
   * Get data from local cache
   * @param {string} key - Cache key
   * @param {number} maxAge - Maximum age in milliseconds (optional)
   * @returns {*|null} - Cached value or null
   */
  getLocalCache(key, maxAge = null) {
    try {
      const fullKey = `${this.storagePrefix}${key}`;
      const item = localStorage.getItem(fullKey);
      if (!item) return null;

      const data = JSON.parse(item);
      
      // Check if expired
      if (maxAge && Date.now() - data.timestamp > maxAge) {
        localStorage.removeItem(fullKey);
        return null;
      }

      return data.value;
    } catch (error) {
      console.error('[Cache Manager] Error reading from localStorage:', error);
      return null;
    }
  }

  /**
   * Clear specific cache entry
   * @param {string} key - Cache key
   */
  clearLocalCache(key) {
    const fullKey = `${this.storagePrefix}${key}`;
    localStorage.removeItem(fullKey);
  }

  /**
   * Save to session storage (temporary)
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   */
  saveToSessionCache(key, value) {
    try {
      const fullKey = `${this.storagePrefix}${key}`;
      sessionStorage.setItem(fullKey, JSON.stringify({ value, timestamp: Date.now() }));
      return true;
    } catch (error) {
      console.error('[Cache Manager] Error saving to sessionStorage:', error);
      return false;
    }
  }

  /**
   * Get from session storage
   * @param {string} key - Cache key
   * @returns {*|null} - Cached value or null
   */
  getSessionCache(key) {
    try {
      const fullKey = `${this.storagePrefix}${key}`;
      const item = sessionStorage.getItem(fullKey);
      if (!item) return null;
      const data = JSON.parse(item);
      return data.value;
    } catch (error) {
      console.error('[Cache Manager] Error reading from sessionStorage:', error);
      return null;
    }
  }

  /**
   * Save chat messages (last 50)
   * @param {string} meetingId - Meeting ID
   * @param {Array} messages - Chat messages
   */
  saveChatMessages(meetingId, messages) {
    // Keep only last 50 messages
    const limitedMessages = messages.slice(-50);
    this.saveToLocalCache(`chat_${meetingId}`, limitedMessages);
    
    // Also save to IndexedDB for larger storage if available
    if (this.db) {
      const transaction = this.db.transaction(['chatMessages'], 'readwrite');
      const store = transaction.objectStore('chatMessages');
      
      // Clear old messages for this meeting
      const index = store.index('meetingId');
      index.openCursor(IDBKeyRange.only(meetingId)).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      
      // Add new messages
      limitedMessages.forEach((msg, idx) => {
        store.add({
          meetingId,
          ...msg,
          id: `${meetingId}_${idx}_${Date.now()}`
        });
      });
    }
  }

  /**
   * Get cached chat messages
   * @param {string} meetingId - Meeting ID
   * @returns {Array} - Chat messages
   */
  getChatMessages(meetingId) {
    const cached = this.getLocalCache(`chat_${meetingId}`);
    return cached || [];
  }

  /**
   * Save user preferences
   * @param {Object} preferences - User preferences
   */
  saveUserPreferences(preferences) {
    this.saveToLocalCache('user_preferences', preferences);
  }

  /**
   * Get user preferences
   * @returns {Object} - User preferences
   */
  getUserPreferences() {
    return this.getLocalCache('user_preferences') || {
      mic: true,
      camera: true,
      theme: 'light',
      username: ''
    };
  }

  /**
   * Save room settings
   * @param {string} meetingId - Meeting ID
   * @param {Object} settings - Room settings
   */
  saveRoomSettings(meetingId, settings) {
    this.saveToLocalCache(`room_${meetingId}`, settings);
  }

  /**
   * Get room settings
   * @param {string} meetingId - Meeting ID
   * @returns {Object|null} - Room settings
   */
  getRoomSettings(meetingId) {
    return this.getLocalCache(`room_${meetingId}`);
  }

  /**
   * Save participant list (light version)
   * @param {string} meetingId - Meeting ID
   * @param {Array} participants - Participants list
   */
  saveParticipants(meetingId, participants) {
    // Store only essential info
    const lightParticipants = participants.map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost
    }));
    this.saveToSessionCache(`participants_${meetingId}`, lightParticipants);
  }

  /**
   * Get cached participants
   * @param {string} meetingId - Meeting ID
   * @returns {Array} - Participants list
   */
  getParticipants(meetingId) {
    return this.getSessionCache(`participants_${meetingId}`) || [];
  }

  /**
   * Sync with backend
   * @param {string} meetingId - Meeting ID
   */
  async syncWithBackend(meetingId) {
    try {
      // Fetch latest data from backend
      const [roomData, chatData] = await Promise.all([
        fetch(`/api/rooms/${meetingId}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/chat/${meetingId}`).then(r => r.ok ? r.json() : null).catch(() => null)
      ]);

      // Update local cache
      if (roomData) {
        this.saveRoomSettings(meetingId, {
          locked: roomData.locked,
          password: roomData.password,
          hostUserId: roomData.hostUserId
        });
      }

      if (chatData && chatData.messages) {
        this.saveChatMessages(meetingId, chatData.messages);
      }

      return { roomData, chatData };
    } catch (error) {
      console.error('[Cache Manager] Sync error:', error);
      return null;
    }
  }

  /**
   * Clear old cache entries (older than 7 days)
   */
  clearOldCache() {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const keysToRemove = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.storagePrefix) && key !== `${this.storagePrefix}version`) {
        try {
          const item = JSON.parse(localStorage.getItem(key));
          if (item.timestamp && item.timestamp < sevenDaysAgo) {
            keysToRemove.push(key);
          }
        } catch (e) {
          // Invalid JSON, remove it
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log(`[Cache Manager] Cleared ${keysToRemove.length} old cache entries`);
  }

  /**
   * Clear all caches
   */
  clearAllCaches() {
    // Clear localStorage
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.storagePrefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Clear sessionStorage
    sessionStorage.clear();

    // Clear IndexedDB
    if (this.db) {
      const transaction = this.db.transaction(['chatMessages', 'largeData'], 'readwrite');
      transaction.objectStore('chatMessages').clear();
      transaction.objectStore('largeData').clear();
    }

    console.log('[Cache Manager] All caches cleared');
  }
}

// Export singleton instance
const cacheManager = new CacheManager();

// Make available globally for non-module scripts
if (typeof window !== 'undefined') {
  window.CacheManager = CacheManager;
  window.cacheManager = cacheManager;
}

export default cacheManager;

