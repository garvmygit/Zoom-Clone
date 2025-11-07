import LocalStrategy from 'passport-local';
import User from '../schema/User.js';

export function configurePassport(passport) {
  passport.use(new LocalStrategy.Strategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await User.findOne({ email });
      if (!user) return done(null, false);
      const ok = await user.validatePassword(password);
      if (!ok) return done(null, false);
      return done(null, user);
    } catch (e) {
      return done(e);
    }
  }));

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user || false);
    } catch (e) {
      done(e);
    }
  });
}





