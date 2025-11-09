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

<<<<<<< HEAD
// Alias for /register to match user requirements
router.get('/register', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  const dbConnected = mongoose.connection.readyState === 1;
  res.render('signup', { title: 'Sign up - ScreenX', user: req.user || null, error: (!dbConnected ? 'Database is not connected. Start MongoDB to create an account.' : null) });
});

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  
  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).render('signup', { 
      title: 'Sign up - ScreenX', 
      error: 'Name is required', 
      user: req.user || null 
    });
  }
  
  if (!email || typeof email !== 'string' || email.trim() === '') {
    return res.status(400).render('signup', { 
      title: 'Sign up - ScreenX', 
      error: 'Email is required', 
      user: req.user || null 
    });
  }
  
  if (!password || typeof password !== 'string' || password.trim() === '') {
    return res.status(400).render('signup', { 
      title: 'Sign up - ScreenX', 
      error: 'Password is required', 
      user: req.user || null 
    });
  }
  
  // Validate password length
  if (password.length < 6) {
    return res.status(400).render('signup', { 
      title: 'Sign up - ScreenX', 
      error: 'Password must be at least 6 characters long', 
      user: req.user || null 
    });
  }
  
=======
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
>>>>>>> 335668e3bce26c04c881c51118418269b428e7b6
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).render('signup', { title: 'Sign up - ScreenX', user: req.user || null, error: 'Database is not connected. Start MongoDB to create an account.' });
    }
<<<<<<< HEAD
    
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(400).render('signup', { 
        title: 'Sign up - ScreenX', 
        error: 'Email already in use', 
        user: req.user || null 
      });
    }
    
    const user = new User({ name: name.trim(), email: email.trim().toLowerCase() });
    
    try {
      await user.setPassword(password);
    } catch (passwordError) {
      console.error('[Auth] Error setting password:', passwordError);
      return res.status(400).render('signup', { 
        title: 'Sign up - ScreenX', 
        error: passwordError.message || 'Invalid password. Password must be at least 6 characters long.', 
        user: req.user || null 
      });
    }
    
    // Verify password hash was set
    if (!user.passwordHash || typeof user.passwordHash !== 'string') {
      console.error('[Auth] Failed to set password hash for user:', email);
      return res.status(500).render('signup', { 
        title: 'Sign up - ScreenX', 
        error: 'Failed to create user account. Please try again.', 
        user: req.user || null 
      });
    }
    
    await user.save();
    req.login(user, (err) => {
      if (err) {
        console.error('[Auth] Login error after signup:', err);
        return res.redirect('/auth/login');
      }
      res.redirect('/');
    });
  } catch (e) {
    console.error('[Auth] Signup error:', e);
    res.status(500).render('signup', { 
      title: 'Sign up - ScreenX', 
      error: 'Failed to create user. Please ensure MongoDB is running.', 
      user: req.user || null 
    });
  }
});

router.post('/login', async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).render('login', { title: 'Login - ScreenX', user: null, dbConnected: false, error: 'Database is not connected. Please try again later.' });
  }

  const { email, password } = req.body;

  // Validate inputs
  if (!email || typeof email !== 'string' || email.trim() === '') {
    return res.status(400).render('login', { 
      title: 'Login - ScreenX', 
      user: null,
      dbConnected: true,
      error: 'Email is required' 
    });
  }
  
  if (!password || typeof password !== 'string' || password.trim() === '') {
    return res.status(400).render('login', { 
      title: 'Login - ScreenX', 
      user: null,
      dbConnected: true,
      error: 'Password is required',
      email: email 
    });
  }

  try {
    // First, check if user exists in database
    const userExists = await User.findOne({ email: email.trim().toLowerCase() });

    if (!userExists) {
      // User not registered - show alert and redirect to registration
      return res.status(401).render('login', { 
        title: 'Login - ScreenX', 
        user: null,
        dbConnected: true,
        error: 'User not registered!',
        redirectToRegister: true 
      });
    }
    
    // Validate user has password hash before attempting authentication
    if (!userExists.passwordHash || typeof userExists.passwordHash !== 'string') {
      console.error('[Auth] User found but has no password hash:', email);
      return res.status(500).render('login', { 
        title: 'Login - ScreenX', 
        user: null,
        dbConnected: true,
        error: 'Invalid user account. Please contact support.' 
      });
    }

    // User exists, now authenticate with passport
    passport.authenticate('local', (err, user, info) => {
      if (err) return next(err);
      
      if (!user) {
        // User exists but password is wrong - show error and stay on login page
        return res.status(401).render('login', { 
          title: 'Login - ScreenX', 
          user: null,
          dbConnected: true,
          error: 'Wrong credentials! Please try again.',
          email: email // Preserve email for better UX
        });
      }

      // Successful login
      req.logIn(user, (e) => {
        if (e) return next(e);
        return res.redirect('/');
      });
    })(req, res, next);
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return res.status(500).render('login', { 
      title: 'Login - ScreenX', 
      user: null,
      dbConnected: mongoose.connection.readyState === 1,
      error: 'An error occurred. Please try again later.' 
    });
  }
=======
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
>>>>>>> 335668e3bce26c04c881c51118418269b428e7b6
});

router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

export default router;

