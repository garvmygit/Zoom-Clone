import mongoose from 'mongoose';

const MeetingSchema = new mongoose.Schema({
  meetingId: { type: String, required: true, unique: true, index: true },
  hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  password: { type: String },
  locked: { type: Boolean, default: false },
  summary: { type: String },
  summaryGeneratedAt: { type: Date },
  participants: [{ type: String }],
}, { timestamps: true });

const Meeting = mongoose.model('Meeting', MeetingSchema);
export default Meeting;





