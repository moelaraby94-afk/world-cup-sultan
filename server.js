const express = require('express');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const db = require('./db');
require('dotenv').config();

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const newsStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'news-' + Date.now() + ext);
  }
});
const newsUpload = multer({
  storage: newsStorage,
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
  contentSecurityPolicy: false,
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
  keyGenerator: (req) => {
    // Use X-Forwarded-For header when behind proxy (Render, etc.)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = forwarded.split(',').map(ip => ip.trim());
      return ips[0] || req.ip;
    }
    return req.ip;
  }
});
app.use(generalLimiter);

// Rate limiting for login/register — أشد (10 محاولات لكل 15 دقيقة)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'طلبات كثيرة جداً، حاول بعد 15 دقيقة',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = forwarded.split(',').map(ip => ip.trim());
      return ips[0] || req.ip;
    }
    return req.ip;
  }
});

// Rate limiting للإدارة — 50 طلب لكل 15 دقيقة
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'طلبات كثيرة جداً، حاول بعد 15 دقيقة',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = forwarded.split(',').map(ip => ip.trim());
      return ips[0] || req.ip;
    }
    return req.ip;
  }
});

// ===== View Engine =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

// ===== Session =====
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-do-not-use-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

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

function isPredictionLocked(matchStart) {
  if (!matchStart) return true;
  const start = new Date(matchStart);
  const lockTime = new Date(start.getTime() - 10 * 60 * 1000);
  return Date.now() >= lockTime.getTime();
}

// ===== Routes =====

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
    req.session.userId = user.id;
    res.redirect('/home');
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
    req.session.userId = user.id;
    res.redirect('/pending');
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
    const publishedRounds = await db.getPublishedRounds();
    const allMatches = await db.getMatches();
    const matches = allMatches.filter(m => publishedRounds.includes(m.round));
    const predictionsWithLock = await Promise.all(matches.map(async match => {
      const pred = await db.getPrediction(req.user.id, match.id);
      return { match, prediction: pred, locked: isPredictionLocked(match.start_at) };
    }));
    const upcomingMatches = matches
      .filter(match => new Date(match.start_at) > Date.now())
      .slice(0, 5)
      .map(match => ({ ...match, locked: isPredictionLocked(match.start_at) }));
    const leaderboard = await db.getLeaderboard();
    const userPredictions = await db.getUserPredictions(req.user.id);
    const predictionsCount = userPredictions.length;
    const correctPredictions = userPredictions.filter(p =>
      p.actual_scoreA != null && p.actual_scoreB != null &&
      p.scoreA === p.actual_scoreA && p.scoreB === p.actual_scoreB
    ).length;
    const lockedWithoutPrediction = matches.filter(m =>
      isPredictionLocked(m.start_at) &&
      !userPredictions.some(p => p.match_id === m.id)
    ).length;
    const userRank = leaderboard.findIndex(p => p.id === req.user.id) + 1;
    const userEntry = leaderboard.find(p => p.id === req.user.id) || null;
    const userPoints = userEntry?.total || 0;
    const top3 = leaderboard.slice(0, 3);
    const allMatchesCount = allMatches.length;
    const lastMatch = allMatches.filter(m => new Date(m.start_at) > Date.now()).slice(0, 1)[0];
    const fifthEntry = leaderboard[4];
    const gapToFifth = fifthEntry && userEntry ? Math.max(0, fifthEntry.total - userEntry.total) : 0;
    const teamFlags = await db.getTeamFlags();
    const newsItems = await db.getNews();
    const lastPrediction = await db.getLastPrediction(req.user.id);
    res.render('home', { user: req.user, matches: predictionsWithLock, upcomingMatches, leaderboard, predictionsCount, correctPredictions, lockedWithoutPrediction, userRank, userPoints, userEntry, top3, allMatchesCount, lastMatch, lastPrediction, gapToFifth, teamFlags, newsItems });
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
      points: db.calculatePoints(item.scoreA, item.scoreB, item.actual_scoreA, item.actual_scoreB)
    }));
    const leaderboard = await db.getLeaderboard();
    const top3 = leaderboard.slice(0, 3);
    const userRank = leaderboard.findIndex(u => u.id === req.user.id) + 1;
    const totalPoints = predictions.reduce((sum, p) => sum + p.points, 0);
    res.render('my-predictions', { user: req.user, predictions, top3, userRank, totalPoints });
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
    const publishedRounds = await db.getPublishedRounds();
    const allMatches = await db.getMatches();
    const matches = allMatches.filter(m => publishedRounds.includes(m.round)).map(match => ({ ...match, locked: isPredictionLocked(match.start_at) }));
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
    const publishedRounds = await db.getPublishedRounds();
    const allMatches = await db.getMatches();
    const matches = allMatches.filter(m => publishedRounds.includes(m.round));

    let groups = await db.getGroupStandings();
    if (!groups) {
      groups = await db.calculateGroupStandings();
    }
    const leaderboard = await db.getLeaderboard();
    const top3 = leaderboard.slice(0, 3);
    const newsItems = await db.getNews();
    const newsComments = {};
    await Promise.all(newsItems.map(async item => {
      newsComments[item.id] = await db.getCommentsByNewsId(item.id);
    }));

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
      res.render('news', { user: req.user, matches, groups: emptyGroups, top3, newsComments: {} });
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
    const predictions = await Promise.all(roundMatches.map(async match => {
      const pred = await db.getPrediction(req.user.id, match.id);
      return { match, prediction: pred, locked: isPredictionLocked(match.start_at) };
    }));
    const leaderboard = await db.getLeaderboard();
    const userPredictions = await db.getUserPredictions(req.user.id);
    const allMatchesCount = allMatches.length;
    const predictionsCount = userPredictions.length;
    const userRank = leaderboard.findIndex(p => p.id === req.user.id) + 1;
    const userPoints = leaderboard.find(p => p.id === req.user.id)?.total || 0;
    const totalPlayers = leaderboard.length;
    const top3 = leaderboard.slice(0, 3);
    res.render('predictions', { user: req.user, matches: predictions, top3, totalPlayers, allMatchesCount, predictionsCount, userRank, userPoints });
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
    const match = await db.getMatchById(matchId);
    if (!match) return res.redirect('/predictions');
    if (isPredictionLocked(match.start_at)) {
      return res.redirect('/predictions');
    }
    const a = parseInt(scoreA, 10);
    const b = parseInt(scoreB, 10);
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0 || a > 99 || b > 99) {
      return res.redirect('/predictions');
    }
    await db.savePrediction(req.user.id, match.id, a, b);
    res.redirect('/predictions');
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
      const start = new Date(m.start_at);
      const lockTime = new Date(start.getTime() - 10 * 60 * 1000);
      const deadlinePassed = Date.now() >= lockTime.getTime();
      const isManuallyVisible = manuallyVisibleIds.includes(m.id);
      const isManuallyHidden = hiddenIds.includes(m.id);
      return (deadlinePassed && !isManuallyHidden) || isManuallyVisible;
    });

    const leaderboard = await db.getLeaderboard();
    const top3 = leaderboard.slice(0, 3);

    const matchesWithPredictions = await Promise.all(visibleMatches.map(async match => {
      const preds = await db.getAllPredictionsForMatch(match.id);
      return { match, predictions: preds };
    }));

    res.render('players-predictions', { user: req.user, matchesWithPredictions, top3, leaderboard });
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

// ===== Admin News Routes =====
app.post('/admin/news/add', requireAuth, requireAdmin, adminLimiter, newsUpload.single('image'), async (req, res) => {
  try {
    const { title, body, breaking } = req.body;
    if (!title || !body) return res.redirect('/dashboard?tab=news');
    const image_path = req.file ? '/uploads/' + req.file.filename : null;
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
      updateData.image_path = '/uploads/' + req.file.filename;
    }
    await db.updateNews(req.params.id, updateData);
    res.redirect('/dashboard?tab=news');
  } catch (err) {
    console.error('Edit news error:', err);
    res.redirect('/dashboard?tab=news');
  }
});

app.post('/admin/news/delete/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const deleted = await db.deleteNews(req.params.id);
    if (deleted && deleted.image_path) {
      const filePath = path.join(__dirname, 'public', deleted.image_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    res.redirect('/dashboard?tab=news');
  } catch (err) {
    console.error('Delete news error:', err);
    res.redirect('/dashboard?tab=news');
  }
});

// ===== News Comments Routes =====
const commentTimers = {};
app.post('/news/comment', requireAuth, async (req, res) => {
  try {
    if (req.user.status !== 'approved') return res.status(403).json({ error: 'غير مصرح' });
    const { newsId, body } = req.body;
    if (!newsId || !body || !body.trim()) return res.status(400).json({ error: 'التعليق فارغ' });
    if (body.length > 300) return res.status(400).json({ error: 'التعليق طويل جداً (300 حرف كحد أقصى)' });
    const lastTime = commentTimers[req.user.id] || 0;
    if (Date.now() - lastTime < 10000) return res.status(429).json({ error: 'الرجاء الانتظار قبل إضافة تعليق آخر' });
    commentTimers[req.user.id] = Date.now();
    const comment = await db.addComment(parseInt(newsId), req.user.id, body.trim());
    const userComment = { ...comment, user_name: req.user.name };
    res.json({ success: true, comment: userComment });
  } catch (err) {
    console.error('Comment error:', err);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

app.post('/admin/comments/hide/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try { await db.hideComment(req.params.id); res.redirect('/dashboard?tab=comments'); } catch (err) { res.redirect('/dashboard?tab=comments'); }
});

app.post('/admin/comments/show/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try { await db.showComment(req.params.id); res.redirect('/dashboard?tab=comments'); } catch (err) { res.redirect('/dashboard?tab=comments'); }
});

app.post('/admin/comments/delete/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.deleteComment(req.params.id);
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
    await db.togglePredictionVisibility(req.params.matchId);
    res.redirect('/dashboard?tab=predictions');
  } catch (err) {
    console.error('Toggle predictions error:', err);
    res.redirect('/dashboard?tab=predictions');
  }
});

app.post('/admin/toggle-round-predictions', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { round, action } = req.body;
    const roundNum = parseInt(round, 10);
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
    await db.approveUser(req.params.id);
    res.redirect('/dashboard?tab=players');
  } catch (err) {
    console.error('Approve error:', err);
    res.redirect('/dashboard?tab=players');
  }
});

app.post('/admin/reject/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    await db.rejectUser(req.params.id);
    res.redirect('/dashboard?tab=players');
  } catch (err) {
    console.error('Reject error:', err);
    res.redirect('/dashboard?tab=players');
  }
});

app.post('/admin/delete/:id', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (userId === req.user.id) return res.redirect('/dashboard?tab=players');
    await db.deleteUser(userId);
    res.redirect('/dashboard?tab=players');
  } catch (err) {
    console.error('Delete error:', err);
    res.redirect('/dashboard?tab=players');
  }
});

app.post('/admin/round', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { round } = req.body;
    await db.setCurrentRound(parseInt(round));
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
    await db.publishRound(parseInt(round));
    res.redirect('/dashboard?tab=rounds');
  } catch (err) {
    console.error('Publish error:', err);
    res.redirect('/dashboard?tab=rounds');
  }
});

app.post('/admin/unpublish-round', requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { round } = req.body;
    await db.unpublishRound(parseInt(round));
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
    const matchPredictions = {};
    await Promise.all(matches.map(async m => {
      matchPredictions[m.id] = await db.getAllPredictionsForMatch(m.id);
    }));
    const groups = db.getGroups();
    const teamFlags = db.getTeamFlags();
    const activeTab = req.query.tab || 'players';
    const newsItems = await db.getNews();
    const allComments = await db.getAllComments();
    res.render('dashboard', { user: req.user, matches, leaderboard, pendingUsers, allUsers, currentRound, publishedRounds, matchesByRound, visiblePredictions, hiddenPredictions, matchPredictions, groups, teamFlags, activeTab, newsItems, allComments, message: null });
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
    if (!teamA || !teamB) return res.redirect('/dashboard?tab=knockout');
    await db.updateKnockoutTeams(parseInt(id), teamA.trim(), teamB.trim());
    res.redirect('/dashboard?tab=knockout');
  } catch (err) {
    console.error('Knockout teams error:', err);
    res.redirect('/dashboard?tab=knockout');
  }
});

// Update Match Result
app.post('/matches/:id/result', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { scoreA, scoreB } = req.body;
    const match = await db.getMatchById(id);
    if (!match) return res.redirect('/dashboard?tab=results');
    
    // لو فاضيين لكلاهما → مسح النتيجة
    const isEmpty = (v) => v === '' || v === undefined || v === null;
    if (isEmpty(scoreA) && isEmpty(scoreB)) {
      await db.updateMatchResult(match.id, null, null);
      await db.calculateGroupStandings();
      await db.advanceKnockoutTeams();
      return res.redirect('/dashboard?tab=results');
    }
    
    const a = parseInt(scoreA, 10);
    const b = parseInt(scoreB, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return res.redirect('/dashboard?tab=results');
    await db.updateMatchResult(match.id, a, b);
    await db.calculateGroupStandings();
    // تقدم الفرق أوتوماتيك في الأدوار الإقصائية
    await db.advanceKnockoutTeams();
    res.redirect('/dashboard?tab=results');
  } catch (err) {
    console.error('Update result error:', err);
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
    
    const validPassword = await bcrypt.compare(currentPassword, user.password);
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
db.init()
  .then(async () => {
    await db.initNewsTable();
    await db.initNewsCommentsTable();
    app.listen(PORT, () => {
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
