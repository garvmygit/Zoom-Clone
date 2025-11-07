# ScreenX

Next-generation video conferencing: WebRTC + Socket.IO, modern EJS UI, live chat, screen sharing, recording, and AI summaries.

## Stack
- Frontend: EJS, Tailwind CDN, vanilla JS
- Backend: Node.js, Express.js, Socket.IO
- Database: MongoDB (Mongoose)
- Auth: Passport (local strategy + sessions)
- AI: OpenAI API (chat + summaries)

## Setup
1. Install Node 18+ and MongoDB.
2. Copy the example environment file:
```bash
cp .env.example .env
```
3. Edit `.env` and add your configuration:
```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/screenx
SESSION_SECRET=change-me-to-a-random-secret-string
OPENAI_API_KEY=sk-your-openai-api-key-here
```
   **Important:** Get your OpenAI API key from [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
4. Install dependencies:
```bash
npm install
```
5. Start dev server:
```bash
npm run dev
```
6. Open http://localhost:3000

**Note:** If `OPENAI_API_KEY` is not set, AI features (meeting summaries and chatbot) will be disabled. The app will still work for video conferencing.

## Features
- Create/Join meetings with ID + optional password
- Real-time A/V via WebRTC mesh
- Socket.IO signaling, rooms, and chat
- Screen share and local recording (WebM)
- Admin controls: lock/unlock, mute, end meeting
- AI assistant (Q&A) and post-meeting summary

## Notes
- STUN is Google public. For production, use TURN for NAT traversal.
- Recording is local download; server-side recording not included.
- Tailwind via CDN for simplicity.

## Scripts
- `npm run dev`: start with nodemon
- `npm start`: start in production

## License
MIT





