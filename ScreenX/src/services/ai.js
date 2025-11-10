import OpenAI from 'openai';

// Get and validate OpenAI API key
const openaiKey = process.env.OPENAI_API_KEY?.trim();
const openai = openaiKey && openaiKey.length > 0 ? new OpenAI({ apiKey: openaiKey }) : null;

// Log configuration status on module load
if (!openai) {
  console.warn('[AI Service] OpenAI API key not configured. AI features will be disabled.');
  console.warn('[AI Service] Set OPENAI_API_KEY in your .env file to enable AI features.');
} else {
  console.log('[AI Service] OpenAI API configured and ready.');
}

export async function aiSummarizeTranscript(transcript, meetingId, participants = []) {
  if (!openai) {
    console.error('[AI] OpenAI not configured - OPENAI_API_KEY missing');
    return 'AI is not configured. Provide OPENAI_API_KEY to enable summaries.';
  }
  
  if (!transcript || transcript.trim().length === 0) {
    console.warn('[AI] Empty transcript provided for meeting:', meetingId);
    return 'No transcript available. There are no chat messages to summarize yet.';
  }
  
  try {
    const participantsList = participants.length > 0 
      ? `\n\nParticipants: ${participants.join(', ')}`
      : '';
    
    const systemPrompt = `You are an AI meeting assistant. Your task is to create a clear, structured, and comprehensive summary of the meeting transcript provided. 

Format your summary as follows:

📋 MEETING SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 KEY POINTS
[List the main topics and important points discussed]

✅ DECISIONS MADE
[Any decisions or conclusions reached during the meeting]

📝 ACTION ITEMS
[Tasks assigned with owners if mentioned, or "To be determined" if no owner specified]

👥 PARTICIPANTS
[List all participants mentioned in the transcript]

💡 ADDITIONAL NOTES
[Any other relevant information, follow-ups, or important details]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Be concise but thorough. Use bullet points for clarity.`;

    const userPrompt = `Meeting ID: ${meetingId}${participantsList}

TRANSCRIPT:
${transcript}

Please provide a comprehensive summary following the format specified above.`;

    console.log('[AI] Generating summary for meeting:', meetingId);
    console.log('[AI] Transcript length:', transcript.length, 'characters');
    
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });
    
    const summary = res.choices?.[0]?.message?.content;
    
    if (!summary) {
      console.error('[AI] Empty response from OpenAI API');
      return 'No summary generated. The AI service returned an empty response.';
    }
    
    console.log('[AI] Summary generated successfully, length:', summary.length, 'characters');
    return summary;
  } catch (error) {
    console.error('[AI] Error generating summary:', error);
    console.error('[AI] Error details:', {
      message: error.message,
      status: error.status,
      statusText: error.statusText,
      code: error.code,
      type: error.type
    });
    
    // Handle OpenAI API errors more specifically
    if (error.status === 401) {
      return 'Error: Invalid API key. Please check your OPENAI_API_KEY in the .env file.';
    } else if (error.status === 429) {
      return 'Error: Rate limit exceeded. Please wait a moment and try again.';
    } else if (error.status === 500) {
      return 'Error: OpenAI service is temporarily unavailable. Please try again later.';
    } else if (error.status) {
      return `Error generating summary: ${error.status} - ${error.message || 'API error'}`;
    } else if (error.message) {
      return `Error generating summary: ${error.message}`;
    }
    return 'Error generating summary: Unknown error occurred. Please check your OPENAI_API_KEY and try again.';
  }
}

export function detectCommand(prompt) {
  const lower = prompt.toLowerCase().trim();
  const commands = {
    'mute all': 'mute-all',
    'mute everyone': 'mute-all',
    'lock meeting': 'lock',
    'lock the meeting': 'lock',
    'unlock meeting': 'unlock',
    'unlock the meeting': 'unlock',
    'end meeting': 'end',
    'end the meeting': 'end',
    'close meeting': 'end',
    'summarize': 'summarize',
    'summary': 'summarize',
    'generate summary': 'summarize',
    'meeting summary': 'summarize',
  };
  
  for (const [key, value] of Object.entries(commands)) {
    if (lower.includes(key)) {
      return value;
    }
  }
  return null;
}

export async function aiChatbotReply(prompt, meetingId, context = {}) {
  if (!openai) {
    console.warn('[AI] OpenAI not configured - returning error message');
    return { reply: 'AI is not configured. Please set OPENAI_API_KEY in your .env file to enable AI features.', command: null };
  }
  
  const command = detectCommand(prompt);
  if (command) {
    console.log('[AI] Command detected:', command);
    return { reply: `I'll help you with that. Executing: ${command}`, command };
  }
  
  try {
    console.log('[AI] Generating chatbot reply for prompt:', prompt.substring(0, 50));
    
    const systemPrompt = `You are ScreenX Assistant, a helpful AI assistant for video conferencing meetings. 
- Be friendly, concise, and helpful
- Answer questions about the meeting, participants, and general topics
- If asked about meeting details, use the context provided
- Keep responses under 150 words unless summarizing
- You can help with meeting controls, summaries, and general questions
- Be conversational and engaging`;

    const userContext = context.chatHistory 
      ? `Recent chat context:\n${context.chatHistory}\n\n`
      : '';
    
    const userPrompt = `${userContext}User question: ${prompt}`;
    
    console.log('[AI] Calling OpenAI API...');
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 300,
    });
    
    console.log('[AI] OpenAI API response received');
    console.log('[AI] Response structure:', {
      hasChoices: !!res.choices,
      choicesLength: res.choices?.length,
      hasMessage: !!res.choices?.[0]?.message,
      hasContent: !!res.choices?.[0]?.message?.content
    });
    
    const reply = res.choices?.[0]?.message?.content;
    
    if (!reply || reply.trim() === '') {
      console.error('[AI] Empty reply from OpenAI API');
      console.error('[AI] Full response:', JSON.stringify(res, null, 2));
      return { reply: 'Sorry, I received an empty response. Please try again.', command: null };
    }
    
    console.log('[AI] Reply generated successfully, length:', reply.length);
    return { reply: reply.trim(), command: null };
  } catch (error) {
    console.error('[AI] Error generating chatbot reply:', error);
    console.error('[AI] Error details:', {
      message: error.message,
      status: error.status,
      statusText: error.statusText,
      code: error.code,
      type: error.type
    });
    
    // Handle OpenAI API errors more specifically
    if (error.status === 401) {
      return { reply: 'Error: Invalid API key. Please check your OPENAI_API_KEY in the .env file.', command: null };
    } else if (error.status === 429) {
      return { reply: 'Error: Rate limit exceeded. Please wait a moment and try again.', command: null };
    } else if (error.status === 500) {
      return { reply: 'Error: OpenAI service is temporarily unavailable. Please try again later.', command: null };
    } else if (error.status) {
      return { reply: `Error: ${error.status} - ${error.message || 'API error'}`, command: null };
    } else if (error.message) {
      return { reply: `Error: ${error.message}`, command: null };
    }
    return { reply: 'Error: Unknown error occurred. Please check your OPENAI_API_KEY and try again.', command: null };
  }
}





