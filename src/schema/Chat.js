import mongoose from 'mongoose';

const ChatSchema = new mongoose.Schema({
  meetingId: { type: String, required: true, index: true },
  sender: { type: String },
  message: { type: String, required: true },
}, { timestamps: true });

const Chat = mongoose.model('Chat', ChatSchema);
export default Chat;





