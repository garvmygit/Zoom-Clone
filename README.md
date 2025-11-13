# ScreenX

Next-generation video conferencing: WebRTC + Socket.IO, modern EJS UI, live chat, screen sharing, recording, and AI summaries.

## Stack
- Frontend: EJS, Tailwind CDN, vanilla JS
- Backend: Node.js, Express.js, Socket.IO
- Database: MongoDB (Mongoose)
- Cache: Redis (for caching API responses and session data)
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
REDIS_HOST=redis-11745.crce182.ap-south-1-1.ec2.cloud.redislabs.com
REDIS_PORT=11745
REDIS_PASSWORD=your-redis-password-here
```
   **Important:** 
   - Get your OpenAI API key from [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - **Never commit `.env` to git** - it contains sensitive secrets. Store `REDIS_PASSWORD` in environment variables or a secrets manager (GitHub Actions Secrets, AWS Secrets Manager, etc.)
4. Install dependencies:
```bash
npm install
```
5. Start dev server:
```bash
npm run dev
```
6. Open http://localhost:3000

**Note:** 
- If `OPENAI_API_KEY` is not set, AI features (meeting summaries and chatbot) will be disabled. The app will still work for video conferencing.
- If `REDIS_PASSWORD` is not set, Redis caching will be disabled. The app will continue to work but without caching benefits.

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

## Docker Deployment

If deploying with Docker, use environment variables or Docker secrets for sensitive values like `REDIS_PASSWORD`.

### Example `docker-compose.yml`:

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - MONGO_URI=${MONGO_URI}
      - SESSION_SECRET=${SESSION_SECRET}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - REDIS_HOST=redis-11745.crce182.ap-south-1-1.ec2.cloud.redislabs.com
      - REDIS_PORT=11745
      - REDIS_PASSWORD=${REDIS_PASSWORD}
    # Alternative: Use Docker secrets for sensitive data
    # secrets:
    #   - redis_password
    # environment:
    #   - REDIS_PASSWORD_FILE=/run/secrets/redis_password

# secrets:
#   redis_password:
#     external: true
```

**Security Note:** Set `REDIS_PASSWORD` in your host environment or use Docker secrets. Never hardcode secrets in `docker-compose.yml` files committed to the repository.

## Scripts
- `npm run dev`: start with nodemon
- `npm start`: start in production
- `npm test`: run unit tests (Jest)
- `npm run test:watch`: run tests in watch mode

## Testing

Tests use mocked Redis and Socket.io, so no live connections are required. The test suite includes:
- Redis caching functionality tests
- Route integration tests
- Basic unit tests

### CI/CD

GitHub Actions workflows are configured to:
- Run tests on push/PR to main/develop branches
- Test against Node.js 18.x and 20.x
- Use GitHub Secrets for sensitive credentials (REDIS_PASSWORD, etc.)

To configure GitHub Secrets:
1. Go to Repository Settings > Secrets and variables > Actions
2. Add secrets: `REDIS_PASSWORD`, `REDIS_HOST`, `REDIS_PORT`
3. Optionally add: `MONGO_URI`, `OPENAI_API_KEY`, `SESSION_SECRET`

## License
MIT





