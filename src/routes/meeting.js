import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Meeting from '../schema/Meeting.js';

const router = Router();

router.get('/', (req, res) => {
  res.render('index', { user: req.user });
});

router.post('/create', async (req, res) => {
  const id = uuidv4().split('-')[0];
  const pass = Math.random().toString(36).slice(2, 8);
  const meeting = await Meeting.create({
    meetingId: id,
    hostUserId: req.user?._id || null,
    password: pass,
    locked: false,
  });
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const link = `${proto}://${host}/meet/${meeting.meetingId}?p=${encodeURIComponent(pass)}`;
  res.render('created', {
    user: req.user,
    meetingId: meeting.meetingId,
    password: pass,
    link,
    isHost: !!req.user,
  });
});

router.get('/join', (req, res) => {
  res.render('join', { user: req.user });
});

router.get('/meet/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { p, name } = req.query;
    
    if (!meetingId || meetingId.trim() === '') {
      return res.status(400).render('join', { 
        user: req.user, 
        error: 'Meeting ID is required' 
      });
    }
    
    const meeting = await Meeting.findOne({ meetingId: meetingId.trim() });
    
    if (!meeting) {
      return res.status(404).render('404', { 
        user: req.user,
        message: 'Meeting not found. Please check the meeting ID and try again.' 
      });
    }
    
    if (meeting.locked) {
      return res.status(403).render('403', { 
        user: req.user,
        message: 'This meeting is locked. Only the host can unlock it.' 
      });
    }
    
    if (meeting.password && p !== meeting.password) {
      return res.status(403).render('join', { 
        user: req.user,
        error: 'Invalid password. Please check your password and try again.' 
      });
    }
    
    // Get display name: from query param, logged-in user, or prompt
    let displayName = name || (req.user && req.user.name) || null;
    
    // If no name provided, redirect to join page with meeting info
    if (!displayName || displayName.trim() === '') {
      return res.render('join', { 
        user: req.user,
        error: 'Please enter your name to join the meeting.',
        meetingId: meeting.meetingId,
        password: p || ''
      });
    }
    
    const isHost = req.user && String(req.user._id) === String(meeting.hostUserId);
    
    res.render('meeting', {
      meetingId: meeting.meetingId,
      meetingPassword: meeting.password,
      isHost: isHost,
      user: req.user,
      displayName: displayName.trim(),
    });
  } catch (error) {
    console.error('[Meeting] Error joining meeting:', error);
    res.status(500).render('join', { 
      user: req.user,
      error: 'An error occurred while joining the meeting. Please try again.' 
    });
  }
});

export default router;

