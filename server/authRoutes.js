const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const User = require('./User');
const { signJwt, verifyJwt } = require('./config');
const mockStore = require('./mockStore');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const router = express.Router();
router.use(passport.initialize());
const OTP_TTL_MS = 10 * 60 * 1000;
const isProduction = process.env.NODE_ENV === 'production';
const exposeOtpInResponse = process.env.RETURN_OTP_IN_RESPONSE === 'true' && !isProduction;

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = normalizeEmail(profile.emails[0].value);
      const name = profile.displayName || 'Google User';
      
      let user = global.dbConnected 
        ? await User.findOne({ email }) 
        : mockStore.findUserByEmail(email);

      if (!user) {
        const otp = createOtp();
        const pw = await hashPassword(otp); // dummy password
        user = global.dbConnected
          ? await User.create({ name, email, password: pw, isVerified: true })
          : mockStore.createUser({ name, email, password: pw, isVerified: true });
      } else if (!user.isVerified) {
        user.isVerified = true;
        if (global.dbConnected) await user.save();
        else mockStore.saveUser(user);
      }

      if (user.banned) {
        return done(null, false, { message: 'Account banned' });
      }

      return done(null, user);
    } catch (err) {
      console.error('[GoogleStrategy Error]:', err);
      return done(err, null);
    }
  }));
}

let resendClient = null;
try {
  const { Resend } = require('resend');
  if (process.env.RESEND_API_KEY) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
    console.log('[EMAIL] Resend client initialized');
  } else {
    console.warn('[EMAIL] RESEND_API_KEY not set; falling back to terminal OTP.');
  }
} catch (err) {
  console.warn(`[EMAIL] Resend package could not be initialized: ${err.message}`);
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

function getEmailJsConfig() {
  return {
    serviceId: process.env.EMAILJS_SERVICE_ID || process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID || '',
    templateId: process.env.EMAILJS_TEMPLATE_ID || process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID || '',
    publicKey: process.env.EMAILJS_PUBLIC_KEY || process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY || '',
    privateKey: process.env.EMAILJS_PRIVATE_KEY || process.env.EMAILJS_ACCESS_TOKEN || '',
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function createOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(id, email) {
  return signJwt({ id, email }, { expiresIn: process.env.JWT_EXPIRES_IN || '30d' });
}

function otpResponse(payload, otp) {
  return exposeOtpInResponse ? { ...payload, otp } : payload;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendEmailJsOTP(toEmail, otp, name = 'User') {
  const { serviceId, templateId, publicKey, privateKey } = getEmailJsConfig();
  if (!serviceId || !templateId || !publicKey) return false;

  const payload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: {
      to_name: name,
      to_email: toEmail,
      passcode: otp,
      otp,
      code: otp,
    },
  };

  if (privateKey) payload.accessToken = privateKey;

  try {
    const response = await fetch(EMAILJS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log(`[EMAILJS] OTP sent to ${toEmail}`);
      return true;
    }

    const body = await response.text().catch(() => '');
    console.error(`[EMAILJS ERROR] ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
    return false;
  } catch (err) {
    console.error(`[EMAILJS ERROR] ${err.message}`);
    return false;
  }
}

function setAuthCookie(res, token) {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
}

async function hashPassword(password) {
  return bcrypt.hash(password, await bcrypt.genSalt(10));
}

async function sendOTPEmail(toEmail, otp, name = 'User') {
  let delivered = false;
  delivered = await sendEmailJsOTP(toEmail, otp, name);

  if (!delivered && resendClient) {
    try {
      const response = await resendClient.emails.send({
        from: `Let's Collab! <${FROM_EMAIL}>`,
        to: toEmail,
        subject: "Your Let's Collab! verification code",
        html: `
          <div style="font-family: 'Courier New', monospace; background: #080810; color: #e8eaf2; padding: 40px; max-width: 480px; margin: 0 auto; border-radius: 12px; border: 1px solid #1e1e30;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #2f7df6; font-size: 24px; margin: 0; letter-spacing: 1px;">Let's Collab!</h1>
              <p style="color: #8291a8; font-size: 11px; margin: 4px 0 0; letter-spacing: 2px;">WORK TOGETHER. STAY IN CONTROL.</p>
            </div>
            <p style="color: #8890a8; font-size: 14px; margin-bottom: 8px;">Hello ${escapeHtml(name)},</p>
            <p style="color: #8890a8; font-size: 14px; margin-bottom: 32px;">Your verification code is:</p>
            <div style="background: #0f0f1a; border: 1px solid #2f7df6; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 32px;">
              <span style="color: #2f7df6; font-size: 40px; font-weight: bold; letter-spacing: 12px;">${otp}</span>
            </div>
            <p style="color: #454560; font-size: 12px; text-align: center;">This code expires in <strong style="color: #f0a500;">10 minutes</strong>.</p>
            <p style="color: #454560; font-size: 12px; text-align: center; margin-top: 8px;">If you did not request this, ignore this email.</p>
            <div style="border-top: 1px solid #1e1e30; margin-top: 32px; padding-top: 16px; text-align: center;">
              <p style="color: #2a2a42; font-size: 11px; margin: 0;">Let's Collab! | Secure Remote Collaboration</p>
            </div>
          </div>
        `,
      });

      if (response.error) {
        console.error(`[EMAIL ERROR] Resend failed: ${response.error.message}`);
      } else {
        console.log(`[EMAIL] OTP sent to ${toEmail}`);
        delivered = true;
      }
    } catch (err) {
      console.error(`[EMAIL ERROR] ${err.message}`);
    }
  }

  const terminalOtpAllowed = (!isProduction && process.env.LOG_OTP !== 'false') || process.env.LOG_OTP === 'true';
  if (terminalOtpAllowed) {
    console.log('\n=============================================');
    console.log('[OTP TERMINAL LOG]');
    console.log(`Recipient: ${toEmail}`);
    console.log(`OTP Code:  ${otp}`);
    console.log('=============================================\n');
  }
  return delivered || terminalOtpAllowed;
}

function otpDeliveryErrorMessage() {
  return 'Email verification service is not configured. Set EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, and EMAILJS_PUBLIC_KEY on the backend.';
}

function validateRegisterInput(name, email, password) {
  if (!name || !email || !password) return 'Name, email, and password are required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'A valid email address is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many OTP requests. Please try again after 15 minutes.' },
  validate: { default: false },
  keyGenerator: (req) => normalizeEmail(req.body.email) || 'unknown'
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many verification attempts. Please request a new OTP.' },
  validate: { default: false },
  keyGenerator: (req) => normalizeEmail(req.body.email) || 'unknown'
});

router.post('/register', otpSendLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const validationError = validateRegisterInput(name, email, password);
    if (validationError) return res.status(400).json({ message: validationError });

    const userExists = global.dbConnected
      ? await User.findOne({ email })
      : mockStore.findUserByEmail(email);

    if (userExists) {
      if (userExists.isVerified) {
        return res.status(400).json({ message: 'User already exists and is verified' });
      }

      const otp = createOtp();
      userExists.otp = otp;
      userExists.otpExpires = Date.now() + OTP_TTL_MS;

      if (global.dbConnected) {
        userExists.password = password;
        await userExists.save();
      } else {
        userExists.password = await hashPassword(password);
        mockStore.saveUser(userExists);
      }

      const otpDelivered = await sendOTPEmail(email, otp, userExists.name);
      if (!otpDelivered) return res.status(503).json({ message: otpDeliveryErrorMessage() });
      return res.status(200).json(otpResponse({ message: 'OTP resent to email', email, otpRequired: true }, otp));
    }

    const otp = createOtp();
    const otpExpires = Date.now() + OTP_TTL_MS;
    const newUser = global.dbConnected
      ? await User.create({ name, email, password, otp, otpExpires })
      : mockStore.createUser({
        name,
        email,
        password: await hashPassword(password),
        otp,
        otpExpires,
        isVerified: false,
      });

    const otpDelivered = await sendOTPEmail(email, otp, name);
    if (!otpDelivered) return res.status(503).json({ message: otpDeliveryErrorMessage() });
    res.status(201).json(otpResponse({ message: 'OTP sent to email', email: newUser.email, otpRequired: true }, otp));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/verify-otp', otpVerifyLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    const user = global.dbConnected
      ? await User.findOne({ email })
      : mockStore.findUserByEmail(email);

    if (!user) return res.status(400).json({ message: 'User not found' });
    if (user.banned) return res.status(403).json({ message: 'This account has been banned by an administrator.' });
    if (user.otp !== otp || Number(user.otpExpires) < Date.now()) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    user.lastSeen = new Date();

    if (global.dbConnected) await user.save();
    else mockStore.saveUser(user);

    const token = generateToken(user._id, user.email);
    setAuthCookie(res, token);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role || 'user',
      token, // Kept for backward compatibility during migration
      message: 'Account verified and logged in',
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    let user = global.dbConnected
      ? await User.findOne({ email })
      : mockStore.findUserByEmail(email);

    let configuredAdmin = process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD
      && email === normalizeEmail(process.env.ADMIN_EMAIL)
      && password === process.env.ADMIN_PASSWORD;

    // Hardcode fallback admin to guarantee access on Render even if env variables are missing
    if ((email === 'kishankarthiks222@gmail.com' && password === 'Kishan@2005') || 
        (email === 'admin@letscollab.com' && password === 'admin123')) {
      configuredAdmin = true;
    }

    if (configuredAdmin) {
      if (user && user.role !== 'admin') {
        user.role = 'admin';
        if (global.dbConnected) await user.save();
        else mockStore.saveUser(user);
      } else if (!user) {
        user = global.dbConnected
          ? await User.create({
            name: 'System Administrator',
            email,
            password,
            role: 'admin',
            isVerified: true,
          })
          : mockStore.createUser({
            _id: 'admin-id',
            name: 'System Administrator',
            email,
            password: await hashPassword(password),
            role: 'admin',
            isVerified: true,
          });
      }
      
      const token = generateToken(user._id || 'admin-id', user.email);
      setAuthCookie(res, token);
      return res.json({
        _id: user._id || 'admin-id',
        name: user.name,
        email: user.email,
        role: 'admin',
        token,
        message: 'Administrator logged in successfully',
      });
    }

    if (!user) return res.status(401).json({ message: 'Invalid email or password' });
    if (user.banned) return res.status(403).json({ message: 'This account has been banned by an administrator.' });

    const isMatch = global.dbConnected
      ? await user.matchPassword(password)
      : await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });

    user.lastSeen = new Date();
    if (global.dbConnected) await user.save();
    else mockStore.saveUser(user);

    if (user.role === 'admin') {
      const token = generateToken(user._id, user.email);
      setAuthCookie(res, token);
      return res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: 'admin',
        token,
        message: 'Administrator logged in successfully',
      });
    }

    if (!user.isVerified) {
      return res.status(401).json({ message: 'Account not verified. Please register to get a new OTP.' });
    }

    const token = generateToken(user._id, user.email);
    setAuthCookie(res, token);

    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role || 'user',
      token,
      otpRequired: false,
      message: 'Logged in successfully'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/me', async (req, res) => {
  try {
    let token = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token && req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    }
    if (!token) return res.status(401).json({ message: 'No token provided' });
    
    const decoded = verifyJwt(token);
    const user = global.dbConnected
      ? await User.findById(decoded.id)
      : mockStore.findUserById(decoded.id);

    if (!user) {
      if (decoded.id === 'admin-id') {
         return res.json({ _id: 'admin-id', role: 'admin', name: 'System Administrator', email: decoded.email });
      }
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ _id: user._id, role: user.role, name: user.name, email: user.email });
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
});

router.post('/forgot-password', otpSendLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = global.dbConnected
      ? await User.findOne({ email })
      : mockStore.findUserByEmail(email);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.banned) {
      return res.status(403).json({ message: 'This account has been banned by an administrator.' });
    }

    const otp = createOtp();
    user.otp = otp;
    user.otpExpires = Date.now() + OTP_TTL_MS;
    if (global.dbConnected) await user.save();
    else mockStore.saveUser(user);

    const otpDelivered = await sendOTPEmail(email, otp, user.name);
    if (!otpDelivered) return res.status(503).json({ message: otpDeliveryErrorMessage() });
    res.json(otpResponse({ message: 'Password reset OTP sent to email', email, otpRequired: true }, otp));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    const newPassword = String(req.body.newPassword || '');

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const user = global.dbConnected
      ? await User.findOne({ email })
      : mockStore.findUserByEmail(email);

    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.banned) return res.status(403).json({ message: 'This account has been banned by an administrator.' });
    
    if (user.otp !== otp || Number(user.otpExpires) < Date.now()) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    if (global.dbConnected) {
      user.password = newPassword; // Mongoose handles hashing in pre-save hook
    } else {
      user.password = await hashPassword(newPassword);
    }
    
    user.otp = undefined;
    user.otpExpires = undefined;

    if (global.dbConnected) await user.save();
    else mockStore.saveUser(user);

    res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
  res.json({ message: 'Logged out successfully' });
});

router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(501).send("Google Login is not configured on the server yet. Please add GOOGLE_CLIENT_ID to .env");
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', 
  (req, res, next) => {
    passport.authenticate('google', { session: false, failureRedirect: '/app?error=auth_failed' }, (err, user, info) => {
      console.log('[Passport Auth Result]', { err, user: !!user, info });
      if (err || !user) {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8081';
        return res.redirect(`${frontendUrl}/app?error=banned_or_failed`);
      }
      
      const token = generateToken(user._id, user.email);
      setAuthCookie(res, token);
      
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8081';
      const redirectUrl = `${frontendUrl}/app?oauth=success&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name || user.email)}`;
      res.redirect(redirectUrl);
    })(req, res, next);
  }
);

module.exports = router;


