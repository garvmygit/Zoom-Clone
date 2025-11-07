import { Router } from 'express';
import passport from 'passport';
import User from '../schema/User.js';
import mongoose from 'mongoose';

const router = Router();

router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  const dbConnected = mongoose.connection.readyState === 1;
  res.render('login', { title: 'Login - ScreenX', user: req.user || null, dbConnected });
});

router.get('/signup', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  const dbConnected = mongoose.connection.readyState === 1;
  res.render('signup', { title: 'Sign up - ScreenX', user: req.user || null, error: (!dbConnected ? 'Database is not connected. Start MongoDB to create an account.' : null) });
});

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).render('signup', { title: 'Sign up - ScreenX', user: req.user || null, error: 'Database is not connected. Start MongoDB to create an account.' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).render('signup', { title: 'Sign up - ScreenX', error: 'Email already in use', user: req.user || null });
    const user = new User({ name, email });
    await user.setPassword(password);
    await user.save();
    req.login(user, (err) => {
      if (err) return res.redirect('/auth/login');
      res.redirect('/');
    });
  } catch (e) {
    res.status(500).render('signup', { title: 'Sign up - ScreenX', error: 'Failed to create user. Please ensure MongoDB is running.', user: req.user || null });
  }
});

router.post('/login', (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).render('login', { title: 'Login - ScreenX', user: null, dbConnected: false });
  }
  passport.authenticate('local', (err, user) => {
    if (err) return next(err);
    if (!user) return res.status(401).render('login', { title: 'Login - ScreenX', user: null });
    req.logIn(user, (e) => {
      if (e) return next(e);
      return res.redirect('/');
    });
  })(req, res, next);
});

router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

export default router;

