import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true });

UserSchema.methods.setPassword = async function setPassword(password) {
<<<<<<< HEAD
  // Validate password before hashing
  if (!password || typeof password !== 'string' || password.trim() === '') {
    throw new Error('Password is required and must be a non-empty string');
  }
  
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters long');
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(password, salt);
  } catch (error) {
    console.error('[User] Error hashing password:', error);
    throw new Error('Failed to hash password');
  }
};

UserSchema.methods.validatePassword = async function validatePassword(password) {
  // Validate inputs before comparison to prevent bcrypt.compare() errors
  if (!password || typeof password !== 'string') {
    console.error('[User] Invalid password provided for validation');
    return false;
  }
  
  if (!this.passwordHash || typeof this.passwordHash !== 'string') {
    console.error('[User] User has no password hash stored');
    return false;
  }
  
  try {
    return await bcrypt.compare(password, this.passwordHash);
  } catch (error) {
    console.error('[User] Error comparing password:', error);
    return false;
  }
=======
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(password, salt);
};

UserSchema.methods.validatePassword = async function validatePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
>>>>>>> 335668e3bce26c04c881c51118418269b428e7b6
};

const User = mongoose.model('User', UserSchema);
export default User;





