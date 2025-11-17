import LocalStrategy from 'passport-local';
import User from '../schema/User.js';

export function configurePassport(passport) {
  passport.use(new LocalStrategy.Strategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      // Validate inputs before database lookup
      if (!email || typeof email !== 'string' || email.trim() === '') {
        return done(null, false, { message: 'Email is required' });
      }
      
      if (!password || typeof password !== 'string' || password.trim() === '') {
        return done(null, false, { message: 'Password is required' });
      }
      
      const user = await User.findOne({ email: email.trim().toLowerCase() });
      if (!user) {
        return done(null, false, { message: 'User not found' });
      }
      //function
      // Validate user has password hash before attempting comparison
      if (!user.passwordHash || typeof user.passwordHash !== 'string') {
        console.error('[Passport] User found but has no password hash:', email);
        return done(null, false, { message: 'Invalid user account' });
      }
      
      const ok = await user.validatePassword(password);
      if (!ok) {
        return done(null, false, { message: 'Invalid password' });
      }
      
      return done(null, user);
    } catch (e) {
      console.error('[Passport] Authentication error:', e);
      return done(e);
    }
  }));

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });
//passport
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user || false);
    } catch (e) {
      done(e);
    }
  });
}





