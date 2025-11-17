import mongoose from 'mongoose';

// Define the schema for storing chat messages
const ChatSchema = new mongoose.Schema({
  // Unique identifier for the meeting this chat belongs to
  meetingId: { type: String, required: true, index: true },
  
  // Name or ID of the person who sent the message (optional)
  sender: { type: String },
  
  // The content of the message (required field)
  message: { type: String, required: true },
}, { 
  // Automatically add createdAt and updatedAt timestamps
  timestamps: true 
});

// Create a model from the schema to interact with the Chat collection
const Chat = mongoose.model('Chat', ChatSchema);

// Export the Chat model to use in other parts of the application
export default Chat;
