import { Router } from 'express';
import Chat from '../schema/Chat.js';
import Meeting from '../schema/Meeting.js';
import { aiSummarizeTranscript, aiChatbotReply } from '../services/ai.js';

const router = Router();

router.post('/chat', async (req, res) => {
  const { meetingId, sender, message } = req.body;
  if (!meetingId || !message) return res.status(400).json({ error: 'Missing fields' });
  await Chat.create({ meetingId, sender, message });
  res.json({ ok: true });
});

router.post('/summary', async (req, res) => {
  try {
    const { meetingId } = req.body;
    
    if (!meetingId) {
      console.error('[API] Summary request missing meetingId');
      return res.status(400).json({ error: 'Missing meetingId', success: false });
    }
    
    console.log('[API] Summary request for meeting:', meetingId);
    
    const meeting = await Meeting.findOne({ meetingId });
    if (!meeting) {
      console.error('[API] Meeting not found:', meetingId);
      return res.status(404).json({ error: 'Meeting not found', success: false });
    }
    
    // Get all chats for the meeting
    const chats = await Chat.find({ meetingId }).sort({ createdAt: 1 });
    console.log('[API] Found', chats.length, 'chat messages for meeting:', meetingId);
    
    if (chats.length === 0) {
      return res.status(400).json({ 
        error: 'No chat messages found', 
        message: 'There are no messages to summarize. Please have some conversation in the meeting first.',
        success: false 
      });
    }
    
    // Build transcript with timestamps
    const transcript = chats.map((c) => {
      const time = c.createdAt ? new Date(c.createdAt).toLocaleTimeString() : '';
      return `[${time}] ${c.sender || 'User'}: ${c.message}`;
    }).join('\n');
    
    // Extract unique participants
    const participants = [...new Set(chats.map(c => c.sender).filter(Boolean))];
    
    console.log('[API] Participants:', participants);
    console.log('[API] Transcript length:', transcript.length, 'characters');
    
    // Generate summary
    const summary = await aiSummarizeTranscript(transcript, meetingId, participants);
    
    // Check if summary generation failed
    if (summary.startsWith('Error') || summary.startsWith('AI is not configured') || summary.startsWith('No transcript')) {
      return res.status(500).json({ 
        error: 'Summary generation failed', 
        message: summary,
        success: false 
      });
    }
    
    // Save summary to meeting document
    try {
      await Meeting.updateOne(
        { meetingId },
        { 
          $set: { 
            summary,
            summaryGeneratedAt: new Date(),
            participants: participants.length > 0 ? participants : meeting.participants || []
          }
        }
      );
      console.log('[API] Summary saved to database for meeting:', meetingId);
    } catch (dbError) {
      console.error('[API] Error saving summary to database:', dbError);
      // Continue even if save fails - we still return the summary
    }
    
    res.json({ 
      summary,
      success: true,
      participants,
      messageCount: chats.length,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Error generating summary:', error);
    console.error('[API] Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to generate summary', 
      message: error.message,
      success: false 
    });
  }
});

router.get('/summary/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    if (!meetingId) {
      return res.status(400).json({ error: 'Missing meetingId', success: false });
    }
    
    const meeting = await Meeting.findOne({ meetingId });
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found', success: false });
    }
    
    if (!meeting.summary) {
      return res.status(404).json({ 
        error: 'No summary found', 
        message: 'Summary has not been generated for this meeting yet.',
        success: false 
      });
    }
    
    res.json({
      summary: meeting.summary,
      success: true,
      participants: meeting.participants || [],
      generatedAt: meeting.summaryGeneratedAt,
      meetingId: meeting.meetingId
    });
  } catch (error) {
    console.error('[API] Error retrieving summary:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve summary', 
      message: error.message,
      success: false 
    });
  }
});

router.post('/assistant', async (req, res) => {
  try {
    const { meetingId, prompt, isHost } = req.body;
    
    console.log('[API] Assistant request received:', { meetingId, prompt: prompt?.substring(0, 50), isHost });
    
    if (!prompt || prompt.trim() === '') {
      console.error('[API] Missing prompt in assistant request');
      return res.status(400).json({ error: 'Missing prompt', reply: 'Please provide a message.' });
    }
    
    // Get recent chat history for context
    let chatHistory = '';
    if (meetingId) {
      try {
        const recentChats = await Chat.find({ meetingId })
          .sort({ createdAt: -1 })
          .limit(10)
          .lean();
        chatHistory = recentChats
          .reverse()
          .map((c) => `${c.sender || 'User'}: ${c.message}`)
          .join('\n');
        console.log('[API] Chat history length:', chatHistory.length);
      } catch (dbError) {
        console.warn('[API] Could not fetch chat history:', dbError.message);
        // Continue without chat history
      }
    }
    
    const context = { chatHistory };
    console.log('[API] Calling aiChatbotReply...');
    const result = await aiChatbotReply(prompt, meetingId, context);
    
    console.log('[API] aiChatbotReply result:', { 
      hasReply: !!result.reply, 
      replyLength: result.reply?.length,
      command: result.command 
    });
    
    // Validate result
    if (!result || typeof result !== 'object') {
      console.error('[API] Invalid result from aiChatbotReply:', result);
      return res.status(500).json({ 
        error: 'Invalid response from AI service', 
        reply: 'Sorry, I encountered an error processing your request.' 
      });
    }
    
    // If command detected and user is host, return command info
    if (result.command && isHost) {
      return res.json({ 
        reply: result.reply || 'Command detected', 
        command: result.command,
        requiresAction: true 
      });
    } else if (result.command && !isHost) {
      return res.json({ 
        reply: 'Sorry, only the meeting host can execute commands. Please ask the host to perform this action.', 
        command: null 
      });
    }
    
    // Ensure reply exists and is not empty
    const reply = result.reply;
    if (!reply || reply.trim() === '') {
      console.error('[API] Empty reply from AI service');
      return res.status(500).json({ 
        error: 'Empty response', 
        reply: 'Sorry, I could not generate a response. Please try again.' 
      });
    }
    
    console.log('[API] Sending reply to client, length:', reply.length);
    res.json({ reply, command: null });
  } catch (error) {
    console.error('[API] Error in assistant endpoint:', error);
    console.error('[API] Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to process request', 
      message: error.message,
      reply: 'Sorry, I encountered an error. Please try again later.' 
    });
  }
});

export default router;



