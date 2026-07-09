const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');


const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const multer = require('multer');
const db = require('./db');
require('dotenv').config();

const newsUploadDir = path.join(__dirname, 'public', 'uploads', 'news');

const newsUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { cb(null, newsUploadDir); },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const name = 'news_' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 15) + '_' + Math.random().toString(36).slice(2, 6) + ext;
      cb(null, name);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('يجب أن يكون الملف صورة'));
  }
});

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - required when running behind reverse proxy (Dokploy, Nginx, etc.)
app.set('trust proxy', 1);

// ===== Security & Performance =====
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());

// Rate limit عام للموقع — 2000 طلب لكل IP في 15 دقيقة (أو 10000 في dev)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 2000 : 10000,
  message: 'طلبات كثيرة جداً، حاول بعد 15 دقيقة',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(generalLimiter);

// Rate limiting for login/register — أشد (10 محاولات لكل 15 دقيقة)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'طلبات كثيرة جداً، حاول بعد 15 دقيقة',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting للإدارة — 50 طلب لكل 15 دقيقة
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'طلبات كثيرة جداً، حاول بعد 15 دقيقة',
  standardHeaders: true,
  legacyHeaders: false,
});

// ===== View Engine =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

// ===== Session =====
app.use(session({
  secret: process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-only-not-for-production'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: SESSION_SECRET env var is required in production. Exiting.');
  process.exit(1);
}

// ===== Local Variables =====
const teamFlags = db.getTeamFlags();
app.locals.teamFlags = teamFlags;

const navItems = [
  { id: 'home', label: 'الرئيسية', url: '/home', icon: 'home' },
  { id: 'schedule', label: 'المباريات', url: '/schedule', icon: 'schedule' },
  { id: 'predictions', label: 'إضافة توقع', url: '/predictions', icon: 'predict' },
  { id: 'my-predictions', label: 'توقعاتي', url: '/my-predictions', icon: 'list' },
  { id: 'players-predictions', label: 'توقعات المتسابقين', url: '/players-predictions', icon: 'users' },
  { id: 'leaderboard', label: 'الترتيب', url: '/leaderboard', icon: 'trophy' },
  { id: 'challenge', label: 'لعبة التحدي', url: '/challenge', icon: 'trophy' },
  { id: 'rules', label: 'نظام المسابقة', url: '/rules', icon: 'rules' },
  { id: 'news', label: 'أخبار كأس العالم', url: '/news', icon: 'news' },
  { id: 'dashboard', label: 'لوحة التحكم', url: '/dashboard', icon: 'dashboard', adminOnly: true }
];

app.locals.navItems = navItems;
app.locals.mobileMainIds = ['home', 'schedule', 'predictions', 'my-predictions', 'leaderboard'];

app.use((req, res, next) => {
  res.locals.teamFlags = teamFlags;
  res.locals.navItems = navItems;
  res.locals.mobileMainIds = app.locals.mobileMainIds;
  next();
});

// ===== Database Init (أنظر نهاية الملف) =====
// ===== Auth Middleware =====
async function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  try {
    const user = await db.getUserById(req.session.userId);
    if (!user) return res.redirect('/login');
    req.user = user;
    res.locals.unreadCount = await db.getUnreadNewsCount(user.id);
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.redirect('/login');
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).send('لا يوجد تصريح');
  next();
}

function isPredictionLocked(matchStart, lockOverride) {
  if (lockOverride === 'open') return false;
  if (lockOverride === 'closed') return true;
  if (!matchStart) return true;
  const start = new Date(matchStart);
  const lockTime = new Date(start.getTime() - 10 * 60 * 1000);
  return Date.now() >= lockTime.getTime();
}

// ===== Routes =====

// Health check
app.get('/health', async (req, res) => {
  try {
    await db.pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }
});

// Favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Home / Redirect
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/home');
  res.redirect('/login');
});

// Auth Routes
app.get('/login', (req, res) => {
  res.render('login', { message: null });
});

app.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.render('login', { message: 'يرجى ملء جميع الحقول' });
    }
    const user = await db.findUserByUsername(username);
    if (!user) return res.render('login', { message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.render('login', { message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    if (user.status === 'pending') {
      return res.render('login', { message: 'حسابك بانتظار موافقة الإدارة' });
    }
    if (user.status === 'rejected') {
      return res.render('login', { message: 'تم رفض حسابك من الإدارة' });
    }
    req.session.regenerate(() => {
      req.session.userId = user.id;
      res.redirect('/home');
    });
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { message: 'حدث خطأ، حاول مرة أخرى' });
  }
});

app.get('/register', (req, res) => {
  res.render('register', { message: null });
});

app.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, username, password } = req.body;
    if (!name || !username || !password) {
      return res.render('register', { message: 'يرجى ملء جميع الحقول' });
    }
    if (password.length < 6) {
      return res.render('register', { message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }
    if (name.trim().length < 2) {
      return res.render('register', { message: 'الاسم الكامل قصير جداً' });
    }
    if (username.trim().length < 3) {
      return res.render('register', { message: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل' });
    }
    if (!/^[a-zA-Z0-9_؀-ۿ]+$/.test(username.trim())) {
      return res.render('register', { message: 'اسم المستخدم يحتوي على رموز غير مسموح بها' });
    }
    const user = await db.createUser(name.trim(), username.trim(), password);
    req.session.regenerate(() => {
      req.session.userId = user.id;
      res.redirect('/pending');
    });
  } catch (error) {
    return res.render('register', { message: 'اسم المستخدم مستخدم بالفعل، حاول آخر' });
  }
});

app.get('/pending', requireAuth, (req, res) => {
  if (req.user.status === 'approved') return res.redirect('/home');
  res.render('pending', { user: req.user });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Home
app.get('/home', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.redirect('/pending');
    const allMatches = await db.getMatches();
    const matches = allMatches;
    const publishedRounds = await db.getPublishedRounds();
    const leaderboard = await db.getLeaderboard();
    const userPredictions = await db.getUserPredictions(req.user.id);
    const userPredMap = new Map(userPredictions.map(p => [p.match_id, p]));
    const predictionsWithLock = matches.map(match => ({
      match,
      prediction: userPredMap.get(match.id) || null,
      locked: isPredictionLocked(match.start_at, match.lock_override)
    }));
    const upcomingMatches = matches
      .filter(match => new Date(match.start_at) > Date.now())
      .slice(0, 5)
      .map(match => ({ ...match, locked: isPredictionLocked(match.start_at, match.lock_override) }));
    const predictionsCount = userPredictions.length;
    const correctPredictions = userPredictions.filter(p =>
      p.actual_scoreA != null && p.actual_scoreB != null &&
      db.calculatePoints(p.scoreA, p.scoreB, p.actual_scoreA, p.actual_scoreB, p.round, p.penalty_winner, p.actual_penalty_winner) >= 20
    ).length;
    const lockedMatchesForUser = matches.filter(m =>
      publishedRounds.includes(m.round) && isPredictionLocked(m.start_at, m.lock_override) && m.id >= db.MISSED_PREDICTIONS_START_MATCH_ID
    );
    const lockedWithoutPrediction = lockedMatchesForUser.filter(m =>
      !userPredictions.some(p => p.match_id === m.id)
    ).length;
    const commitmentRate = lockedMatchesForUser.length > 0
      ? Math.round(((lockedMatchesForUser.length - lockedWithoutPrediction) / lockedMatchesForUser.length) * 100)
      : 100;
    const userRank = leaderboard.findIndex(p => p.id === req.user.id) + 1;
    const userEntry = leaderboard.find(p => p.id === req.user.id) || null;
    const userPoints = userEntry?.total || 0;
    const top3 = leaderboard.slice(0, 3);
    const allMatchesCount = allMatches.length;
    const lastMatch = allMatches.filter(m => new Date(m.start_at) > Date.now()).slice(0, 1)[0];
    const fifthEntry = leaderboard[4];
    const gapToFifth = fifthEntry && userEntry ? Math.max(0, fifthEntry.total - userEntry.total) : 0;
    const teamFlags = db.getTeamFlags();
    const newsItems = await db.getNews();
    const lastPrediction = await db.getLastPrediction(req.user.id);
    res.render('home', { user: req.user, matches: predictionsWithLock, upcomingMatches, leaderboard, predictionsCount, correctPredictions, lockedWithoutPrediction, commitmentRate, userRank, userPoints, userEntry, top3, allMatchesCount, lastMatch, lastPrediction, gapToFifth, teamFlags, newsItems });
  } catch (err) {
    console.error('Home error:', err);
    res.status(500).render('error', { message: 'حدث خطأ في تحميل الصفحة' });
  }
});

// My Predictions
app.get('/my-predictions', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.redirect('/pending');
    const predictions = (await db.getUserPredictions(req.user.id)).map(item => ({
      ...item,
      points: db.calculatePoints(item.scoreA, item.scoreB, item.actual_scoreA, item.actual_scoreB, item.round, item.penalty_winner, item.actual_penalty_winner)
    }));
    const leaderboard = await db.getLeaderboard();
    const top3 = leaderboard.slice(0, 3);
    const userRank = leaderboard.findIndex(u => u.id === req.user.id) + 1;
    const userEntry = leaderboard.find(u => u.id === req.user.id);
    const predPoints = predictions.reduce((sum, p) => sum + p.points, 0);
    const totalPoints = predPoints + (userEntry?.manual_points || 0) + (userEntry?.challenge_points || 0);
    res.render('my-predictions', { user: req.user, predictions, top3, userRank, totalPoints, predPoints, manualPoints: userEntry?.manual_points || 0, challengePoints: userEntry?.challenge_points || 0 });
  } catch (err) {
    console.error('My predictions error:', err);
    res.status(500).render('error', { message: 'حدث خطأ في تحميل الصفحة' });
  }
});

// Rules
app.get('/rules', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.redirect('/pending');
    const leaderboard = await db.getLeaderboard();
    const top3 = leaderboard.slice(0, 3);
    res.render('rules', { user: req.user, top3 });
  } catch (err) {
    console.error('Rules error:', err);
    res.status(500).render('error', { message: 'حدث خطأ في تحميل الصفحة' });
  }
});

// Schedule
app.get('/schedule', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.redirect('/pending');
    const allMatches = await db.getMatches();
    const matches = allMatches.map(match => ({ ...match, locked: isPredictionLocked(match.start_at, match.lock_override) }));
    const leaderboard = await db.getLeaderboard();
    const userPredictions = await db.getUserPredictions(req.user.id);
    const allMatchesCount = allMatches.length;
    const userRank = leaderboard.findIndex(p => p.id === req.user.id) + 1;
    const userPoints = leaderboard.find(p => p.id === req.user.id)?.total || 0;
    const top3 = leaderboard.slice(0, 3);
    res.render('schedule', { user: req.user, matches, allMatchesCount, predictionsCount: userPredictions.length, userRank, userPoints, totalPlayers: leaderboard.length, top3 });
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).render('error', { message: 'حدث خطأ في تحميل الصفحة' });
  }
});

// News
app.get('/news', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.redirect('/pending');
    const allMatches = await db.getMatches();
    const matches = allMatches;

    let groups = await db.getGroupStandings();
    if (!groups) {
      groups = await db.calculateGroupStandings();
    }
    const leaderboard = await db.getLeaderboard();
    const top3 = leaderboard.slice(0, 3);
    const newsItems = await db.getNews();
    const newsComments = {};
    if (newsItems.length > 0) {
      const allComments = await db.getAllComments();
      for (const c of allComments) {
        if (!newsComments[c.news_id]) newsComments[c.news_id] = [];
        newsComments[c.news_id].push(c);
      }
    }

    res.render('news', { user: req.user, matches, groups, top3, newsItems, newsComments });
  } catch (err) {
    console.error('Error loading news:', err);
    try {
      const publishedRounds = await db.getPublishedRounds();
      const allMatches = await db.getMatches();
      const matches = allMatches.filter(m => publishedRounds.includes(m.round));
      const emptyGroups = [
        { name: 'المجموعة A', teams: [] }, { name: 'المجموعة B', teams: [] },
        { name: 'المجموعة C', teams: [] }, { name: 'المجموعة D', teams: [] },
        { name: 'المجموعة E', teams: [] }, { name: 'المجموعة F', teams: [] },
        { name: 'المجموعة G', teams: [] }, { name: 'المجموعة H', teams: [] },
        { name: 'المجموعة I', teams: [] }, { name: 'المجموعة J', teams: [] },
        { name: 'المجموعة K', teams: [] }, { name: 'المجموعة L', teams: [] }
      ];
      const leaderboard = await db.getLeaderboard();
      const top3 = leaderboard.slice(0, 3);
      res.render('news', { user: req.user, matches, groups: emptyGroups, top3, newsItems: [], newsComments: {} });
    } catch (innerErr) {
      console.error('Fallback news error:', innerErr);
      res.status(500).render('error', { message: 'حدث خطأ في تحميل الأخبار' });
    }
  }
});

// Predictions (GET)
app.get('/predictions', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.redirect('/pending');
    const publishedRounds = await db.getPublishedRounds();
    const allMatches = await db.getMatches();
    const roundMatches = allMatches.filter(m => publishedRounds.includes(m.round));
    const userPredictions = await db.getUserPredictions(req.user.id);
    const userPredMap = new Map(userPredictions.map(p => [p.match_id, p]));
    const predictions = roundMatches.map(match => ({
      match,
      prediction: userPredMap.get(match.id) || null,
      locked: isPredictionLocked(match.start_at, match.lock_override)
    }));
    const leaderboard = await db.getLeaderboard();
    const allMatchesCount = allMatches.length;
    const predictionsCount = userPredictions.length;
    const userRank = leaderboard.findIndex(p => p.id === req.user.id) + 1;
    const userPoints = leaderboard.find(p => p.id === req.user.id)?.total || 0;
    const totalPlayers = leaderboard.length;
    const top3 = leaderboard.slice(0, 3);
    // حساب المباريات الفائتة (من مباراة الأرجنتين × الجزائر فصاعداً)
    var missedPredictions = 0;
    var missedMatchNames = [];
    var lockedMatches = [];
    try {
      lockedMatches = allMatches.filter(function(m) {
        return publishedRounds.includes(m.round) && isPredictionLocked(m.start_at, m.lock_override) && m.id >= db.MISSED_PREDICTIONS_START_MATCH_ID;
      });
      lockedMatches.forEach(function(lm) {
        var hasPred = userPredictions.some(function(p) { return p.match_id === lm.id; });
        if (!hasPred) { missedPredictions++; missedMatchNames.push({ teamA: lm.teamA, teamB: lm.teamB }); }
      });
    } catch (e) { /* ignore */ }
    var commitmentRate = lockedMatches.length > 0 ? Math.round(((lockedMatches.length - missedPredictions) / lockedMatches.length) * 100) : 100;
    var message = null;
    if (req.query.msg === 'saved') message = 'تم حفظ التوقع بنجاح';
    else if (req.query.msg === 'updated') message = 'تم تحديث التوقع بنجاح';
    res.render('predictions', { user: req.user, matches: predictions, top3, totalPlayers, allMatchesCount, predictionsCount, userRank, userPoints, message, missedPredictions, commitmentRate, missedMatchNames });
  } catch (err) {
    console.error('Predictions error:', err);
    res.status(500).render('error', { message: 'حدث خطأ في تحميل الصفحة' });
  }
});

// Predictions (POST)
app.post('/predictions', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.redirect('/pending');
    const { matchId, scoreA, scoreB } = req.body;
    const matchIdInt = parseInt(matchId, 10);
    if (Number.isNaN(matchIdInt)) return res.redirect('/predictions');
    const match = await db.getMatchById(matchIdInt);
    if (!match) return res.redirect('/predictions');
    if (isPredictionLocked(match.start_at, match.lock_override)) {
      return res.redirect('/predictions');
    }
    const a = parseInt(scoreA, 10);
    const b = parseInt(scoreB, 10);
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0 || a > 99 || b > 99) {
      return res.redirect('/predictions');
    }
    var existing = await db.getPrediction(req.user.id, match.id);
    var predictedWinner = req.body.predictedWinner || null;
    var penaltyWinner = req.body.penaltyWinner || null;
    await db.savePrediction(req.user.id, match.id, a, b, predictedWinner, penaltyWinner);
    if (existing) {
      res.redirect('/predictions?msg=updated');
    } else {
      res.redirect('/predictions?msg=saved');
    }
  } catch (err) {
    console.error('Save prediction error:', err);
    res.redirect('/predictions');
  }
});

// Players Predictions
app.get('/players-predictions', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.redirect('/pending');
    const publishedRounds = await db.getPublishedRounds();
    const allMatches = await db.getMatches();
    const manuallyVisibleIds = await db.getVisiblePredictions();
    const hiddenIds = await db.getHiddenPredictions();

    const visibleMatches = allMatches.filter(m => {
      const deadlinePassed = isPredictionLocked(m.start_at, m.lock_override);
      const isManuallyVisible = manuallyVisibleIds.includes(m.id);
      const isManuallyHidden = hiddenIds.includes(m.id);
      return (deadlinePassed && !isManuallyHidden) || isManuallyVisible;
    });

    const leaderboard = await db.getLeaderboard();
    const top3 = leaderboard.slice(0, 3);
    const approvedUsers = await db.getApprovedUsers();

    const visibleMatchIds = visibleMatches.map(m => m.id);
    const allPreds = await db.getAllPredictionsForMatches(visibleMatchIds);
    const predsByMatch = {};
    for (const p of allPreds) {
      if (!predsByMatch[p.match_id]) predsByMatch[p.match_id] = [];
      predsByMatch[p.match_id].push(p);
    }
    const matchesWithPredictions = visibleMatches.map(match => ({
      match,
      predictions: predsByMatch[match.id] || []
    }));

    const challengePicks = await db.getAllChallengePicks();
    const challengeStats = await db.getChallengeStats();

    res.render('players-predictions', { user: req.user, matchesWithPredictions, top3, leaderboard, approvedUsers, challengePicks, challengeStats });
  } catch (err) {
    console.error('Players predictions error:', err);
    res.status(500).render('error', { message: 'حدث خطأ في تحميل الصفحة' });
  }
});

// Leaderboard
app.get('/leaderboard', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.redirect('/pending');
    const leaderboard = await db.getLeaderboard();
    const stats = await db.getLeaderboardStats();
    const top3 = leaderboard.slice(0, 3);
    const userRank = leaderboard.findIndex(p => p.id === req.user.id) + 1;
    const userEntry = leaderboard.find(p => p.id === req.user.id);
    const leaderTotal = leaderboard[0]?.total || 0;
    const gapToLeader = userEntry ? Math.max(0, leaderTotal - userEntry.total) : 0;
    const fifthTotal = leaderboard[4]?.total || 0;
    const gapToFifth = userEntry ? Math.max(0, fifthTotal - userEntry.total) : 0;
    res.render('leaderboard', { user: req.user, leaderboard, top3, userRank, userEntry, gapToLeader, gapToFifth, stats });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).render('error', { message: 'حدث خطأ في تحميل الصفحة' });
  }
});

// ===== Challenge Game =====
app.get('/challenge', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.redirect('/pending');
    const config = await db.getChallengeConfig();
    const picks = await db.getChallengePicks(req.user.id);
    const teams = Object.values(db.getGroups()).flat();
    const top3 = (await db.getLeaderboard()).slice(0, 3);
    const teamFlags = db.getTeamFlags();
    res.render('challenge', { user: req.user, config, picks, teams, top3, teamFlags, saved: req.query.saved === '1' });
  } catch (err) {
    console.error('Challenge error:', err);
    res.status(500).render('error', { message: 'حدث خطأ في تحميل صفحة التحدي' });
  }
});

app.post('/challenge/save', requireAuth, async (req, res) => {
  try {
    const config = await db.getChallengeConfig();
    if (!config.open) return res.redirect('/challenge');
    const { qf, sf, finalists, champion } = req.body;
    if (!Array.isArray(qf) || qf.length !== 8) return res.redirect('/challenge');
    if (!Array.isArray(sf) || sf.length !== 4) return res.redirect('/challenge');
    if (!Array.isArray(finalists) || finalists.length !== 2) return res.redirect('/challenge');
    if (!champion) return res.redirect('/challenge');
    await db.saveChallengePicks(req.user.id, { qf, sf, finalists, champion });
    res.redirect('/challenge?saved=1');
  } catch (err) {
    console.error('Challenge save error:', err);
    res.redirect('/challenge');
  }
});

// ===== Admin News Routes =====
app.post('/admin/news/add', requireAuth, requireAdmin, adminLimiter, newsUpload.single('image'), async (req, res) => {
  try {
    const { title, body, breaking } = req.body;
    if (!title || !body) return res.redirect('/dashboard?tab=news');
    var image_path = null;
    if (req.file) {
      image_path = '/uploads/news/' + req.file.filename;
    }
    await db.addNews({ title, body, image_path, breaking: breaking === 'on' });
    res.redirect('/dashboard?tab=news');
  } catch (err) {
    console.error('Add news error:', err);
    res.redirect('/dashboard?tab=news');
  }
});

app.post('/admin/news/edit/:id', requireAuth, requireAdmin, adminLimiter, newsUpload.single('image'), async (req, res) => {
  try {
    const { title, body, breaking } = req.body;
    if (!title || !body) return res.redirect('/dashboard?tab=news');
    const updateData = { title, body, breaking: breaking === 'on' };
    if (req.file) {
      updateData.image_path = '/uploads/news/' + req.file.filename;
    }
    const editNewsIdInt = parseInt(req.params.id, 10);
    if (Number.isNaN(editNewsIdInt)) return res.redirect('/dashboard?tab=news');
    await db.updateNews(editNewsIdInt, updateData);
    res.redirect('/dashboard?tab=news');
  } catch (err) {
    console.error('Edit news error:', err);
    res.redirect('/dashboard?tab=news');
  }
});

app.post('/admin/news/delete/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const newsIdInt = parseInt(req.params.id, 10);
    if (Number.isNaN(newsIdInt)) return res.redirect('/dashboard?tab=news');
    const deleted = await db.deleteNews(newsIdInt);
    if (deleted && deleted.image_path && deleted.image_path.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, 'public', deleted.image_path.replace(/^\//, ''));
      try { fs.unlinkSync(filePath); } catch (e) { /* file may not exist */ }
    }
    res.redirect('/dashboard?tab=news');
  } catch (err) {
    console.error('Delete news error:', err);
    res.redirect('/dashboard?tab=news');
  }
});

// ===== News Comments Routes =====
app.get('/api/news/readers/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const newsIdInt = parseInt(req.params.id, 10);
    if (isNaN(newsIdInt)) return res.status(400).json({ error: 'Invalid ID' });
    const stats = await db.getNewsReadStats(newsIdInt);
    const unreadUsers = await db.getNewsUnreadUsers(newsIdInt);
    stats.unreadUsers = unreadUsers;
    res.json(stats);
  } catch (err) {
    console.error('News readers error:', err);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

app.post('/news/read/:id', requireAuth, async (req, res) => {
  try {
    await db.markNewsAsRead(req.user.id, parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (err) {
    console.error('Mark news read error:', err);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

app.post('/news/comment', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.status(403).json({ error: 'غير مصرح' });
    const { newsId, body } = req.body;
    if (!newsId || !body || !body.trim()) return res.status(400).json({ error: 'التعليق فارغ' });
    if (body.length > 300) return res.status(400).json({ error: 'التعليق طويل جداً (300 حرف كحد أقصى)' });
    const lastComment = await db.getLastCommentByUser(req.user.id);
    if (lastComment && Date.now() - new Date(lastComment.created_at).getTime() < 10000) {
      return res.status(429).json({ error: 'الرجاء الانتظار قبل إضافة تعليق آخر' });
    }
    const comment = await db.addComment(parseInt(newsId), req.user.id, body.trim());
    const userComment = { ...comment, user_name: req.user.name };
    res.json({ success: true, comment: userComment });
  } catch (err) {
    console.error('Comment error:', err);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

app.post('/admin/comments/hide/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try { await db.hideComment(parseInt(req.params.id, 10)); res.redirect('/dashboard?tab=comments'); } catch (err) { res.redirect('/dashboard?tab=comments'); }
});

app.post('/admin/comments/show/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try { await db.showComment(parseInt(req.params.id, 10)); res.redirect('/dashboard?tab=comments'); } catch (err) { res.redirect('/dashboard?tab=comments'); }
});

app.post('/admin/comments/delete/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.deleteComment(parseInt(req.params.id, 10));
    if (req.accepts('json')) { res.json({ success: true }); }
    else { res.redirect('/dashboard?tab=comments'); }
  } catch (err) {
    if (req.accepts('json')) { res.json({ success: false, error: 'حدث خطأ' }); }
    else { res.redirect('/dashboard?tab=comments'); }
  }
});

// ===== Admin Routes =====
app.post('/admin/toggle-predictions/:matchId', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.togglePredictionVisibility(parseInt(req.params.matchId, 10));
    res.redirect('/dashboard?tab=predictions');
  } catch (err) {
    console.error('Toggle predictions error:', err);
    res.redirect('/dashboard?tab=predictions');
  }
});

app.post('/admin/delete-prediction/:matchId/:userId', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.deletePrediction(parseInt(req.params.matchId), parseInt(req.params.userId));
    res.redirect('/dashboard?tab=predictions');
  } catch (err) {
    console.error('Delete prediction error:', err);
    res.redirect('/dashboard?tab=predictions');
  }
});

app.post('/admin/save-prediction/:matchId/:userId', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { scoreA, scoreB } = req.body;
    const matchIdInt = parseInt(req.params.matchId, 10);
    const userIdInt = parseInt(req.params.userId, 10);
    if (Number.isNaN(matchIdInt) || Number.isNaN(userIdInt)) return res.redirect('/dashboard?tab=predictions');
    await db.savePrediction(userIdInt, matchIdInt, parseInt(scoreA, 10) || 0, parseInt(scoreB, 10) || 0);
    res.redirect('/dashboard?tab=predictions');
  } catch (err) {
    console.error('Save prediction error:', err);
    res.redirect('/dashboard?tab=predictions');
  }
});

app.post('/admin/toggle-round-predictions', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { round, action } = req.body;
    const roundNum = parseInt(round, 10);
    if (Number.isNaN(roundNum)) return res.redirect('/dashboard?tab=predictions');
    const allMatches = await db.getMatches();
    const roundMatches = allMatches.filter(m => m.round === roundNum);
    const matchIds = roundMatches.map(m => m.id);
    const makeVisible = action === 'show';
    await db.toggleRoundPredictionsVisibility(roundNum, matchIds, makeVisible);
    res.redirect('/dashboard?tab=predictions');
  } catch (err) {
    console.error('Toggle round predictions error:', err);
    res.redirect('/dashboard?tab=predictions');
  }
});

app.post('/admin/approve/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.approveUser(parseInt(req.params.id, 10));
    res.redirect('/dashboard?tab=players');
  } catch (err) {
    console.error('Approve error:', err);
    res.redirect('/dashboard?tab=players');
  }
});

app.post('/admin/reject/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.rejectUser(parseInt(req.params.id, 10));
    res.redirect('/dashboard?tab=players');
  } catch (err) {
    console.error('Reject error:', err);
    res.redirect('/dashboard?tab=players');
  }
});

app.post('/admin/delete/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) return res.redirect('/dashboard?tab=players');
    if (userId === req.user.id) return res.redirect('/dashboard?tab=players');
    await db.deleteUser(userId);
    res.redirect('/dashboard?tab=players');
  } catch (err) {
    console.error('Delete error:', err);
    res.redirect('/dashboard?tab=players');
  }
});

app.post('/admin/manual-points', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { userId, points } = req.body;
    const userIdInt = parseInt(userId, 10);
    const pts = parseInt(points, 10);
    if (Number.isNaN(userIdInt) || Number.isNaN(pts) || pts < 0) return res.redirect('/dashboard?tab=players');
    await db.updateManualPoints(userIdInt, pts);
    res.redirect('/dashboard?tab=players');
  } catch (err) {
    console.error('Manual points error:', err);
    res.redirect('/dashboard?tab=players');
  }
});

app.post('/admin/round', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { round } = req.body;
    const roundNum = parseInt(round, 10);
    if (Number.isNaN(roundNum)) return res.redirect('/dashboard');
    await db.setCurrentRound(roundNum);
    await db.calculateGroupStandings();
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Round error:', err);
    res.redirect('/dashboard');
  }
});

app.post('/admin/publish-round', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { round } = req.body;
    const roundNum = parseInt(round, 10);
    if (Number.isNaN(roundNum)) return res.redirect('/dashboard?tab=rounds');
    await db.publishRound(roundNum);
    res.redirect('/dashboard?tab=rounds');
  } catch (err) {
    console.error('Publish error:', err);
    res.redirect('/dashboard?tab=rounds');
  }
});

app.post('/admin/unpublish-round', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { round } = req.body;
    const roundNum = parseInt(round, 10);
    if (Number.isNaN(roundNum)) return res.redirect('/dashboard?tab=rounds');
    await db.unpublishRound(roundNum);
    res.redirect('/dashboard?tab=rounds');
  } catch (err) {
    console.error('Unpublish error:', err);
    res.redirect('/dashboard?tab=rounds');
  }
});

app.get('/dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const matches = await db.getMatches();
    const leaderboard = await db.getLeaderboard();
    const pendingUsers = await db.getPendingUsers();
    const allUsers = await db.getAllUsers();
    const currentRound = await db.getCurrentRound();
    const publishedRounds = await db.getPublishedRounds();
    const visiblePredictions = await db.getVisiblePredictions();
    const hiddenPredictions = await db.getHiddenPredictions();
    const matchesByRound = {};
    matches.forEach(m => {
      if (!matchesByRound[m.round]) matchesByRound[m.round] = [];
      matchesByRound[m.round].push(m);
    });
    // جلب التوقعات لكل مباراة (دفعة واحدة)
    var matchPredictions = {};
    try {
      const allMatchIds = matches.map(m => m.id);
      const allPreds = await db.getAllPredictionsForMatches(allMatchIds);
      for (const p of allPreds) {
        if (!matchPredictions[p.match_id]) matchPredictions[p.match_id] = [];
        matchPredictions[p.match_id].push(p);
      }
    } catch (err) {
      console.error('Error loading match predictions:', err.message || err);
    }
    // Compute missed predictions per user (محمي من الأخطاء)
    // يتم احتساب المباريات الفائتة ابتداءً من MISSED_PREDICTIONS_START_MATCH_ID
    var leaderboardWithMissed = leaderboard;
    try {
      var lockedPublishedMatches = matches.filter(function(m) {
        return publishedRounds.includes(m.round) && isPredictionLocked(m.start_at, m.lock_override) && m.id >= db.MISSED_PREDICTIONS_START_MATCH_ID;
      });
      leaderboardWithMissed = leaderboard.map(function(entry) {
        var lockedPredCount = 0;
        var missedMatchNames = [];
        lockedPublishedMatches.forEach(function(lm) {
          var preds = matchPredictions[lm.id] || [];
          var hasPred = preds.some(function(p) { return p.user_id === entry.id; });
          if (hasPred) lockedPredCount++;
          else missedMatchNames.push({ teamA: lm.teamA, teamB: lm.teamB });
        });
        var missed = lockedPublishedMatches.length - lockedPredCount;
        return Object.assign({}, entry, {
          missed_predictions: missed,
          total_locked_matches: lockedPublishedMatches.length,
          commitment_rate: lockedPublishedMatches.length > 0 ? Math.round(((lockedPublishedMatches.length - missed) / lockedPublishedMatches.length) * 100) : 100,
          missed_match_names: missedMatchNames
        });
      });
    } catch (err) {
      console.error('Missed predictions error:', err.stack || err);
    }

    const groups = db.getGroups();
    const teamFlags = db.getTeamFlags();
    const activeTab = req.query.tab || 'players';
    const newsItems = await db.getNews();
    const allComments = await db.getAllComments();
    const config = await db.getChallengeConfig();
    const challengePicks = await db.getAllChallengePicks();
    const challengeResults = await db.getChallengeResults();
    var challengeStages = [];
    try {
      challengeStages = await db.getChallengeStageState();
    } catch (stageErr) {
      console.error('Challenge stage state error:', stageErr.message || stageErr);
    }
    const newsReadStats = {};
    if (newsItems.length > 0) {
      const allStats = await db.getAllNewsReadStats();
      for (const s of allStats) {
        newsReadStats[s.news_id] = s;
      }
    }
    // بيانات الأدوار الإقصائية
    var seedingPairings = null;
    var bracketStatus = null;
    var bestThirds = null;
    var bracketVerification = null;
    try {
      bestThirds = await db.getBestThirds();
      seedingPairings = await db.getRound32Pairings();
      bracketStatus = await db.getKnockoutBracketStatus();
      bracketVerification = await db.verifyKnockoutBracket();
    } catch (err) {
      console.error('Bracket data error:', err.message || err);
    }

    res.render('dashboard', { user: req.user, matches, leaderboard: leaderboardWithMissed, pendingUsers, allUsers, currentRound, publishedRounds, matchesByRound, visiblePredictions, hiddenPredictions, matchPredictions, groups, teamFlags, activeTab, newsItems, allComments, message: null, config, challengePicks, challengeResults, challengeStages, newsReadStats, seedingPairings, bracketStatus, bestThirds, bracketVerification, lockedPublishedMatchCount: lockedPublishedMatches ? lockedPublishedMatches.length : 0 });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).render('error', { message: 'حدث خطأ في تحميل لوحة التحكم' });
  }
});

// Update Knockout Match Teams
app.post('/admin/knockout-teams/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { teamA, teamB } = req.body;
    const matchIdInt = parseInt(id, 10);
    if (Number.isNaN(matchIdInt)) return res.redirect('/dashboard?tab=knockout');
    if (!teamA || !teamB) return res.redirect('/dashboard?tab=knockout');
    await db.updateKnockoutTeams(matchIdInt, teamA.trim(), teamB.trim());
    res.redirect('/dashboard?tab=knockout');
  } catch (err) {
    console.error('Knockout teams error:', err);
    res.redirect('/dashboard?tab=knockout');
  }
});

// استخراج متأهلي لعبة التحدي بعد أي تغيير في النتائج.
// لا يُسمح لخطأ هنا بإفشال حفظ نتيجة المباراة — لعبة التحدي مستقلة تماماً.
async function syncChallengeSafely() {
  try {
    await db.syncChallengeAfterResults();
  } catch (err) {
    console.error('Challenge sync error (non-fatal):', err.message || err);
  }
}

// Update Match Result
app.post('/matches/:id/result', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { scoreA, scoreB, actualWinner } = req.body;
    const matchIdInt = parseInt(id, 10);
    if (Number.isNaN(matchIdInt)) return res.redirect('/dashboard?tab=results');
    const match = await db.getMatchById(matchIdInt);
    if (!match) return res.redirect('/dashboard?tab=results');
    
    // لو فاضيين لكلاهما → مسح النتيجة
    const isEmpty = (v) => v === '' || v === undefined || v === null;
    if (isEmpty(scoreA) && isEmpty(scoreB)) {
      await db.updateMatchResult(match.id, null, null);
      await db.calculateGroupStandings();
      await db.advanceKnockoutTeams();
      await db.recalculateAllPredictionPoints();
      await syncChallengeSafely();
      return res.redirect('/dashboard?tab=results');
    }

    const a = parseInt(scoreA, 10);
    const b = parseInt(scoreB, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return res.redirect('/dashboard?tab=results');
    var penaltyWinner = req.body.penaltyWinner || null;
    await db.updateMatchResult(match.id, a, b, actualWinner || null, penaltyWinner);
    await db.calculateGroupStandings();
    // تقدم الفرق أوتوماتيك في الأدوار الإقصائية
    await db.advanceKnockoutTeams();
    // إعادة احتساب نقاط جميع التوقعات لهذه المباراة
    await db.recalculateAllPredictionPoints();
    // استخراج متأهلي لعبة التحدي تلقائياً + مزامنة نقاط المراحل المحتسبة
    await syncChallengeSafely();
    res.redirect('/dashboard?tab=results');
  } catch (err) {
    console.error('Update result error:', err);
    res.redirect('/dashboard?tab=results');
  }
});

// تحكم يدوي في قفل/فتح التوقع لمباراة (بغض النظر عن قاعدة الـ10 دقائق التلقائية)
app.post('/admin/match/:id/lock-override', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const matchIdInt = parseInt(req.params.id, 10);
    const mode = req.body.mode;
    if (Number.isNaN(matchIdInt) || !['open', 'closed', 'auto'].includes(mode)) {
      return res.redirect('/dashboard?tab=results');
    }
    await db.setMatchLockOverride(matchIdInt, mode);
    res.redirect('/dashboard?tab=results');
  } catch (err) {
    console.error('Lock override error:', err);
    res.redirect('/dashboard?tab=results');
  }
});

// ===== Admin Change Password =====
app.post('/admin/change-password', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).render('error', { message: 'جميع الحقول مطلوبة' });
    }
    
    if (newPassword !== confirmPassword) {
      return res.status(400).render('error', { message: 'كلمتا المرور الجديدة غير متطابقتين' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).render('error', { message: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
    }
    
    // Verify current password
    const user = await db.getUserById(req.user.id);
    if (!user) {
      return res.status(404).render('error', { message: 'المستخدم غير موجود' });
    }
    
    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      return res.status(400).render('error', { message: 'كلمة المرور الحالية غير صحيحة' });
    }
    
    // Hash new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.updateUserPassword(req.user.id, hashedPassword);
    
    res.redirect('/dashboard?tab=settings');
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).render('error', { message: 'حدث خطأ أثناء تغيير كلمة المرور' });
  }
});

// ===== Admin Challenge =====
app.post('/admin/challenge/deadline', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { deadline } = req.body;
    await db.setChallengeDeadline(deadline);
    res.redirect('/dashboard?tab=challenge');
  } catch (err) { console.error(err); res.redirect('/dashboard?tab=challenge'); }
});

app.post('/admin/challenge/open', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.setChallengeOpen(true);
    res.redirect('/dashboard?tab=challenge');
  } catch (err) { console.error(err); res.redirect('/dashboard?tab=challenge'); }
});

app.post('/admin/challenge/close', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.setChallengeOpen(false);
    res.redirect('/dashboard?tab=challenge');
  } catch (err) { console.error(err); res.redirect('/dashboard?tab=challenge'); }
});

app.post('/admin/challenge/results', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { round, teams } = req.body;
    const teamList = Array.isArray(teams) ? teams : (teams ? [teams] : []);
    await db.setChallengeResults(round, teamList);
    res.redirect('/dashboard?tab=challenge');
  } catch (err) { console.error(err); res.redirect('/dashboard?tab=challenge'); }
});

app.post('/admin/challenge/auto-results', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.autoCalculateChallengeResults();
    res.redirect('/dashboard?tab=challenge');
  } catch (err) { console.error(err); res.redirect('/dashboard?tab=challenge'); }
});

app.post('/admin/challenge/calculate', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.calculateChallengePoints();
    res.redirect('/dashboard?tab=challenge');
  } catch (err) { console.error(err); res.redirect('/dashboard?tab=challenge'); }
});

// احتساب نقاط مرحلة واحدة (دور الـ8 / دور الـ4 / طرفا النهائي / البطل).
// آمن للتكرار: النقاط تُخزَّن لكل مرحلة ثم يُعاد بناء المجموع — لا تتضاعف أبداً.
const CHALLENGE_ROUND_KEYS = ['qf', 'sf', 'finalists', 'champion'];

app.post('/admin/challenge/calculate/:round', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const round = req.params.round;
    if (!CHALLENGE_ROUND_KEYS.includes(round)) return res.redirect('/dashboard?tab=challenge');
    await db.calculateChallengeStagePoints(round);
    res.redirect('/dashboard?tab=challenge');
  } catch (err) {
    console.error('Challenge stage calculate error:', err.message || err);
    res.redirect('/dashboard?tab=challenge');
  }
});

// التراجع عن احتساب مرحلة (يحذف نقاط هذه المرحلة فقط)
app.post('/admin/challenge/reset/:round', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const round = req.params.round;
    if (!CHALLENGE_ROUND_KEYS.includes(round)) return res.redirect('/dashboard?tab=challenge');
    await db.resetChallengeStagePoints(round);
    res.redirect('/dashboard?tab=challenge');
  } catch (err) {
    console.error('Challenge stage reset error:', err.message || err);
    res.redirect('/dashboard?tab=challenge');
  }
});

// ===== Bracket / Seeding Routes =====
// حفظ توزيع الثوالث في دور الـ32 (JSON: { 'R32-03': 'فرنسا', ... })
app.post('/admin/seeding-save', requireAuth, requireAdmin, async (req, res) => {
  try {
    const seeding = {};
    for (const [key, val] of Object.entries(req.body)) {
      if (key.startsWith('third_')) {
        const slot = key.replace('third_', 'R32-');
        if (val) seeding[slot] = val;
      }
    }
    await db.saveRound32Seeding(seeding);
    res.redirect('/dashboard?tab=seeding');
  } catch (err) {
    console.error('Seeding save error:', err);
    res.redirect('/dashboard?tab=seeding');
  }
});

// اعتماد دور الـ32
app.post('/admin/confirm-round32', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.confirmRound32();
    res.redirect('/dashboard?tab=seeding');
  } catch (err) {
    console.error('Confirm R32 error:', err.message);
    res.redirect('/dashboard?tab=seeding');
  }
});

// إعادة بناء الأدوار الإقصائية
app.post('/admin/rebuild-knockout', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.rebuildKnockoutRounds();
    res.redirect('/dashboard?tab=seeding');
  } catch (err) {
    console.error('Rebuild knockout error:', err.message);
    res.redirect('/dashboard?tab=seeding');
  }
});

// فحص مسار الأدوار الإقصائية (JSON)
app.get('/admin/verify-bracket', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await db.verifyKnockoutBracket();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إعادة ربط مسارات الأدوار الإقصائية (آمن — لا يمس النتائج أو التوقعات)
app.post('/admin/relink-bracket', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.relinkBracketPaths();
    await db.resetKnockoutTeamsFromRound(5);
    await db.advanceKnockoutTeams();
    await db.recalculateAllPredictionPoints();
    await syncChallengeSafely();
    res.redirect('/dashboard?tab=seeding');
  } catch (err) {
    console.error('Relink bracket error:', err.message);
    res.redirect('/dashboard?tab=seeding');
  }
});

// ===== 404 Handler =====
app.use((req, res) => {
  res.status(404).render('error', { message: 'الصفحة غير موجودة' });
});

// ===== Error Handler =====
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).render('error', { message: 'حدث خطأ داخلي في الخادم' });
});

// ===== Start Server (بعد تهيئة قاعدة البيانات) =====
let server;
// Ensure uploads/news directory exists
if (!fs.existsSync(newsUploadDir)) {
  fs.mkdirSync(newsUploadDir, { recursive: true });
  console.log('✓ Created uploads/news directory');
}

db.init()
  .then(async () => {
    await db.initNewsTable();
    await db.initNewsCommentsTable();
    await db.initNewsReadsTable();

    // Migration: إعادة ربط مسارات الأدوار الإقصائية بالترتيب الصحيح
    try {
      const relinkCheck = await db.pool.query("SELECT value FROM settings WHERE key = 'bracket_paths_v4_relinked'");
      if (relinkCheck.rows.length === 0) {
        console.log('Migration: relinking bracket paths (v4 — fix R16-05/06/08 pairings)...');
        await db.relinkBracketPaths();
        await db.pool.query("INSERT INTO settings (key, value) VALUES ('bracket_paths_v4_relinked', '1') ON CONFLICT (key) DO UPDATE SET value = '1'");
        console.log('Migration: bracket paths relinked. Resetting R16+ teams to placeholders...');
        await db.resetKnockoutTeamsFromRound(5);
        console.log('Migration: teams reset. Re-advancing winners with correct paths...');
        await db.advanceKnockoutTeams();
        await db.recalculateAllPredictionPoints();
        console.log('Migration: winners re-advanced and points recalculated.');
      }
    } catch (migrateErr) {
      console.error('Migration relink error (non-fatal):', migrateErr.message);
    }

    // Migration: تصحيح مواعيد R16-05 (أمريكا/بلجيكا) و R16-06 (إسبانيا/البرتغال) — كانت مقلوبة
    // الصحيح: R16-06 يُلعب الساعة 19:00 UTC، R16-05 يُلعب بعده الساعة 00:00 UTC (اليوم التالي)
    try {
      const r16TimeCheck = await db.pool.query("SELECT value FROM settings WHERE key = 'r16_kickoff_time_fix_v1'");
      if (r16TimeCheck.rows.length === 0) {
        console.log('Migration: fixing R16-05/R16-06 kickoff times...');
        await db.pool.query("UPDATE matches SET start_at = '2026-07-06T19:00:00Z' WHERE match_label = 'R16-06'");
        await db.pool.query("UPDATE matches SET start_at = '2026-07-07T00:00:00Z' WHERE match_label = 'R16-05'");
        await db.pool.query("INSERT INTO settings (key, value) VALUES ('r16_kickoff_time_fix_v1', '1') ON CONFLICT (key) DO UPDATE SET value = '1'");
        db.invalidateMatchesCache();
        console.log('Migration: R16-05/R16-06 kickoff times fixed.');
      }
    } catch (timeFixErr) {
      console.error('R16 kickoff time fix migration error (non-fatal):', timeFixErr.message);
    }

    // إعادة استخراج متأهلي لعبة التحدي عند الإقلاع.
    // يصحح أي صفوف قديمة خاطئة في challenge_results خلّفتها النسخة السابقة
    // (كانت تقرأ الفائزين من الدور الخطأ وتخزن أسماء مواضع مؤقتة مثل "فائز نصف 1").
    // لا يمنح أي نقاط — الأدمن هو من يضغط زر الاحتساب لكل مرحلة.
    try {
      await db.autoCalculateChallengeResults();
      console.log('✓ Challenge qualifiers re-extracted from approved match results');
    } catch (challengeErr) {
      console.error('Challenge auto-extract error (non-fatal):', challengeErr.message);
    }

    // ===== Auto-publish next round when current round is fully locked =====
    async function autoPublishNextRound() {
      try {
        const publishedRounds = await db.getPublishedRounds();
        if (publishedRounds.length === 0) return;
        const lastPublished = Math.max(...publishedRounds);
        if (lastPublished >= 8) return;

        const allMatches = await db.getMatches();
        const lastRoundMatches = allMatches.filter(m => m.round === lastPublished);
        if (lastRoundMatches.length === 0) return;

        const allLocked = lastRoundMatches.every(m => isPredictionLocked(m.start_at, m.lock_override));
        if (!allLocked) return;

        const nextRound = lastPublished + 1;
        if (publishedRounds.includes(nextRound)) return;

        const nextRoundMatches = allMatches.filter(m => m.round === nextRound);
        if (nextRoundMatches.length === 0) return;

        console.log(`Auto-publishing round ${nextRound} (round ${lastPublished} fully locked)`);
        await db.publishRound(nextRound);
      } catch (err) {
        console.error('Auto-publish error:', err.message || err);
      }
    }

    setInterval(autoPublishNextRound, 60 * 1000);

    server = app.listen(PORT, () => {
      console.log(`✓ Server running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('✗ Failed to initialize database:', err);
    process.exit(1);
  });

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    db.pool.end();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server...');
  server.close(() => {
    db.pool.end();
    process.exit(0);
  });
});
