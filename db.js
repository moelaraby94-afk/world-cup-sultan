const { Pool, types } = require('pg');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Force TIMESTAMP (type 1114) values to be treated as UTC regardless of Node.js timezone
types.setTypeParser(1114, (val) => new Date(val + 'Z'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
});

// نقطة البداية لاحتساب المباريات الفائتة (بعد فقدان البيانات القديمة)
const MISSED_PREDICTIONS_START_MATCH_ID = 513; // أول مباراة في قاعدة البيانات الحالية

const GROUPS = {
  'المجموعة A': ['المكسيك', 'جنوب أفريقيا', 'كوريا الجنوبية', 'التشيك'],
  'المجموعة B': ['كندا', 'البوسنة والهرسك', 'قطر', 'سويسرا'],
  'المجموعة C': ['البرازيل', 'المغرب', 'هايتي', 'إسكتلندا'],
  'المجموعة D': ['الولايات المتحدة', 'باراغواي', 'أستراليا', 'تركيا'],
  'المجموعة E': ['ألمانيا', 'كوراساو', 'ساحل العاج', 'الإكوادور'],
  'المجموعة F': ['هولندا', 'اليابان', 'السويد', 'تونس'],
  'المجموعة G': ['بلجيكا', 'مصر', 'إيران', 'نيوزيلندا'],
  'المجموعة H': ['إسبانيا', 'الرأس الأخضر', 'السعودية', 'الأوروغواي'],
  'المجموعة I': ['فرنسا', 'السنغال', 'العراق', 'النرويج'],
  'المجموعة J': ['الأرجنتين', 'الجزائر', 'النمسا', 'الأردن'],
  'المجموعة K': ['البرتغال', 'الكونغو الديمقراطية', 'أوزبكستان', 'كولومبيا'],
  'المجموعة L': ['إنجلترا', 'كرواتيا', 'غانا', 'بنما']
};

// الجدول الرسمي لمسارات الأدوار الإقصائية — مطابق لـ FIFA 2026
// ترتيب المباريات حسب generateFixtures (تسلسل ID)
// مسارات الفائزين حسب الجدول الرسمي للبطولة
const BRACKET_SLOTS = {
  round4: [ // دور الـ 32 — 16 مباراة
    // M49 / FIFA M73: ثاني A vs ثاني B → R16-01 teamA
    { label: 'R32-01', teamA: { type: 'group_second', group: 'A' }, teamB: { type: 'group_second', group: 'B' }, winnerTo: 'R16-01', side: 'teamA' },
    // M50 / FIFA M76: أول C vs ثاني F → R16-03 teamA
    { label: 'R32-02', teamA: { type: 'group_first', group: 'C' }, teamB: { type: 'group_second', group: 'F' }, winnerTo: 'R16-03', side: 'teamA' },
    // M51 / FIFA M74: أول E vs BestThird → R16-02 teamA
    { label: 'R32-03', teamA: { type: 'group_first', group: 'E' }, teamB: { type: 'best_third', index: 1 }, winnerTo: 'R16-02', side: 'teamA' },
    // M52 / FIFA M75: أول F vs ثاني C → R16-01 teamB
    { label: 'R32-04', teamA: { type: 'group_first', group: 'F' }, teamB: { type: 'group_second', group: 'C' }, winnerTo: 'R16-01', side: 'teamB' },
    // M53 / FIFA M78: ثاني E vs ثاني I → R16-03 teamB
    { label: 'R32-05', teamA: { type: 'group_second', group: 'E' }, teamB: { type: 'group_second', group: 'I' }, winnerTo: 'R16-03', side: 'teamB' },
    // M54 / FIFA M77: أول I vs BestThird → R16-02 teamB
    { label: 'R32-06', teamA: { type: 'group_first', group: 'I' }, teamB: { type: 'best_third', index: 2 }, winnerTo: 'R16-02', side: 'teamB' },
    // M55 / FIFA M79: أول A vs BestThird → R16-04 teamA
    { label: 'R32-07', teamA: { type: 'group_first', group: 'A' }, teamB: { type: 'best_third', index: 3 }, winnerTo: 'R16-04', side: 'teamA' },
    // M56 / FIFA M80: أول L vs BestThird → R16-04 teamB
    { label: 'R32-08', teamA: { type: 'group_first', group: 'L' }, teamB: { type: 'best_third', index: 4 }, winnerTo: 'R16-04', side: 'teamB' },
    // M57 / FIFA M82: أول G vs BestThird → R16-05 teamA
    { label: 'R32-09', teamA: { type: 'group_first', group: 'G' }, teamB: { type: 'best_third', index: 5 }, winnerTo: 'R16-05', side: 'teamA' },
    // M58 / FIFA M81: أول D vs BestThird → R16-05 teamB
    { label: 'R32-10', teamA: { type: 'group_first', group: 'D' }, teamB: { type: 'best_third', index: 6 }, winnerTo: 'R16-05', side: 'teamB' },
    // M59 / FIFA M84: أول H vs ثاني J → R16-06 teamA
    { label: 'R32-11', teamA: { type: 'group_first', group: 'H' }, teamB: { type: 'group_second', group: 'J' }, winnerTo: 'R16-06', side: 'teamA' },
    // M60 / FIFA M83: ثاني K vs ثاني L → R16-06 teamB
    { label: 'R32-12', teamA: { type: 'group_second', group: 'K' }, teamB: { type: 'group_second', group: 'L' }, winnerTo: 'R16-06', side: 'teamB' },
    // M61 / FIFA M85: أول B vs BestThird → R16-08 teamA
    { label: 'R32-13', teamA: { type: 'group_first', group: 'B' }, teamB: { type: 'best_third', index: 7 }, winnerTo: 'R16-08', side: 'teamA' },
    // M62 / FIFA M88: ثاني D vs ثاني G → R16-07 teamB
    { label: 'R32-14', teamA: { type: 'group_second', group: 'D' }, teamB: { type: 'group_second', group: 'G' }, winnerTo: 'R16-07', side: 'teamB' },
    // M63 / FIFA M86: أول J vs ثاني H → R16-07 teamA
    { label: 'R32-15', teamA: { type: 'group_first', group: 'J' }, teamB: { type: 'group_second', group: 'H' }, winnerTo: 'R16-07', side: 'teamA' },
    // M64 / FIFA M87: أول K vs BestThird → R16-08 teamB
    { label: 'R32-16', teamA: { type: 'group_first', group: 'K' }, teamB: { type: 'best_third', index: 8 }, winnerTo: 'R16-08', side: 'teamB' },
  ],
  round5: [ // دور الـ 16 — حسب ترتيب المباريات في generateFixtures
    // M65 / FIFA M90: فائز R32-01 vs فائز R32-04 → QF-01 teamA
    { label: 'R16-01', winnerTo: 'QF-01', side: 'teamA' },
    // M66 / FIFA M89: فائز R32-03 vs فائز R32-06 → QF-01 teamB
    { label: 'R16-02', winnerTo: 'QF-01', side: 'teamB' },
    // M67 / FIFA M91: فائز R32-02 vs فائز R32-05 → QF-03 teamA
    { label: 'R16-03', winnerTo: 'QF-03', side: 'teamA' },
    // M68 / FIFA M92: فائز R32-07 vs فائز R32-08 → QF-03 teamB
    { label: 'R16-04', winnerTo: 'QF-03', side: 'teamB' },
    // M69 / FIFA M94: فائز R32-09 vs فائز R32-10 → QF-02 teamA
    { label: 'R16-05', winnerTo: 'QF-02', side: 'teamA' },
    // M70 / FIFA M93: فائز R32-11 vs فائز R32-12 → QF-02 teamB
    { label: 'R16-06', winnerTo: 'QF-02', side: 'teamB' },
    // M71 / FIFA M95: فائز R32-15 vs فائز R32-14 → QF-04 teamA
    { label: 'R16-07', winnerTo: 'QF-04', side: 'teamA' },
    // M72 / FIFA M96: فائز R32-13 vs فائز R32-16 → QF-04 teamB
    { label: 'R16-08', winnerTo: 'QF-04', side: 'teamB' },
  ],
  round6: [ // ربع النهائي
    // M73 / FIFA M97: فائز R16-01 vs فائز R16-02 → SF-01 teamA
    { label: 'QF-01', winnerTo: 'SF-01', side: 'teamA' },
    // M74 / FIFA M98: فائز R16-05 vs فائز R16-06 → SF-01 teamB
    { label: 'QF-02', winnerTo: 'SF-01', side: 'teamB' },
    // M75 / FIFA M99: فائز R16-03 vs فائز R16-04 → SF-02 teamA
    { label: 'QF-03', winnerTo: 'SF-02', side: 'teamA' },
    // M76 / FIFA M100: فائز R16-07 vs فائز R16-08 → SF-02 teamB
    { label: 'QF-04', winnerTo: 'SF-02', side: 'teamB' },
  ],
  round7: [ // نصف النهائي
    // M77 / FIFA M101: فائز QF-01 vs فائز QF-02 → FINAL teamA
    { label: 'SF-01', winnerTo: 'FINAL', side: 'teamA' },
    // M78 / FIFA M102: فائز QF-03 vs فائز QF-04 → FINAL teamB
    { label: 'SF-02', winnerTo: 'FINAL', side: 'teamB' },
  ],
  round8: [ // النهائي
    // M79 / FIFA M104: فائز SF-01 vs فائز SF-02
    { label: 'FINAL', winnerTo: null, side: null },
  ],
};

function generateFixtures() {
  // جدول كأس العالم 2026 الرسمي — كل التواريخ والأوقات بتوقيت ET محوّل لـ UTC (+4 ساعات)
  // المصدر: ESPN / FIFA الرسمي
  const fixtures = [];

  // ============================
  // الجولة الأولى (Round 1)
  // ============================

  // يوم 11 يونيو (الخميس)
  fixtures.push({ teamA: 'المكسيك', teamB: 'جنوب أفريقيا', stage: 'المجموعة A', round: 1, start: '2026-06-11T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'كوريا الجنوبية', teamB: 'التشيك', stage: 'المجموعة A', round: 1, start: '2026-06-12T02:00:00Z' }); // 10pm ET

  // يوم 12 يونيو (الجمعة)
  fixtures.push({ teamA: 'كندا', teamB: 'البوسنة والهرسك', stage: 'المجموعة B', round: 1, start: '2026-06-12T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'الولايات المتحدة', teamB: 'باراغواي', stage: 'المجموعة D', round: 1, start: '2026-06-13T01:00:00Z' }); // 9pm ET

  // يوم 13 يونيو (السبت)
  fixtures.push({ teamA: 'قطر', teamB: 'سويسرا', stage: 'المجموعة B', round: 1, start: '2026-06-13T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'البرازيل', teamB: 'المغرب', stage: 'المجموعة C', round: 1, start: '2026-06-13T22:00:00Z' }); // 6pm ET
  fixtures.push({ teamA: 'هايتي', teamB: 'إسكتلندا', stage: 'المجموعة C', round: 1, start: '2026-06-14T01:00:00Z' }); // 9pm ET
  fixtures.push({ teamA: 'أستراليا', teamB: 'تركيا', stage: 'المجموعة D', round: 1, start: '2026-06-14T04:00:00Z' }); // 12am ET (June 14)

  // يوم 14 يونيو (الأحد)
  fixtures.push({ teamA: 'ألمانيا', teamB: 'كوراساو', stage: 'المجموعة E', round: 1, start: '2026-06-14T17:00:00Z' }); // 1pm ET
  fixtures.push({ teamA: 'هولندا', teamB: 'اليابان', stage: 'المجموعة F', round: 1, start: '2026-06-14T20:00:00Z' }); // 4pm ET
  fixtures.push({ teamA: 'ساحل العاج', teamB: 'الإكوادور', stage: 'المجموعة E', round: 1, start: '2026-06-14T23:00:00Z' }); // 7pm ET
  fixtures.push({ teamA: 'السويد', teamB: 'تونس', stage: 'المجموعة F', round: 1, start: '2026-06-15T02:00:00Z' }); // 10pm ET

  // يوم 15 يونيو (الإثنين)
  fixtures.push({ teamA: 'إسبانيا', teamB: 'الرأس الأخضر', stage: 'المجموعة H', round: 1, start: '2026-06-15T16:00:00Z' }); // 12pm ET
  fixtures.push({ teamA: 'بلجيكا', teamB: 'مصر', stage: 'المجموعة G', round: 1, start: '2026-06-15T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'السعودية', teamB: 'الأوروغواي', stage: 'المجموعة H', round: 1, start: '2026-06-15T22:00:00Z' }); // 6pm ET
  fixtures.push({ teamA: 'إيران', teamB: 'نيوزيلندا', stage: 'المجموعة G', round: 1, start: '2026-06-16T01:00:00Z' }); // 9pm ET (June 15)

  // يوم 16 يونيو (الثلاثاء)
  fixtures.push({ teamA: 'فرنسا', teamB: 'السنغال', stage: 'المجموعة I', round: 1, start: '2026-06-16T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'العراق', teamB: 'النرويج', stage: 'المجموعة I', round: 1, start: '2026-06-16T22:00:00Z' }); // 6pm ET
  fixtures.push({ teamA: 'الأرجنتين', teamB: 'الجزائر', stage: 'المجموعة J', round: 1, start: '2026-06-17T01:00:00Z' }); // 9pm ET
  fixtures.push({ teamA: 'النمسا', teamB: 'الأردن', stage: 'المجموعة J', round: 1, start: '2026-06-17T04:00:00Z' }); // 12am ET (June 17)

  // يوم 17 يونيو (الأربعاء)
  fixtures.push({ teamA: 'البرتغال', teamB: 'الكونغو الديمقراطية', stage: 'المجموعة K', round: 1, start: '2026-06-17T17:00:00Z' }); // 1pm ET
  fixtures.push({ teamA: 'إنجلترا', teamB: 'كرواتيا', stage: 'المجموعة L', round: 1, start: '2026-06-17T20:00:00Z' }); // 4pm ET
  fixtures.push({ teamA: 'غانا', teamB: 'بنما', stage: 'المجموعة L', round: 1, start: '2026-06-17T23:00:00Z' }); // 7pm ET
  fixtures.push({ teamA: 'أوزبكستان', teamB: 'كولومبيا', stage: 'المجموعة K', round: 1, start: '2026-06-18T02:00:00Z' }); // 10pm ET

  // ============================
  // الجولة الثانية (Round 2)
  // ============================

  // يوم 18 يونيو (الخميس)
  fixtures.push({ teamA: 'التشيك', teamB: 'جنوب أفريقيا', stage: 'المجموعة A', round: 2, start: '2026-06-18T16:00:00Z' }); // 12pm ET
  fixtures.push({ teamA: 'سويسرا', teamB: 'البوسنة والهرسك', stage: 'المجموعة B', round: 2, start: '2026-06-18T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'كندا', teamB: 'قطر', stage: 'المجموعة B', round: 2, start: '2026-06-18T22:00:00Z' }); // 6pm ET
  fixtures.push({ teamA: 'المكسيك', teamB: 'كوريا الجنوبية', stage: 'المجموعة A', round: 2, start: '2026-06-19T01:00:00Z' }); // 9pm ET

  // يوم 19 يونيو (الجمعة)
  fixtures.push({ teamA: 'الولايات المتحدة', teamB: 'أستراليا', stage: 'المجموعة D', round: 2, start: '2026-06-19T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'إسكتلندا', teamB: 'المغرب', stage: 'المجموعة C', round: 2, start: '2026-06-19T22:00:00Z' }); // 6pm ET
  fixtures.push({ teamA: 'البرازيل', teamB: 'هايتي', stage: 'المجموعة C', round: 2, start: '2026-06-20T00:30:00Z' }); // 8:30pm ET
  fixtures.push({ teamA: 'تركيا', teamB: 'باراغواي', stage: 'المجموعة D', round: 2, start: '2026-06-20T03:00:00Z' }); // 11pm ET (June 19)

  // يوم 20 يونيو (السبت)
  fixtures.push({ teamA: 'هولندا', teamB: 'السويد', stage: 'المجموعة F', round: 2, start: '2026-06-20T17:00:00Z' }); // 1pm ET
  fixtures.push({ teamA: 'ألمانيا', teamB: 'ساحل العاج', stage: 'المجموعة E', round: 2, start: '2026-06-20T20:00:00Z' }); // 4pm ET
  fixtures.push({ teamA: 'الإكوادور', teamB: 'كوراساو', stage: 'المجموعة E', round: 2, start: '2026-06-21T00:00:00Z' }); // 8pm ET
  fixtures.push({ teamA: 'تونس', teamB: 'اليابان', stage: 'المجموعة F', round: 2, start: '2026-06-21T04:00:00Z' }); // 12am ET (June 21)

  // يوم 21 يونيو (الأحد)
  fixtures.push({ teamA: 'إسبانيا', teamB: 'السعودية', stage: 'المجموعة H', round: 2, start: '2026-06-21T16:00:00Z' }); // 12pm ET
  fixtures.push({ teamA: 'بلجيكا', teamB: 'إيران', stage: 'المجموعة G', round: 2, start: '2026-06-21T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'الأوروغواي', teamB: 'الرأس الأخضر', stage: 'المجموعة H', round: 2, start: '2026-06-21T22:00:00Z' }); // 6pm ET
  fixtures.push({ teamA: 'نيوزيلندا', teamB: 'مصر', stage: 'المجموعة G', round: 2, start: '2026-06-22T01:00:00Z' }); // 9pm ET

  // يوم 22 يونيو (الإثنين)
  fixtures.push({ teamA: 'الأرجنتين', teamB: 'النمسا', stage: 'المجموعة J', round: 2, start: '2026-06-22T17:00:00Z' }); // 1pm ET
  fixtures.push({ teamA: 'فرنسا', teamB: 'العراق', stage: 'المجموعة I', round: 2, start: '2026-06-22T21:00:00Z' }); // 5pm ET
  fixtures.push({ teamA: 'النرويج', teamB: 'السنغال', stage: 'المجموعة I', round: 2, start: '2026-06-23T00:00:00Z' }); // 8pm ET
  fixtures.push({ teamA: 'الأردن', teamB: 'الجزائر', stage: 'المجموعة J', round: 2, start: '2026-06-23T03:00:00Z' }); // 11pm ET

  // يوم 23 يونيو (الثلاثاء)
  fixtures.push({ teamA: 'البرتغال', teamB: 'أوزبكستان', stage: 'المجموعة K', round: 2, start: '2026-06-23T17:00:00Z' }); // 1pm ET
  fixtures.push({ teamA: 'إنجلترا', teamB: 'غانا', stage: 'المجموعة L', round: 2, start: '2026-06-23T20:00:00Z' }); // 4pm ET
  fixtures.push({ teamA: 'بنما', teamB: 'كرواتيا', stage: 'المجموعة L', round: 2, start: '2026-06-23T23:00:00Z' }); // 7pm ET
  fixtures.push({ teamA: 'كولومبيا', teamB: 'الكونغو الديمقراطية', stage: 'المجموعة K', round: 2, start: '2026-06-24T02:00:00Z' }); // 10pm ET

  // ============================
  // الجولة الثالثة (Round 3)
  // ============================

  // يوم 24 يونيو (الأربعاء)
  fixtures.push({ teamA: 'سويسرا', teamB: 'كندا', stage: 'المجموعة B', round: 3, start: '2026-06-24T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'البوسنة والهرسك', teamB: 'قطر', stage: 'المجموعة B', round: 3, start: '2026-06-24T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'إسكتلندا', teamB: 'البرازيل', stage: 'المجموعة C', round: 3, start: '2026-06-24T22:00:00Z' }); // 6pm ET
  fixtures.push({ teamA: 'المغرب', teamB: 'هايتي', stage: 'المجموعة C', round: 3, start: '2026-06-24T22:00:00Z' }); // 6pm ET
  fixtures.push({ teamA: 'التشيك', teamB: 'المكسيك', stage: 'المجموعة A', round: 3, start: '2026-06-25T01:00:00Z' }); // 9pm ET
  fixtures.push({ teamA: 'جنوب أفريقيا', teamB: 'كوريا الجنوبية', stage: 'المجموعة A', round: 3, start: '2026-06-25T01:00:00Z' }); // 9pm ET

  // يوم 25 يونيو (الخميس)
  fixtures.push({ teamA: 'الإكوادور', teamB: 'ألمانيا', stage: 'المجموعة E', round: 3, start: '2026-06-25T20:00:00Z' }); // 4pm ET
  fixtures.push({ teamA: 'كوراساو', teamB: 'ساحل العاج', stage: 'المجموعة E', round: 3, start: '2026-06-25T20:00:00Z' }); // 4pm ET
  fixtures.push({ teamA: 'اليابان', teamB: 'السويد', stage: 'المجموعة F', round: 3, start: '2026-06-25T23:00:00Z' }); // 7pm ET
  fixtures.push({ teamA: 'تونس', teamB: 'هولندا', stage: 'المجموعة F', round: 3, start: '2026-06-25T23:00:00Z' }); // 7pm ET
  fixtures.push({ teamA: 'تركيا', teamB: 'الولايات المتحدة', stage: 'المجموعة D', round: 3, start: '2026-06-26T02:00:00Z' }); // 10pm ET
  fixtures.push({ teamA: 'باراغواي', teamB: 'أستراليا', stage: 'المجموعة D', round: 3, start: '2026-06-26T02:00:00Z' }); // 10pm ET

  // يوم 26 يونيو (الجمعة)
  fixtures.push({ teamA: 'النرويج', teamB: 'فرنسا', stage: 'المجموعة I', round: 3, start: '2026-06-26T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'السنغال', teamB: 'العراق', stage: 'المجموعة I', round: 3, start: '2026-06-26T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'الرأس الأخضر', teamB: 'السعودية', stage: 'المجموعة H', round: 3, start: '2026-06-27T00:00:00Z' }); // 8pm ET
  fixtures.push({ teamA: 'الأوروغواي', teamB: 'إسبانيا', stage: 'المجموعة H', round: 3, start: '2026-06-27T00:00:00Z' }); // 8pm ET
  fixtures.push({ teamA: 'مصر', teamB: 'إيران', stage: 'المجموعة G', round: 3, start: '2026-06-27T03:00:00Z' }); // 11pm ET
  fixtures.push({ teamA: 'نيوزيلندا', teamB: 'بلجيكا', stage: 'المجموعة G', round: 3, start: '2026-06-27T03:00:00Z' }); // 11pm ET

  // يوم 27 يونيو (السبت)
  fixtures.push({ teamA: 'بنما', teamB: 'إنجلترا', stage: 'المجموعة L', round: 3, start: '2026-06-27T21:00:00Z' }); // 5pm ET
  fixtures.push({ teamA: 'كرواتيا', teamB: 'غانا', stage: 'المجموعة L', round: 3, start: '2026-06-27T21:00:00Z' }); // 5pm ET
  fixtures.push({ teamA: 'كولومبيا', teamB: 'البرتغال', stage: 'المجموعة K', round: 3, start: '2026-06-27T23:30:00Z' }); // 7:30pm ET
  fixtures.push({ teamA: 'الكونغو الديمقراطية', teamB: 'أوزبكستان', stage: 'المجموعة K', round: 3, start: '2026-06-27T23:30:00Z' }); // 7:30pm ET
  fixtures.push({ teamA: 'الجزائر', teamB: 'النمسا', stage: 'المجموعة J', round: 3, start: '2026-06-28T02:00:00Z' }); // 10pm ET
  fixtures.push({ teamA: 'الأردن', teamB: 'الأرجنتين', stage: 'المجموعة J', round: 3, start: '2026-06-28T02:00:00Z' }); // 10pm ET

  // ============================
  // دور الـ 32 (Round 4) — 16 مباراة
  // ============================

  // يوم 28 يونيو (الأحد)
  fixtures.push({ teamA: 'ثاني A', teamB: 'ثاني B', stage: 'دور الـ 32', round: 4, start: '2026-06-28T19:00:00Z' }); // 3pm ET

  // يوم 29 يونيو (الإثنين)
  fixtures.push({ teamA: 'أول C', teamB: 'ثاني F', stage: 'دور الـ 32', round: 4, start: '2026-06-29T17:00:00Z' }); // 1pm ET
  fixtures.push({ teamA: 'أول E', teamB: 'ثالث ABCDF', stage: 'دور الـ 32', round: 4, start: '2026-06-29T20:30:00Z' }); // 4:30pm ET
  fixtures.push({ teamA: 'أول F', teamB: 'ثاني C', stage: 'دور الـ 32', round: 4, start: '2026-06-30T01:00:00Z' }); // 9pm ET

  // يوم 30 يونيو (الثلاثاء)
  fixtures.push({ teamA: 'ثاني E', teamB: 'ثاني I', stage: 'دور الـ 32', round: 4, start: '2026-06-30T17:00:00Z' }); // 1pm ET
  fixtures.push({ teamA: 'أول I', teamB: 'ثالث CDFGH', stage: 'دور الـ 32', round: 4, start: '2026-06-30T21:00:00Z' }); // 5pm ET
  fixtures.push({ teamA: 'أول A', teamB: 'ثالث CEFHI', stage: 'دور الـ 32', round: 4, start: '2026-07-01T01:00:00Z' }); // 9pm ET

  // يوم 1 يوليو (الأربعاء)
  fixtures.push({ teamA: 'أول L', teamB: 'ثالث EHIJK', stage: 'دور الـ 32', round: 4, start: '2026-07-01T16:00:00Z' }); // 12pm ET
  fixtures.push({ teamA: 'أول G', teamB: 'ثالث AEHIJ', stage: 'دور الـ 32', round: 4, start: '2026-07-01T20:00:00Z' }); // 4pm ET
  fixtures.push({ teamA: 'أول D', teamB: 'ثالث BEFIJ', stage: 'دور الـ 32', round: 4, start: '2026-07-02T00:00:00Z' }); // 8pm ET

  // يوم 2 يوليو (الخميس)
  fixtures.push({ teamA: 'أول H', teamB: 'ثاني J', stage: 'دور الـ 32', round: 4, start: '2026-07-02T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'ثاني K', teamB: 'ثاني L', stage: 'دور الـ 32', round: 4, start: '2026-07-02T23:00:00Z' }); // 7pm ET
  fixtures.push({ teamA: 'أول B', teamB: 'ثالث EFGIJ', stage: 'دور الـ 32', round: 4, start: '2026-07-03T03:00:00Z' }); // 11pm ET

  // يوم 3 يوليو (الجمعة)
  fixtures.push({ teamA: 'ثاني D', teamB: 'ثاني G', stage: 'دور الـ 32', round: 4, start: '2026-07-03T18:00:00Z' }); // 2pm ET
  fixtures.push({ teamA: 'أول J', teamB: 'ثاني H', stage: 'دور الـ 32', round: 4, start: '2026-07-03T22:00:00Z' }); // 6pm ET
  fixtures.push({ teamA: 'أول K', teamB: 'ثالث DEIJL', stage: 'دور الـ 32', round: 4, start: '2026-07-04T01:30:00Z' }); // 9:30pm ET

  // ============================
  // دور الـ 16 (Round 5) — 8 مباريات
  // ============================

  // يوم 4 يوليو (السبت)
  // R16-01: فائز R32-01 (م49) vs فائز R32-04 (م52)
  fixtures.push({ teamA: 'فائز م49', teamB: 'فائز م52', stage: 'دور الـ 16', round: 5, start: '2026-07-04T17:00:00Z' }); // 1pm ET
  // R16-02: فائز R32-03 (م51) vs فائز R32-06 (م54)
  fixtures.push({ teamA: 'فائز م51', teamB: 'فائز م54', stage: 'دور الـ 16', round: 5, start: '2026-07-04T21:00:00Z' }); // 5pm ET

  // يوم 5 يوليو (الأحد)
  // R16-03: فائز R32-02 (م50) vs فائز R32-05 (م53)
  fixtures.push({ teamA: 'فائز م50', teamB: 'فائز م53', stage: 'دور الـ 16', round: 5, start: '2026-07-05T20:00:00Z' }); // 4pm ET
  // R16-04: فائز R32-07 (م55) vs فائز R32-08 (م56)
  fixtures.push({ teamA: 'فائز م55', teamB: 'فائز م56', stage: 'دور الـ 16', round: 5, start: '2026-07-06T00:00:00Z' }); // 8pm ET

  // يوم 6 يوليو (الإثنين)
  // R16-05: فائز R32-09 (م57) vs فائز R32-10 (م58)
  fixtures.push({ teamA: 'فائز م57', teamB: 'فائز م58', stage: 'دور الـ 16', round: 5, start: '2026-07-06T19:00:00Z' }); // 3pm ET
  // R16-06: فائز R32-11 (م59) vs فائز R32-12 (م60)
  fixtures.push({ teamA: 'فائز م59', teamB: 'فائز م60', stage: 'دور الـ 16', round: 5, start: '2026-07-06T21:00:00Z' }); // 5pm ET

  // يوم 7 يوليو (الثلاثاء)
  // R16-07: فائز R32-15 (م63) vs فائز R32-14 (م62)
  fixtures.push({ teamA: 'فائز م63', teamB: 'فائز م62', stage: 'دور الـ 16', round: 5, start: '2026-07-07T16:00:00Z' }); // 12pm ET
  // R16-08: فائز R32-13 (م61) vs فائز R32-16 (م64)
  fixtures.push({ teamA: 'فائز م61', teamB: 'فائز م64', stage: 'دور الـ 16', round: 5, start: '2026-07-07T20:00:00Z' }); // 4pm ET

  // ============================
  // ربع النهائي (Round 6) — 4 مباريات
  // ============================
  // QF-01: فائز R16-01 vs فائز R16-02
  fixtures.push({ teamA: 'فائز ثمن 1', teamB: 'فائز ثمن 2', stage: 'ربع النهائي', round: 6, start: '2026-07-09T20:00:00Z' }); // 4pm ET
  // QF-02: فائز R16-05 vs فائز R16-06
  fixtures.push({ teamA: 'فائز ثمن 5', teamB: 'فائز ثمن 6', stage: 'ربع النهائي', round: 6, start: '2026-07-10T19:00:00Z' }); // 3pm ET
  // QF-03: فائز R16-03 vs فائز R16-04
  fixtures.push({ teamA: 'فائز ثمن 3', teamB: 'فائز ثمن 4', stage: 'ربع النهائي', round: 6, start: '2026-07-11T21:00:00Z' }); // 5pm ET
  // QF-04: فائز R16-07 vs فائز R16-08
  fixtures.push({ teamA: 'فائز ثمن 7', teamB: 'فائز ثمن 8', stage: 'ربع النهائي', round: 6, start: '2026-07-12T01:00:00Z' }); // 9pm ET

  // ============================
  // نصف النهائي (Round 7) — 2 مباراتين
  // ============================
  fixtures.push({ teamA: 'فائز ربع 1', teamB: 'فائز ربع 2', stage: 'نصف النهائي', round: 7, start: '2026-07-14T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'فائز ربع 3', teamB: 'فائز ربع 4', stage: 'نصف النهائي', round: 7, start: '2026-07-15T19:00:00Z' }); // 3pm ET

  // ============================
  // النهائي (Round 8) — مباراة واحدة
  // ============================
  fixtures.push({ teamA: 'فائز نصف 1', teamB: 'فائز نصف 2', stage: 'النهائي', round: 8, start: '2026-07-19T19:00:00Z' }); // 3pm ET

  return fixtures;
}

async function init() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'player',
        status VARCHAR(20) NOT NULL DEFAULT 'approved',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        teamA VARCHAR(100) NOT NULL,
        teamB VARCHAR(100) NOT NULL,
        stage VARCHAR(50) NOT NULL,
        start_at TIMESTAMP NOT NULL,
        actual_scoreA INTEGER,
        actual_scoreB INTEGER,
        round INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS predictions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        scoreA INTEGER NOT NULL,
        scoreB INTEGER NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, match_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value VARCHAR(5000) NOT NULL
      )
    `);

    // Safe migration: add manual_points column if missing
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_points INTEGER DEFAULT 0");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS challenge_points INTEGER DEFAULT 0");

    // Safe migration: knockout winner pick columns
    await client.query("ALTER TABLE predictions ADD COLUMN IF NOT EXISTS predicted_winner VARCHAR(100)");
    await client.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS actual_winner VARCHAR(100)");

    // Safe migration: points column for predictions (pre-calculated points)
    await client.query("ALTER TABLE predictions ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0");

    // Safe migration: penalty winner for draws in knockout
    await client.query("ALTER TABLE predictions ADD COLUMN IF NOT EXISTS penalty_winner VARCHAR(100)");
    await client.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS penalty_winner VARCHAR(100)");

    // Safe migration: bracket path columns for knockout
    await client.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_label VARCHAR(20)");
    await client.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS winner_to_match_id INTEGER REFERENCES matches(id)");
    await client.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS winner_to_side VARCHAR(10)");

    // Knockout bracket slots table — الثابت الرسمي
    await client.query(`
      CREATE TABLE IF NOT EXISTS knockout_bracket_slots (
        id SERIAL PRIMARY KEY,
        match_label VARCHAR(20) NOT NULL UNIQUE,
        round INTEGER NOT NULL,
        stage VARCHAR(100) NOT NULL DEFAULT '',
        match_order INTEGER NOT NULL DEFAULT 0,
        teamA_slot_type VARCHAR(30) NOT NULL DEFAULT '',
        teamA_slot_value VARCHAR(30) DEFAULT '',
        teamB_slot_type VARCHAR(30) NOT NULL DEFAULT '',
        teamB_slot_value VARCHAR(30) DEFAULT '',
        winner_to_match_label VARCHAR(20),
        winner_to_side VARCHAR(10),
        start_at TIMESTAMP,
        venue VARCHAR(200) DEFAULT ''
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS challenge_picks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        qf TEXT[] DEFAULT '{}',
        sf TEXT[] DEFAULT '{}',
        finalists TEXT[] DEFAULT '{}',
        champion TEXT DEFAULT NULL,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS challenge_results (
        id SERIAL PRIMARY KEY,
        round VARCHAR(20) NOT NULL,
        team VARCHAR(100) NOT NULL,
        UNIQUE(round, team)
      )
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_challenge_picks_user_id ON challenge_picks(user_id)');

    await client.query('CREATE INDEX IF NOT EXISTS idx_predictions_user_id ON predictions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_predictions_match_id ON predictions(match_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_predictions_points ON predictions(points)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_matches_start_at ON matches(start_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status)');

    const valueTypeCheck = await client.query("SELECT data_type FROM information_schema.columns WHERE table_name='settings' AND column_name='value'");
    if (valueTypeCheck.rows.length > 0 && valueTypeCheck.rows[0].data_type === 'character varying') {
      await client.query("ALTER TABLE settings ALTER COLUMN value TYPE TEXT");
      console.log('Migration: settings.value changed from VARCHAR(5000) to TEXT');
    }

    const statusCheck = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='status'");
    if (statusCheck.rows.length === 0) {
      await client.query("ALTER TABLE users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'approved'");
    }

    const roundCheck = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='matches' AND column_name='round'");
    if (roundCheck.rows.length === 0) {
      await client.query("ALTER TABLE matches ADD COLUMN round INTEGER NOT NULL DEFAULT 1");
    }

    // Migration: restore all match times (revert old -1h, then fix 6 specific errors)
    const tzFixCheck = await client.query("SELECT value FROM settings WHERE key = 'tz_fix_v2'");
    if (tzFixCheck.rows.length === 0) {
      // Step 1: restore all matches by +1h (undoes the wrong -1h migration)
      await client.query("UPDATE matches SET start_at = start_at + INTERVAL '1 hour'");
      // Step 2: fix 6 specific matches with additional wrong times
      const fixes = [
        { a: 'إسبانيا', b: 'الرأس الأخضر', r: 1, t: '2026-06-15T16:00:00Z' },
        { a: 'بلجيكا', b: 'مصر', r: 1, t: '2026-06-15T19:00:00Z' },
        { a: 'إيران', b: 'نيوزيلندا', r: 1, t: '2026-06-16T01:00:00Z' },
        { a: 'المكسيك', b: 'كوريا الجنوبية', r: 2, t: '2026-06-19T01:00:00Z' },
        { a: 'البرازيل', b: 'هايتي', r: 2, t: '2026-06-20T00:30:00Z' },
        { a: 'تركيا', b: 'باراغواي', r: 2, t: '2026-06-20T03:00:00Z' },
      ];
      for (const f of fixes) {
        await client.query('UPDATE matches SET start_at=$1 WHERE teamA=$2 AND teamB=$3 AND round=$4', [f.t, f.a, f.b, f.r]);
      }
      await client.query("INSERT INTO settings (key, value) VALUES ('tz_fix_v2', '1')");
      console.log('Migration: restored all match times + fixed 6 specific errors (tz_fix_v2)');
    }
    // Fix Saudi Arabia vs Uruguay match time (should be 1am Riyadh = 22:00 UTC)
    const saFix = await client.query("SELECT value FROM settings WHERE key = 'sa_uy_fix'");
    if (saFix.rows.length === 0) {
      await client.query("UPDATE matches SET start_at='2026-06-15T22:00:00Z' WHERE teamA='السعودية' AND teamB='الأوروغواي' AND round=1");
      await client.query("INSERT INTO settings (key, value) VALUES ('sa_uy_fix', '1')");
      console.log('Migration: fixed Saudi Arabia vs Uruguay match time to 1am Riyadh (22:00 UTC)');
    }

    // Clean up old migration flag
    await client.query("DELETE FROM settings WHERE key = 'tz_migration_done'");

    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      console.error('WARNING: ADMIN_PASSWORD env var is not set. Admin account creation skipped.');
    } else {
      const adminCheck = await client.query("SELECT id FROM users WHERE username = $1", [adminUsername]);
      if (adminCheck.rows.length === 0) {
        const hash = bcrypt.hashSync(adminPassword, 10);
        await client.query(
          "INSERT INTO users (name, username, password_hash, role, status) VALUES ($1, $2, $3, $4, $5)",
          ['المدير', adminUsername, hash, 'admin', 'approved']
        );
      }
    }

    const settingsCheck = await client.query("SELECT value FROM settings WHERE key = 'current_round'");
    if (settingsCheck.rows.length === 0) {
      await client.query("INSERT INTO settings (key, value) VALUES ('current_round', '1')");
    }

    const matchesCheck = await client.query('SELECT COUNT(*) FROM matches');
    const expectedCount = 103;
    const currentCount = parseInt(matchesCheck.rows[0].count);
    if (currentCount < expectedCount) {
      console.log(`Matches count is ${currentCount}, expected ${expectedCount}. Adding missing matches only (no deletion)...`);
      const existingTeams = await client.query('SELECT teamA, teamB, round, start_at FROM matches');
      const existingKeys = new Set(existingTeams.rows.map(r => `${r.teama}|${r.teamb}|${r.round}`));
      const fixtures = generateFixtures();
      let added = 0;
      for (const fixture of fixtures) {
        const key = `${fixture.teamA}|${fixture.teamB}|${fixture.round}`;
        if (!existingKeys.has(key)) {
          await client.query(
            'INSERT INTO matches (teamA, teamB, stage, start_at, round) VALUES ($1, $2, $3, $4, $5)',
            [fixture.teamA, fixture.teamB, fixture.stage, fixture.start, fixture.round]
          );
          added++;
        }
      }
      console.log(`Added ${added} missing matches (total now: ${currentCount + added})`);
    }

    await client.query('COMMIT');
    console.log('Database initialized successfully');

    // تهيئة مسارات الأدوار الإقصائية (خارج الـ transaction لأن initBracketPaths يستخدم pool.query)
    try {
      const bracketInitCheck = await pool.query("SELECT value FROM settings WHERE key = 'bracket_paths_initialized'");
      if (bracketInitCheck.rows.length === 0) {
        await initBracketPaths();
        await pool.query("INSERT INTO settings (key, value) VALUES ('bracket_paths_initialized', '1')");
        console.log('Migration: bracket paths initialized');
      }
    } catch (err) {
      console.error('Bracket paths init error:', err.message || err);
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function findUserByUsername(username) {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return result.rows[0] || null;
}

async function getUserById(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function updateUserPassword(id, hashedPassword) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, id]);
}

async function createUser(name, username, password) {
  const hash = bcrypt.hashSync(password, 10);
  const result = await pool.query(
    'INSERT INTO users (name, username, password_hash, role, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, username, hash, 'player', 'pending']
  );
  return result.rows[0];
}

async function getPendingUsers() {
  const result = await pool.query("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at ASC");
  return result.rows;
}

async function getAllUsers() {
  const result = await pool.query("SELECT * FROM users ORDER BY role DESC, created_at ASC");
  return result.rows;
}

async function getApprovedUsers() {
  const result = await pool.query("SELECT id, name FROM users WHERE role != 'admin' AND status = 'approved' ORDER BY name ASC");
  return result.rows;
}

async function approveUser(userId) {
  await pool.query("UPDATE users SET status = 'approved' WHERE id = $1", [userId]);
}

async function rejectUser(userId) {
  await pool.query("UPDATE users SET status = 'rejected' WHERE id = $1 AND status = 'pending'", [userId]);
}

async function deleteUser(userId) {
  await pool.query('DELETE FROM predictions WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1 AND role != $2', [userId, 'admin']);
}

let matchesCache = null;
let matchesCacheTime = 0;
const MATCHES_CACHE_TTL = 5000;

async function getMatches() {
  const now = Date.now();
  if (matchesCache && (now - matchesCacheTime) < MATCHES_CACHE_TTL) {
    return matchesCache;
  }
  const result = await pool.query('SELECT * FROM matches ORDER BY start_at ASC');
  matchesCache = result.rows.map(normalizeMatch);
  matchesCacheTime = now;
  return matchesCache;
}

function invalidateMatchesCache() {
  matchesCache = null;
  matchesCacheTime = 0;
}

async function getCurrentRound() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'current_round'");
  return parseInt(result.rows[0]?.value || '1');
}

async function setCurrentRound(round) {
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('current_round', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [String(round)]
  );
}

async function getPublishedRounds() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'published_rounds'");
  if (result.rows.length > 0) {
    try {
      return JSON.parse(result.rows[0].value);
    } catch (e) {
      return [];
    }
  }
  return [];
}

async function publishRound(round) {
  const published = await getPublishedRounds();
  if (!published.includes(round)) {
    published.push(round);
    published.sort();
  }
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('published_rounds', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify(published)]
  );
}

async function unpublishRound(round) {
  const published = await getPublishedRounds();
  const updated = published.filter(r => r !== round);
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('published_rounds', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify(updated)]
  );
}

async function getVisiblePredictions() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'visible_predictions'");
  if (result.rows.length > 0) {
    try {
      return JSON.parse(result.rows[0].value);
    } catch (e) {
      return [];
    }
  }
  return [];
}

async function getHiddenPredictions() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'hidden_predictions'");
  if (result.rows.length > 0) {
    try { return JSON.parse(result.rows[0].value); } catch (e) { return []; }
  }
  return [];
}

async function togglePredictionVisibility(matchId) {
  const hidden = await getHiddenPredictions();
  const visible = await getVisiblePredictions();
  const id = parseInt(matchId, 10);
  let updatedHidden, updatedVisible;
  if (hidden.includes(id)) {
    // Currently hidden → show (remove from hidden, add to visible)
    updatedHidden = hidden.filter(v => v !== id);
    updatedVisible = visible.includes(id) ? visible : [...visible, id];
  } else {
    // Currently visible or neutral → hide (add to hidden, remove from visible)
    updatedHidden = [...hidden, id];
    updatedVisible = visible.filter(v => v !== id);
  }
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('hidden_predictions', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify(updatedHidden)]
  );
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('visible_predictions', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify(updatedVisible)]
  );
  return updatedVisible;
}

async function toggleRoundPredictionsVisibility(round, matchIds, makeVisible) {
  const hidden = await getHiddenPredictions();
  const visible = await getVisiblePredictions();
  const ids = matchIds.map(id => parseInt(id, 10));
  let updatedHidden, updatedVisible;
  if (makeVisible) {
    updatedHidden = hidden.filter(v => !ids.includes(v));
    updatedVisible = [...new Set([...visible, ...ids])];
  } else {
    updatedHidden = [...new Set([...hidden, ...ids])];
    updatedVisible = visible.filter(v => !ids.includes(v));
  }
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('hidden_predictions', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify(updatedHidden)]
  );
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('visible_predictions', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify(updatedVisible)]
  );
  return updatedVisible;
}

async function getAllPredictionsForMatch(matchId) {
  const result = await pool.query(`
    SELECT p.*, u.name AS user_name
    FROM predictions p
    JOIN users u ON p.user_id = u.id
    WHERE p.match_id = $1
    ORDER BY u.name ASC
  `, [matchId]);
  return result.rows.map(normalizePrediction);
}

async function getAllPredictionsForMatches(matchIds) {
  if (matchIds.length === 0) return [];
  const result = await pool.query(`
    SELECT p.*, u.name AS user_name, m.teamA, m.teamB, m.stage, m.start_at, m.round, m.actual_scoreA, m.actual_scoreB, m.penalty_winner AS actual_penalty_winner
    FROM predictions p
    JOIN users u ON p.user_id = u.id
    JOIN matches m ON p.match_id = m.id
    WHERE p.match_id = ANY($1)
    ORDER BY m.start_at ASC, u.name ASC
  `, [matchIds]);
  return result.rows.map(normalizePrediction);
}

async function deletePrediction(matchId, userId) {
  await pool.query('DELETE FROM predictions WHERE match_id = $1 AND user_id = $2', [matchId, userId]);
}

async function getMatchById(matchId) {
  const result = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
  return normalizeMatch(result.rows[0]) || null;
}

async function savePrediction(userId, matchId, scoreA, scoreB, predictedWinner, penaltyWinner) {
  const result = await pool.query(`
    INSERT INTO predictions (user_id, match_id, scoreA, scoreB, predicted_winner, penalty_winner, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, match_id)
    DO UPDATE SET scoreA = $3, scoreB = $4, predicted_winner = COALESCE($5, predictions.predicted_winner), penalty_winner = $6, updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [userId, matchId, scoreA, scoreB, predictedWinner || null, penaltyWinner || null]);
  return result.rows[0];
}

async function getPrediction(userId, matchId) {
  const result = await pool.query(
    'SELECT * FROM predictions WHERE user_id = $1 AND match_id = $2',
    [userId, matchId]
  );
  return normalizePrediction(result.rows[0]) || null;
}

async function getUserPredictions(userId) {
  const result = await pool.query(`
    SELECT p.*, m.teamA, m.teamB, m.stage, m.start_at, m.round, m.actual_scoreA, m.actual_scoreB, m.penalty_winner AS actual_penalty_winner
    FROM predictions p
    JOIN matches m ON p.match_id = m.id
    WHERE p.user_id = $1
    ORDER BY m.start_at ASC
  `, [userId]);
  return result.rows.map(normalizePrediction);
}

async function getLastPrediction(userId) {
  const result = await pool.query(`
    SELECT p.*, m.teamA, m.teamB, m.stage, m.start_at, m.round, m.actual_scoreA, m.actual_scoreB
    FROM predictions p
    JOIN matches m ON p.match_id = m.id
    WHERE p.user_id = $1
    ORDER BY p.updated_at DESC
    LIMIT 1
  `, [userId]);
  return result.rows[0] || null;
}

async function updateKnockoutTeams(matchId, teamA, teamB) {
  await pool.query(
    'UPDATE matches SET teamA = $1, teamB = $2 WHERE id = $3',
    [teamA, teamB, matchId]
  );
  invalidateMatchesCache();
}

async function updateMatchResult(matchId, scoreA, scoreB, actualWinner, penaltyWinner) {
  if (scoreA === null && scoreB === null) {
    await pool.query(
      'UPDATE matches SET actual_scoreA = NULL, actual_scoreB = NULL, actual_winner = NULL, penalty_winner = NULL WHERE id = $1',
      [matchId]
    );
    invalidateMatchesCache();
  } else {
    await pool.query(
      'UPDATE matches SET actual_scoreA = $1, actual_scoreB = $2, actual_winner = COALESCE($3, actual_winner), penalty_winner = $4 WHERE id = $5',
      [scoreA, scoreB, actualWinner || null, penaltyWinner || null, matchId]
    );
    invalidateMatchesCache();
  }
}

async function getLeaderboard() {
  const result = await pool.query(`
    SELECT u.id, u.name, u.username,
      COALESCE(SUM(p.points), 0) + COALESCE(u.manual_points, 0) + COALESCE(u.challenge_points, 0) AS total,
      u.manual_points,
      u.challenge_points,
      COUNT(p.id) AS predictions_count,
      COALESCE(SUM(
        CASE
          WHEN p.points >= 20 THEN 1
          ELSE 0
        END
      ), 0)::int AS correct_predictions,
      COUNT(CASE WHEN m.actual_scoreA IS NOT NULL THEN 1 END) AS judged_predictions
    FROM users u
    LEFT JOIN predictions p ON u.id = p.user_id
    LEFT JOIN matches m ON p.match_id = m.id
    WHERE u.role != 'admin' AND u.status = 'approved'
    GROUP BY u.id, u.name, u.username, u.manual_points, u.challenge_points
    ORDER BY total DESC, u.name ASC
  `);
  return result.rows.map(row => ({
    ...row,
    total: parseInt(row.total) || 0,
    predictions_count: parseInt(row.predictions_count) || 0,
    correct_predictions: parseInt(row.correct_predictions) || 0,
    judged_predictions: parseInt(row.judged_predictions) || 0,
    success_rate: parseInt(row.judged_predictions) > 0
      ? Math.round((parseInt(row.correct_predictions) / parseInt(row.judged_predictions)) * 100 * 10) / 10
      : 0
  }));
}

async function updateManualPoints(userId, points) {
  await pool.query('UPDATE users SET manual_points = $1 WHERE id = $2', [points, userId]);
}

async function addManualPoints(userId, points) {
  await pool.query('UPDATE users SET manual_points = manual_points + $1 WHERE id = $2', [points, userId]);
}

async function getChallengeConfig() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'challenge_deadline'");
  const openResult = await pool.query("SELECT value FROM settings WHERE key = 'challenge_open'");
  return {
    deadline: result.rows.length > 0 ? result.rows[0].value : null,
    open: openResult.rows.length > 0 ? openResult.rows[0].value === 'true' : false
  };
}

async function setChallengeDeadline(deadline) {
  await pool.query("INSERT INTO settings (key, value) VALUES ('challenge_deadline', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [deadline]);
}

async function setChallengeOpen(open) {
  await pool.query("INSERT INTO settings (key, value) VALUES ('challenge_open', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [open ? 'true' : 'false']);
}

async function saveChallengePicks(userId, picks) {
  const { qf, sf, finalists, champion } = picks;
  await pool.query(`
    INSERT INTO challenge_picks (user_id, qf, sf, finalists, champion, updated_at)
    VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id)
    DO UPDATE SET qf = $2, sf = $3, finalists = $4, champion = $5, updated_at = CURRENT_TIMESTAMP
  `, [userId, qf, sf, finalists, champion]);
}

async function getChallengePicks(userId) {
  const result = await pool.query('SELECT * FROM challenge_picks WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

async function getAllChallengePicks() {
  const result = await pool.query(`
    SELECT cp.*, u.name AS user_name
    FROM challenge_picks cp
    JOIN users u ON cp.user_id = u.id
    ORDER BY u.name ASC
  `);
  return result.rows;
}

async function getChallengeStats() {
  const result = await pool.query('SELECT * FROM challenge_picks');
  const stats = { qf: {}, sf: {}, finalists: {}, champion: {} };
  for (const row of result.rows) {
    for (const round of ['qf', 'sf', 'finalists']) {
      if (row[round] && Array.isArray(row[round])) {
        for (const team of row[round]) {
          stats[round][team] = (stats[round][team] || 0) + 1;
        }
      }
    }
    if (row.champion) {
      stats.champion[row.champion] = (stats.champion[row.champion] || 0) + 1;
    }
  }
  const sortEntries = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return {
    qf: sortEntries(stats.qf),
    sf: sortEntries(stats.sf),
    finalists: sortEntries(stats.finalists),
    champion: sortEntries(stats.champion)
  };
}

async function setChallengeResults(round, teams) {
  await pool.query('DELETE FROM challenge_results WHERE round = $1', [round]);
  for (const team of teams) {
    await pool.query('INSERT INTO challenge_results (round, team) VALUES ($1, $2)', [round, team]);
  }
}

async function getChallengeResults() {
  const result = await pool.query('SELECT * FROM challenge_results ORDER BY round, team');
  return result.rows;
}

async function calculateChallengePoints() {
  const results = await pool.query('SELECT * FROM challenge_results');
  const resultsByRound = {};
  for (const row of results.rows) {
    if (!resultsByRound[row.round]) resultsByRound[row.round] = [];
    resultsByRound[row.round].push(row.team);
  }

  const picks = await pool.query('SELECT * FROM challenge_picks');
  const pointsMap = {};
  for (const pick of picks.rows) {
    let points = 0;
    if (resultsByRound['qf'] && pick.qf) {
      points += pick.qf.filter(t => resultsByRound['qf'].includes(t)).length * 5;
    }
    if (resultsByRound['sf'] && pick.sf) {
      points += pick.sf.filter(t => resultsByRound['sf'].includes(t)).length * 10;
    }
    if (resultsByRound['finalists'] && pick.finalists) {
      points += pick.finalists.filter(t => resultsByRound['finalists'].includes(t)).length * 15;
    }
    if (resultsByRound['champion'] && pick.champion) {
      if (resultsByRound['champion'].includes(pick.champion)) points += 20;
    }
    pointsMap[pick.user_id] = points;
    await pool.query('UPDATE users SET challenge_points = $1 WHERE id = $2', [points, pick.user_id]);
  }
  return pointsMap;
}

async function getGroupStandings() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'group_standings'");
  if (result.rows.length > 0) {
    try {
      return JSON.parse(result.rows[0].value);
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function calculateGroupStandings() {
  const matchesResult = await pool.query(
    "SELECT * FROM matches WHERE actual_scoreA IS NOT NULL AND actual_scoreB IS NOT NULL ORDER BY start_at ASC"
  );
  const matches = matchesResult.rows.map(normalizeMatch);

  const teamFlags = getTeamFlags();
  const groups = {};

  for (const [groupName, teamNames] of Object.entries(GROUPS)) {
    groups[groupName] = {};
    for (const name of teamNames) {
      groups[groupName][name] = {
        name,
        flag: teamFlags[name] || 'unknown',
        played: 0, wins: 0, draws: 0, losses: 0,
        scored: 0, conceded: 0, goalDifference: 0, points: 0
      };
    }
  }

  for (const match of matches) {
    const stage = match.stage;
    if (!groups[stage]) continue;
    const { teamA, teamB, actual_scoreA, actual_scoreB } = match;

    if (!groups[stage][teamA] || !groups[stage][teamB]) continue;

    const tA = groups[stage][teamA];
    const tB = groups[stage][teamB];

    tA.played++;
    tB.played++;
    tA.scored += actual_scoreA;
    tA.conceded += actual_scoreB;
    tB.scored += actual_scoreB;
    tB.conceded += actual_scoreA;

    if (actual_scoreA > actual_scoreB) {
      tA.wins++;
      tA.points += 3;
      tB.losses++;
    } else if (actual_scoreA < actual_scoreB) {
      tB.wins++;
      tB.points += 3;
      tA.losses++;
    } else {
      tA.draws++;
      tB.draws++;
      tA.points += 1;
      tB.points += 1;
    }
  }

  for (const groupName of Object.keys(GROUPS)) {
    const teamsInGroup = groups[groupName] || {};
    for (const teamName of Object.keys(teamsInGroup)) {
      const t = teamsInGroup[teamName];
      t.goalDifference = t.scored - t.conceded;
    }
  }

  const result = [];
  for (const groupName of Object.keys(GROUPS)) {
    const teamsInGroup = groups[groupName] || {};
    const teams = Object.values(teamsInGroup)
      .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.scored - a.scored);
    result.push({ name: groupName, teams });
  }

  const jsonValue = JSON.stringify(result);
  console.log('Saving group_standings to settings table:');
  console.log('  key column:', 'group_standings');
  console.log('  value column length (chars):', jsonValue.length);
  try {
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('group_standings', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [jsonValue]
    );
  } catch (e) {
    console.error('Error saving group standings:', e);
  }

  return result;
}

async function getLeaderboardStats() {
  const playersResult = await pool.query("SELECT COUNT(*) FROM users WHERE role != 'admin' AND status = 'approved'");
  const predictionsResult = await pool.query("SELECT COUNT(*) FROM predictions");
  const matchesResult = await pool.query("SELECT COUNT(*) FROM matches");
  const totalPlayers = parseInt(playersResult.rows[0].count) || 0;
  const totalPredictions = parseInt(predictionsResult.rows[0].count) || 0;
  const totalMatches = parseInt(matchesResult.rows[0].count) || 0;

  const topScoreResult = await pool.query(`
    SELECT u.name, COALESCE(SUM(p.points), 0) + COALESCE(u.manual_points, 0) + COALESCE(u.challenge_points, 0) AS total
    FROM users u
    LEFT JOIN predictions p ON u.id = p.user_id
    LEFT JOIN matches m ON p.match_id = m.id
    WHERE u.role != 'admin' AND u.status = 'approved'
    GROUP BY u.id, u.name, u.manual_points, u.challenge_points
    ORDER BY total DESC LIMIT 1
  `);

  const topCorrectResult = await pool.query(`
    SELECT u.name, COUNT(CASE WHEN p.scoreA = m.actual_scoreA AND p.scoreB = m.actual_scoreB THEN 1 END)::int AS correct
    FROM users u
    LEFT JOIN predictions p ON u.id = p.user_id
    LEFT JOIN matches m ON p.match_id = m.id
    WHERE u.role != 'admin' AND u.status = 'approved' AND m.actual_scoreA IS NOT NULL
    GROUP BY u.id, u.name
    ORDER BY correct DESC LIMIT 1
  `);

  const topRateResult = await pool.query(`
    SELECT u.name,
      COUNT(CASE WHEN m.actual_scoreA IS NOT NULL THEN 1 END) AS judged,
      COUNT(CASE WHEN p.scoreA = m.actual_scoreA AND p.scoreB = m.actual_scoreB THEN 1 END) AS correct
    FROM users u
    LEFT JOIN predictions p ON u.id = p.user_id
    LEFT JOIN matches m ON p.match_id = m.id
    WHERE u.role != 'admin' AND u.status = 'approved'
    GROUP BY u.id, u.name
    HAVING COUNT(CASE WHEN m.actual_scoreA IS NOT NULL THEN 1 END) > 0
    ORDER BY (CASE WHEN COUNT(CASE WHEN m.actual_scoreA IS NOT NULL THEN 1 END) > 0
      THEN COUNT(CASE WHEN p.scoreA = m.actual_scoreA AND p.scoreB = m.actual_scoreB THEN 1 END)::float / COUNT(CASE WHEN m.actual_scoreA IS NOT NULL THEN 1 END)
      ELSE 0 END) DESC LIMIT 1
  `);

  const topScoreRow = topScoreResult.rows[0];
  const topCorrectRow = topCorrectResult.rows[0];
  const topRateRow = topRateResult.rows[0];

  return {
    totalPlayers,
    totalPredictions,
    totalMatches,
    topScore: topScoreRow ? { name: topScoreRow.name, value: parseInt(topScoreRow.total) || 0 } : null,
    topCorrect: topCorrectRow ? { name: topCorrectRow.name, value: parseInt(topCorrectRow.correct) || 0 } : null,
    topRate: topRateRow ? {
      name: topRateRow.name,
      value: parseInt(topRateRow.judged) > 0 ? Math.round((parseInt(topRateRow.correct) / parseInt(topRateRow.judged)) * 100 * 10) / 10 : 0
    } : null
  };
}

function normalizeMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    teamA: row.teama || row.teamA,
    teamB: row.teamb || row.teamB,
    stage: row.stage,
    start_at: row.start_at,
    actual_scoreA: row.actual_scorea != null ? row.actual_scorea : row.actual_scoreA,
    actual_scoreB: row.actual_scoreb != null ? row.actual_scoreb : row.actual_scoreB,
    round: row.round,
    created_at: row.created_at,
    actual_winner: row.actual_winner || row.actualwinner || null,
    penalty_winner: row.penalty_winner || row.penaltywinner || null,
    match_label: row.match_label || null,
    winner_to_match_id: row.winner_to_match_id || null,
    winner_to_side: row.winner_to_side || null
  };
}

function normalizePrediction(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    match_id: row.match_id,
    scoreA: row.scorea != null ? row.scorea : row.scoreA,
    scoreB: row.scoreb != null ? row.scoreb : row.scoreB,
    updated_at: row.updated_at,
    teamA: row.teama || row.teamA || null,
    teamB: row.teamb || row.teamB || null,
    stage: row.stage || null,
    round: row.round || null,
    start_at: row.start_at || null,
    actual_scoreA: row.actual_scorea != null ? row.actual_scorea : (row.actual_scoreA != null ? row.actual_scoreA : null),
    actual_scoreB: row.actual_scoreb != null ? row.actual_scoreb : (row.actual_scoreB != null ? row.actual_scoreB : null),
    user_name: row.user_name || row.username || null,
    predicted_winner: row.predicted_winner || row.predictedwinner || null,
    penalty_winner: row.penalty_winner || row.penaltywinner || null,
    actual_penalty_winner: row.actual_penalty_winner || null,
    points: row.points != null ? parseInt(row.points) : 0
  };
}

function getTeamFlags() {
  return {
    'المكسيك': 'mx', 'جنوب أفريقيا': 'za', 'كوريا الجنوبية': 'kr', 'التشيك': 'cz',
    'كندا': 'ca', 'البوسنة والهرسك': 'ba', 'قطر': 'qa', 'سويسرا': 'ch',
    'البرازيل': 'br', 'المغرب': 'ma', 'هايتي': 'ht', 'إسكتلندا': 'gb-sct',
    'الولايات المتحدة': 'us', 'باراغواي': 'py', 'أستراليا': 'au', 'تركيا': 'tr',
    'هولندا': 'nl', 'اليابان': 'jp', 'السويد': 'se', 'تونس': 'tn',
    'بلجيكا': 'be', 'مصر': 'eg', 'إيران': 'ir', 'نيوزيلندا': 'nz',
    'إسبانيا': 'es', 'الرأس الأخضر': 'cv', 'السعودية': 'sa', 'الأوروغواي': 'uy',
    'فرنسا': 'fr', 'السنغال': 'sn', 'العراق': 'iq', 'النرويج': 'no',
    'الأرجنتين': 'ar', 'الجزائر': 'dz', 'النمسا': 'at', 'الأردن': 'jo',
    'البرتغال': 'pt', 'الكونغو الديمقراطية': 'cd', 'أوزبكستان': 'uz', 'كولومبيا': 'co',
    'إنجلترا': 'gb-eng', 'كرواتيا': 'hr', 'غانا': 'gh', 'بنما': 'pa',
    'ألمانيا': 'de', 'كوراساو': 'cw', 'ساحل العاج': 'ci', 'الإكوادور': 'ec'
  };
}

function calculatePoints(predA, predB, actA, actB, round, predPenaltyWinner, actualPenaltyWinner) {
  if (actA == null || actB == null) return 0;
  if (predA == null || predB == null) return 0;

  var isKnockout = round >= 4;
  var points = 0;

  if (isKnockout) {
    // === نظام الأدوار الإقصائية الجديد ===
    if (predA === actA && predB === actB) {
      points = 25;
    } else {
      var actualDiff = actA - actB;
      var predictedDiff = predA - predB;
      var actualOutcome = Math.sign(actualDiff);
      var predictedOutcome = Math.sign(predictedDiff);

      if (actualOutcome === predictedOutcome) {
        if (actualDiff === predictedDiff) {
          points = 15;
        } else {
          points = 10;
        }
      }
    }

    // مكافأة ركلات الترجيح (فقط إذا توقع المتسابق تعادل والنتيجة تعادل)
    if (predA === predB && actA === actB) {
      if (predPenaltyWinner && actualPenaltyWinner && predPenaltyWinner === actualPenaltyWinner) {
        points += 5;
      }
    }
  } else {
    // === نظام دور المجموعات (بدون تغيير) ===
    if (predA === actA && predB === actB) {
      points = 20;
    } else {
      var actualDiff = actA - actB;
      var predictedDiff = predA - predB;
      var actualOutcome = Math.sign(actualDiff);
      var predictedOutcome = Math.sign(predictedDiff);

      if (actualOutcome === predictedOutcome) {
        if (actualDiff === predictedDiff) {
          points = 15;
        } else {
          points = 10;
        }
      }
    }
  }

  return points;
}

async function recalculateAllPredictionPoints() {
  try {
    const result = await pool.query(`
      UPDATE predictions p
      SET points = CASE
        WHEN m.round < 4 THEN
          CASE
            WHEN p.scoreA = m.actual_scoreA AND p.scoreB = m.actual_scoreB THEN 20
            WHEN SIGN(p.scoreA - p.scoreB) = SIGN(m.actual_scoreA - m.actual_scoreB) THEN
              CASE WHEN (p.scoreA - p.scoreB) = (m.actual_scoreA - m.actual_scoreB) THEN 15 ELSE 10 END
            ELSE 0
          END
        ELSE
          CASE
            WHEN p.scoreA = m.actual_scoreA AND p.scoreB = m.actual_scoreB THEN 25
            WHEN SIGN(p.scoreA - p.scoreB) = SIGN(m.actual_scoreA - m.actual_scoreB) THEN
              CASE WHEN (p.scoreA - p.scoreB) = (m.actual_scoreA - m.actual_scoreB) THEN 15 ELSE 10 END
            ELSE 0
          END +
          CASE
            WHEN p.scoreA = p.scoreB AND m.actual_scoreA = m.actual_scoreB
                 AND p.penalty_winner IS NOT NULL AND m.penalty_winner IS NOT NULL
                 AND p.penalty_winner = m.penalty_winner THEN 5
            ELSE 0
          END
      END
      FROM matches m
      WHERE p.match_id = m.id
        AND m.actual_scoreA IS NOT NULL
        AND m.actual_scoreB IS NOT NULL
      RETURNING p.id
    `);
    return result.rows.length;
  } catch (err) {
    console.error('recalculateAllPredictionPoints error:', err);
    throw err;
  }
}

function getGroups() {
  return GROUPS;
}

module.exports = {
  pool,
  init,
  MISSED_PREDICTIONS_START_MATCH_ID,
  findUserByUsername,
  getUserById,
  updateUserPassword,
  createUser,
  getPendingUsers,
  getAllUsers,
  approveUser,
  rejectUser,
  deleteUser,
  getMatches,
  invalidateMatchesCache,
  getCurrentRound,
  setCurrentRound,
  getPublishedRounds,
  publishRound,
  unpublishRound,
  getVisiblePredictions,
  getHiddenPredictions,
  togglePredictionVisibility,
  toggleRoundPredictionsVisibility,
  getAllPredictionsForMatch,
  getAllPredictionsForMatches,
  deletePrediction,
  getMatchById,
  savePrediction,
  getPrediction,
  getUserPredictions,
  getLastPrediction,
  updateKnockoutTeams,
  updateMatchResult,
  getLeaderboard,
  getLeaderboardStats,
  updateManualPoints,
  addManualPoints,
  getChallengeConfig,
  setChallengeDeadline,
  setChallengeOpen,
  saveChallengePicks,
  getChallengePicks,
  getAllChallengePicks,
  getChallengeStats,
  setChallengeResults,
  getChallengeResults,
  calculateChallengePoints,
  getGroupStandings,
  calculateGroupStandings,
  calculatePoints,
  getTeamFlags,
  getGroups,
  initNewsTable,
  initNewsCommentsTable,
  initNewsReadsTable,
  markNewsAsRead,
  getUnreadNewsCount,
  getNewsReadStats,
  getAllNewsReadStats,
  getNewsUnreadUsers,
  getNews,
  addNews,
  deleteNews,
  updateNews,
  addComment,
  getCommentsByNewsId,
  getApprovedUsers,
  getAllComments,
  getLastCommentByUser,
  hideComment,
  showComment,
  deleteComment,
  advanceKnockoutTeams,
  autoCalculateChallengeResults,
  recalculateAllPredictionPoints,
  // Bracket system
  initBracketPaths,
  relinkBracketPaths,
  resetKnockoutTeamsFromRound,
  getBestThirds,
  getRound32Seeding,
  saveRound32Seeding,
  getRound32Pairings,
  confirmRound32,
  getKnockoutBracketStatus,
  rebuildKnockoutRounds,
  verifyKnockoutBracket
};

// ===== AUTO CHALLENGE RESULTS (استخراج المنتخبات المتأهلة تلقائياً) =====
async function autoCalculateChallengeResults() {
  try {
    // تأكد من تقدم الفائزين في الأدوار الإقصائية أولاً
    await advanceKnockoutTeams();
    const allMatches = await getMatches();
    const results = [];

    // دور الـ8 (QF) = winners of round 6
    const qfMatches = allMatches.filter(m => m.round === 6);
    const qfWinners = qfMatches.map(getMatchWinner).filter(Boolean);
    for (const team of qfWinners) results.push({ round: 'qf', team });

    // دور الـ4 (SF) = winners of round 7
    const sfMatches = allMatches.filter(m => m.round === 7);
    const sfWinners = sfMatches.map(getMatchWinner).filter(Boolean);
    for (const team of sfWinners) results.push({ round: 'sf', team });

    // طرفا النهائي = teamA + teamB of round 8
    const finalMatches = allMatches.filter(m => m.round === 8);
    if (finalMatches.length > 0) {
      const fm = finalMatches[0];
      results.push({ round: 'finalists', team: fm.teamA });
      results.push({ round: 'finalists', team: fm.teamB });
    }

    // البطل = winner of round 8
    const finalWinner = finalMatches.map(getMatchWinner).filter(Boolean);
    for (const team of finalWinner) results.push({ round: 'champion', team });

    // تحديث challenge_results
    await pool.query('DELETE FROM challenge_results');
    for (const r of results) {
      await pool.query('INSERT INTO challenge_results (round, team) VALUES ($1, $2)', [r.round, r.team]);
    }

    return results;
  } catch (err) {
    console.error('autoCalculateChallengeResults error:', err);
    throw err;
  }
}

// ===== AUTO KNOCKOUT ADVANCEMENT =====
// نظام كأس العالم 2026 الرسمي
// 12 مجموعة × 4 فرق = 48 فريق
// الأول والثاني من كل مجموعة + أفضل 8 ثوالث = 32 فريق
// دور الـ 32 = 16 مباراة → دور الـ 16 = 8 مباريات → ربع = 4 → نصف = 2 → نهائي = 1
async function advanceKnockoutTeams() {
  try {
    const allMatches = await getMatches();

    // تحقق هل تم اعتماد دور الـ32 (النظام الجديد بمسارات الأدوار)
    const r32seeded = allMatches.filter(m => m.round === 4 && m.match_label !== null && m.match_label !== undefined);
    if (r32seeded.length > 0) {
      // استخدام مسارات الأدوار الإقصائية المخزنة
      await advanceWinnersByBracket(allMatches, 4); // دور 32 → دور 16
      await advanceWinnersByBracket(allMatches, 5); // دور 16 → ربع النهائي
      await advanceWinnersByBracket(allMatches, 6); // ربع → نصف النهائي
      await advanceWinnersByBracket(allMatches, 7); // نصف → النهائي
      return;
    }

    // النظام القديم كاحتياطي (للبطولة الحالية قبل تسكين دور الـ32)
    // تحقق هل دور المجموعات اكتمل
    const groupMatches = allMatches.filter(m => m.round >= 1 && m.round <= 3);
    const completedGroupMatches = groupMatches.filter(m => m.actual_scoreA !== null && m.actual_scoreB !== null);

    if (groupMatches.length > 0 && completedGroupMatches.length === groupMatches.length) {
      await advanceToRound32(allMatches);
    }

    // تقدم الفائزين في كل دور إقصائي (القديم)
    await advanceWinnersInRound(allMatches, 4, 5); // دور 32 → دور 16
    await advanceWinnersInRound(allMatches, 5, 6); // دور 16 → ربع النهائي
    await advanceWinnersInRound(allMatches, 6, 7); // ربع → نصف النهائي
    await advanceWinnersInRound(allMatches, 7, 8); // نصف → النهائي

  } catch (err) {
    console.error('advanceKnockoutTeams error:', err);
  }
}

function getGroupStandingsCalc(allMatches) {
  const groupNames = Object.keys(GROUPS);
  const standings = {};

  for (const gName of groupNames) {
    const teams = GROUPS[gName];
    const teamStats = {};
    for (const t of teams) {
      teamStats[t] = { name: t, played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, gd: 0, points: 0 };
    }

    const gMatches = allMatches.filter(m => m.round >= 1 && m.round <= 3 && m.stage === gName && m.actual_scoreA !== null);
    for (const m of gMatches) {
      const a = teamStats[m.teamA];
      const b = teamStats[m.teamB];
      if (!a || !b) continue;
      a.played++; b.played++;
      a.scored += m.actual_scoreA; a.conceded += m.actual_scoreB;
      b.scored += m.actual_scoreB; b.conceded += m.actual_scoreA;
      if (m.actual_scoreA > m.actual_scoreB) { a.wins++; a.points += 3; b.losses++; }
      else if (m.actual_scoreA < m.actual_scoreB) { b.wins++; b.points += 3; a.losses++; }
      else { a.draws++; b.draws++; a.points++; b.points++; }
    }
    for (const t of Object.values(teamStats)) { t.gd = t.scored - t.conceded; }
    standings[gName] = Object.values(teamStats).sort((a, b) =>
      b.points - a.points || b.gd - a.gd || b.scored - a.scored
    );
  }
  return standings;
}

async function advanceToRound32(allMatches) {
  const groupNames = Object.keys(GROUPS);
  const standings = getGroupStandingsCalc(allMatches);

  // ترتيب: index 0=A, 1=B, ... 11=L
  const pos = {}; // pos['المجموعة X'] = { first, second, third }
  for (const gName of groupNames) {
    const s = standings[gName];
    pos[gName] = { first: s[0]?.name, second: s[1]?.name, third: s[2]?.name };
  }

  // أفضل 8 ثوالث
  const allThirds = groupNames.map(g => ({ ...standings[g][2], group: g })).filter(t => t.name);
  const bestThirds = allThirds.sort((a, b) => b.points - a.points || b.gd - a.gd || b.scored - a.scored).slice(0, 8);
  const thirdGroupLetters = bestThirds.map(t => t.group.replace('المجموعة ', '')).sort();
  const thirdGroupKey = thirdGroupLetters.join('');

  // خريطة: أي ثالث يلعب ضد أي أول حسب المجموعات المتأهلة
  // هنبني lookup سريع: اسم الثالث حسب حرف المجموعة
  const thirdByGroup = {};
  for (const t of bestThirds) {
    const letter = t.group.replace('المجموعة ', '');
    thirdByGroup[letter] = t.name;
  }

  // التقابلات الرسمية لدور الـ 32 (16 مباراة) بالترتيب حسب generateFixtures:
  // مباراة 1: ثاني A vs ثاني B
  // مباراة 2: أول C vs ثاني F
  // مباراة 3: أول E vs ثالث (من ABCDF)
  // مباراة 4: أول F vs ثاني C
  // مباراة 5: ثاني E vs ثاني I
  // مباراة 6: أول I vs ثالث (من CDFGH)
  // مباراة 7: أول A vs ثالث (من CEFHI)
  // مباراة 8: أول L vs ثالث (من EHIJK)
  // مباراة 9: أول G vs ثالث (من AEHIJ)
  // مباراة 10: أول D vs ثالث (من BEFIJ)
  // مباراة 11: أول H vs ثاني J
  // مباراة 12: ثاني K vs ثاني L
  // مباراة 13: أول B vs ثالث (من EFGIJ)
  // مباراة 14: ثاني D vs ثاني G
  // مباراة 15: أول J vs ثاني H
  // مباراة 16: أول K vs ثالث (من DEIJL)

  function pickThird(possibleGroups) {
    // نختار أول ثالث متاح من المجموعات المحددة
    for (const letter of possibleGroups) {
      if (thirdByGroup[letter]) return thirdByGroup[letter];
    }
    return null;
  }

  const G = (name) => pos[name]; // اختصار

  const pairings = [
    { teamA: G('المجموعة A')?.second, teamB: G('المجموعة B')?.second },
    { teamA: G('المجموعة C')?.first, teamB: G('المجموعة F')?.second },
    { teamA: G('المجموعة E')?.first, teamB: pickThird(['A','B','C','D','F']) },
    { teamA: G('المجموعة F')?.first, teamB: G('المجموعة C')?.second },
    { teamA: G('المجموعة E')?.second, teamB: G('المجموعة I')?.second },
    { teamA: G('المجموعة I')?.first, teamB: pickThird(['C','D','F','G','H']) },
    { teamA: G('المجموعة A')?.first, teamB: pickThird(['C','E','F','H','I']) },
    { teamA: G('المجموعة L')?.first, teamB: pickThird(['E','H','I','J','K']) },
    { teamA: G('المجموعة G')?.first, teamB: pickThird(['A','E','H','I','J']) },
    { teamA: G('المجموعة D')?.first, teamB: pickThird(['B','E','F','I','J']) },
    { teamA: G('المجموعة H')?.first, teamB: G('المجموعة J')?.second },
    { teamA: G('المجموعة K')?.second, teamB: G('المجموعة L')?.second },
    { teamA: G('المجموعة B')?.first, teamB: pickThird(['E','F','G','I','J']) },
    { teamA: G('المجموعة D')?.second, teamB: G('المجموعة G')?.second },
    { teamA: G('المجموعة J')?.first, teamB: G('المجموعة H')?.second },
    { teamA: G('المجموعة K')?.first, teamB: pickThird(['D','E','I','J','L']) },
  ];

  const round32Matches = allMatches.filter(m => m.round === 4).sort((a, b) => a.id - b.id);
  if (round32Matches.length === 0) return;

  for (let i = 0; i < round32Matches.length && i < pairings.length; i++) {
    const m = round32Matches[i];
    const p = pairings[i];
    if (!p.teamA || !p.teamB) continue;
    // نحدث بس لو الفرق لسه placeholder
    const isPlaceholder = (t) => !t || t.startsWith('ثاني') || t.startsWith('أول') || t.startsWith('ثالث') || t.startsWith('فائز');
    if (isPlaceholder(m.teamA) || isPlaceholder(m.teamB)) {
      await updateKnockoutTeams(m.id, p.teamA, p.teamB);
    }
  }
}

async function advanceWinnersInRound(allMatches, fromRound, toRound) {
  const fromMatches = allMatches.filter(m => m.round === fromRound).sort((a, b) => a.id - b.id);
  const toMatches = allMatches.filter(m => m.round === toRound).sort((a, b) => a.id - b.id);

  if (toMatches.length === 0) return;

  // كل مباراتين متتاليتين في الدور الحالي → الفائزين يروحوا مباراة واحدة في الدور التالي
  for (let i = 0; i < toMatches.length; i++) {
    const matchA = fromMatches[i * 2];
    const matchB = fromMatches[i * 2 + 1];
    const toMatch = toMatches[i];

    if (!matchA || !matchB) continue;

    const winnerA = getMatchWinner(matchA);
    const winnerB = getMatchWinner(matchB);

    if (winnerA && winnerB) {
      const isPlaceholder = (t) => !t || t.startsWith('فائز') || t.startsWith('ثاني') || t.startsWith('أول') || t.startsWith('ثالث');
      if (isPlaceholder(toMatch.teamA) || (toMatch.teamA !== winnerA || toMatch.teamB !== winnerB)) {
        await updateKnockoutTeams(toMatch.id, winnerA, winnerB);
      }
    }
  }
}

// ===== التقدم عبر مسار الأدوار الإقصائية (النظام الجديد) =====
// يستخدم winner_to_match_id و winner_to_side المخزنين في جدول matches
async function advanceWinnersByBracket(allMatches, fromRound) {
  let changed = false;
  const fromMatches = allMatches.filter(m => m.round === fromRound && m.winner_to_match_id);
  for (const match of fromMatches) {
    const winner = getMatchWinner(match);
    if (!winner) continue;
    const toMatch = allMatches.find(m => m.id === match.winner_to_match_id);
    if (!toMatch) continue;
    if (match.winner_to_side === 'teamA') {
      if (toMatch.teamA !== winner) {
        await pool.query('UPDATE matches SET teamA = $1 WHERE id = $2', [winner, toMatch.id]);
        changed = true;
      }
    } else if (match.winner_to_side === 'teamB') {
      if (toMatch.teamB !== winner) {
        await pool.query('UPDATE matches SET teamB = $1 WHERE id = $2', [winner, toMatch.id]);
        changed = true;
      }
    }
  }
  if (changed) invalidateMatchesCache();
}

function getMatchWinner(match) {
  if (match.actual_scoreA === null || match.actual_scoreB === null) return null;
  if (match.actual_scoreA > match.actual_scoreB) return match.teamA;
  if (match.actual_scoreB > match.actual_scoreA) return match.teamB;
  // تعادل — الفائز بركلات الترجيح (يجب اختياره من الأدمن)
  if (match.penalty_winner) return match.penalty_winner;
  return null; // تعادل بدون اختيار فائز ركلات = لم يُحسم بعد
}

async function initNewsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      image_path TEXT,
      breaking BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Migration v2: convert base64 images to files on disk
  const migV2 = await pool.query("SELECT value FROM settings WHERE key = 'news_img_mig_v2'");
  if (migV2.rows.length === 0) {
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'news');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const b64News = await pool.query("SELECT id, image_path FROM news WHERE image_path LIKE 'data:%'");
    let converted = 0;
    for (const row of b64News.rows) {
      try {
        const matches = row.image_path.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!matches) { await pool.query('UPDATE news SET image_path=NULL WHERE id=$1', [row.id]); continue; }
        const extMap = { jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp' };
        const ext = extMap[matches[1]] || 'jpg';
        const filename = 'news_mig_' + row.id + '_' + Date.now() + '.' + ext;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
        await pool.query('UPDATE news SET image_path=$1 WHERE id=$2', ['/uploads/news/' + filename, row.id]);
        converted++;
      } catch (e) {
        console.error('Failed to convert news id=' + row.id + ' image:', e.message);
        await pool.query('UPDATE news SET image_path=NULL WHERE id=$1', [row.id]);
      }
    }
    await pool.query("INSERT INTO settings (key, value) VALUES ('news_img_mig_v2', '1')");
    if (converted > 0) {
      console.log('Migration: saved ' + converted + ' news images to disk');
    }
  }
}

async function initNewsCommentsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_comments (
      id SERIAL PRIMARY KEY,
      news_id INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      visible BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_comments_news_id ON news_comments(news_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_comments_user_id ON news_comments(user_id)');
}

async function initNewsReadsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_reads (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      news_id INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
      read_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, news_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_reads_user_id ON news_reads(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_reads_news_id ON news_reads(news_id)');
}

async function markNewsAsRead(userId, newsId) {
  await pool.query(`
    INSERT INTO news_reads (user_id, news_id, read_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, news_id) DO NOTHING
  `, [userId, newsId]);
}

async function getUnreadNewsCount(userId) {
  const result = await pool.query(`
    SELECT COUNT(*) FROM news n
    WHERE NOT EXISTS (
      SELECT 1 FROM news_reads nr
      WHERE nr.news_id = n.id AND nr.user_id = $1
    )
  `, [userId]);
  return parseInt(result.rows[0].count) || 0;
}

async function getNewsReadStats(newsId) {
  const totalUsers = await pool.query("SELECT COUNT(*) FROM users WHERE role != 'admin' AND status = 'approved'");
  const total = parseInt(totalUsers.rows[0].count) || 0;
  const readers = await pool.query(`
    SELECT u.id, u.name, nr.read_at
    FROM news_reads nr
    JOIN users u ON nr.user_id = u.id
    WHERE nr.news_id = $1
    ORDER BY nr.read_at ASC
  `, [newsId]);
  const readCount = readers.rows.length;
  return {
    total,
    readCount,
    unreadCount: total - readCount,
    readRate: total > 0 ? Math.round((readCount / total) * 100) : 0,
    readers: readers.rows,
    unreadUsers: null
  };
}

async function getAllNewsReadStats() {
  const totalUsers = await pool.query("SELECT COUNT(*) FROM users WHERE role != 'admin' AND status = 'approved'");
  const total = parseInt(totalUsers.rows[0].count) || 0;
  const result = await pool.query(`
    SELECT nr.news_id, COUNT(*) as read_count
    FROM news_reads nr
    JOIN users u ON nr.user_id = u.id
    WHERE u.role != 'admin' AND u.status = 'approved'
    GROUP BY nr.news_id
  `);
  return result.rows.map(row => ({
    news_id: parseInt(row.news_id),
    total,
    readCount: parseInt(row.read_count),
    unreadCount: total - parseInt(row.read_count),
    readRate: total > 0 ? Math.round((parseInt(row.read_count) / total) * 100) : 0
  }));
}

async function getNewsUnreadUsers(newsId) {
  const result = await pool.query(`
    SELECT u.id, u.name FROM users u
    WHERE u.role != 'admin' AND u.status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM news_reads nr
      WHERE nr.news_id = $1 AND nr.user_id = u.id
    )
    ORDER BY u.name ASC
  `, [newsId]);
  return result.rows;
}

async function getNews() {
  const result = await pool.query('SELECT * FROM news ORDER BY created_at DESC');
  return result.rows;
}

async function addNews({ title, body, image_path, breaking }) {
  await pool.query(
    'INSERT INTO news (title, body, image_path, breaking) VALUES ($1,$2,$3,$4)',
    [title, body, image_path || null, breaking || false]
  );
}

async function deleteNews(id) {
  await pool.query('DELETE FROM news_comments WHERE news_id=$1', [id]);
  const result = await pool.query('DELETE FROM news WHERE id=$1 RETURNING image_path', [id]);
  const row = result.rows[0];
  if (row && row.image_path && row.image_path.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '..', 'public', row.image_path.replace(/^\//, ''));
    try { fs.unlinkSync(filePath); } catch (e) { /* file may not exist */ }
  }
  return row;
}

async function updateNews(id, { title, body, image_path, breaking }) {
  if (image_path !== undefined) {
    await pool.query(
      'UPDATE news SET title=$1, body=$2, image_path=$3, breaking=$4 WHERE id=$5',
      [title, body, image_path, breaking || false, id]
    );
  } else {
    await pool.query(
      'UPDATE news SET title=$1, body=$2, breaking=$3 WHERE id=$4',
      [title, body, breaking || false, id]
    );
  }
}

// ===== News Comments =====

async function addComment(newsId, userId, body) {
  const result = await pool.query(
    'INSERT INTO news_comments (news_id, user_id, body) VALUES ($1, $2, $3) RETURNING *',
    [newsId, userId, body]
  );
  return result.rows[0];
}

async function getCommentsByNewsId(newsId) {
  const result = await pool.query(`
    SELECT c.*, u.name AS user_name
    FROM news_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.news_id = $1 AND c.visible = true
    ORDER BY c.created_at DESC
  `, [newsId]);
  return result.rows;
}

async function getAllComments() {
  const result = await pool.query(`
    SELECT c.*, u.name AS user_name
    FROM news_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.visible = true
    ORDER BY c.created_at DESC
  `);
  return result.rows;
}

async function getLastCommentByUser(userId) {
  const result = await pool.query(
    'SELECT * FROM news_comments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  return result.rows[0] || null;
}

async function hideComment(commentId) {
  await pool.query('UPDATE news_comments SET visible = false WHERE id = $1', [commentId]);
}

async function showComment(commentId) {
  await pool.query('UPDATE news_comments SET visible = true WHERE id = $1', [commentId]);
}

async function deleteComment(commentId) {
  await pool.query('DELETE FROM news_comments WHERE id = $1', [commentId]);
}

// ====================================================================
// BRACKET PATHS — مسارات الأدوار الإقصائية
// ====================================================================

// ربط جميع مباريات الأدوار الإقصائية بمساراتها في جدول matches
async function initBracketPaths() {
  // إنشاء سجلات في knockout_bracket_slots إن لم تكن موجودة
  const existingSlots = await pool.query('SELECT COUNT(*) FROM knockout_bracket_slots');
  if (parseInt(existingSlots.rows[0].count) === 0) {
    for (let r = 4; r <= 8; r++) {
      const slots = BRACKET_SLOTS['round' + r];
      const stageMap = { 4: 'دور الـ 32', 5: 'دور الـ 16', 6: 'ربع النهائي', 7: 'نصف النهائي', 8: 'النهائي' };
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const teamA_type = s.teamA ? s.teamA.type : '';
        const teamA_val = s.teamA ? (s.teamA.group || s.teamA.index || '') : '';
        const teamB_type = s.teamB ? s.teamB.type : '';
        const teamB_val = s.teamB ? (s.teamB.group || s.teamB.index || '') : '';
        await pool.query(
          `INSERT INTO knockout_bracket_slots (match_label, round, stage, match_order,
            teamA_slot_type, teamA_slot_value, teamB_slot_type, teamB_slot_value,
            winner_to_match_label, winner_to_side)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (match_label) DO NOTHING`,
          [s.label, r, stageMap[r], i + 1,
           teamA_type, String(teamA_val), teamB_type, String(teamB_val),
           s.winnerTo || null, s.side || null]
        );
      }
    }
  }

  // ربط مباريات Round 4-8 الموجودة بمساراتها
  for (let r = 4; r <= 8; r++) {
    const matches = await pool.query(
      'SELECT * FROM matches WHERE round = $1 ORDER BY id', [r]
    );
    const slots = BRACKET_SLOTS['round' + r];
    for (let i = 0; i < matches.rows.length && i < slots.length; i++) {
      const m = matches.rows[i];
      const s = slots[i];
      // تعيين match_label
      if (!m.match_label) {
        await pool.query('UPDATE matches SET match_label = $1 WHERE id = $2', [s.label, m.id]);
      }
    }
  }

  // المرحلة 2: ربط winner_to_match_id (بعد تعيين جميع match_labels)
  for (let r = 4; r <= 8; r++) {
    const matches = await pool.query(
      'SELECT * FROM matches WHERE round = $1 ORDER BY id', [r]
    );
    const slots = BRACKET_SLOTS['round' + r];
    for (let i = 0; i < matches.rows.length && i < slots.length; i++) {
      const m = matches.rows[i];
      const s = slots[i];
      // تعيين winner_to_match_id و winner_to_side
      if (s.winnerTo) {
        const nextMatch = await pool.query(
          'SELECT id FROM matches WHERE match_label = $1 LIMIT 1', [s.winnerTo]
        );
        if (nextMatch.rows.length > 0) {
          await pool.query(
            'UPDATE matches SET winner_to_match_id = $1, winner_to_side = $2 WHERE id = $3 AND winner_to_match_id IS NULL',
            [nextMatch.rows[0].id, s.side, m.id]
          );
        }
      }
    }
  }
}

// ===== إعادة ربط مسارات الأدوار الإقصائية (migration آمن) =====
// تحدّث winner_to_match_id و winner_to_side في جدول matches
// و تحدّث knockout_bracket_slots
// لا تمس teamA/teamB/actual_score/penalty_winner أو أي بيانات أخرى
async function relinkBracketPaths() {
  // 1. تحديث knockout_bracket_slots (ON CONFLICT DO UPDATE)
  for (let r = 4; r <= 8; r++) {
    const slots = BRACKET_SLOTS['round' + r];
    const stageMap = { 4: 'دور الـ 32', 5: 'دور الـ 16', 6: 'ربع النهائي', 7: 'نصف النهائي', 8: 'النهائي' };
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const teamA_type = s.teamA ? s.teamA.type : '';
      const teamA_val = s.teamA ? (s.teamA.group || s.teamA.index || '') : '';
      const teamB_type = s.teamB ? s.teamB.type : '';
      const teamB_val = s.teamB ? (s.teamB.group || s.teamB.index || '') : '';
      await pool.query(
        `INSERT INTO knockout_bracket_slots (match_label, round, stage, match_order,
          teamA_slot_type, teamA_slot_value, teamB_slot_type, teamB_slot_value,
          winner_to_match_label, winner_to_side)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (match_label) DO UPDATE SET
          winner_to_match_label = EXCLUDED.winner_to_match_label,
          winner_to_side = EXCLUDED.winner_to_side,
          teamA_slot_type = EXCLUDED.teamA_slot_type,
          teamA_slot_value = EXCLUDED.teamA_slot_value,
          teamB_slot_type = EXCLUDED.teamB_slot_type,
          teamB_slot_value = EXCLUDED.teamB_slot_value`,
        [s.label, r, stageMap[r], i + 1,
         teamA_type, String(teamA_val), teamB_type, String(teamB_val),
         s.winnerTo || null, s.side || null]
      );
    }
  }

  // 2. التأكد من تعيين match_label لكل مباراة (لو لم تعيّن من قبل)
  for (let r = 4; r <= 8; r++) {
    const matches = await pool.query(
      'SELECT * FROM matches WHERE round = $1 ORDER BY id', [r]
    );
    const slots = BRACKET_SLOTS['round' + r];
    for (let i = 0; i < matches.rows.length && i < slots.length; i++) {
      const m = matches.rows[i];
      const s = slots[i];
      if (!m.match_label) {
        await pool.query('UPDATE matches SET match_label = $1 WHERE id = $2', [s.label, m.id]);
      }
    }
  }

  // 3. إعادة ربط winner_to_match_id و winner_to_side (تحديث القيم الموجودة)
  for (let r = 4; r <= 8; r++) {
    const matches = await pool.query(
      'SELECT * FROM matches WHERE round = $1 ORDER BY id', [r]
    );
    const slots = BRACKET_SLOTS['round' + r];
    for (let i = 0; i < matches.rows.length && i < slots.length; i++) {
      const m = matches.rows[i];
      const s = slots[i];
      if (s.winnerTo) {
        const nextMatch = await pool.query(
          'SELECT id FROM matches WHERE match_label = $1 LIMIT 1', [s.winnerTo]
        );
        if (nextMatch.rows.length > 0) {
          await pool.query(
            'UPDATE matches SET winner_to_match_id = $1, winner_to_side = $2 WHERE id = $3',
            [nextMatch.rows[0].id, s.side, m.id]
          );
        }
      } else {
        // النهائي — لا يوجد winnerTo
        await pool.query(
          'UPDATE matches SET winner_to_match_id = NULL, winner_to_side = NULL WHERE id = $1',
          [m.id]
        );
      }
    }
  }

  invalidateMatchesCache();
  console.log('Bracket paths relinked successfully (v4)');
}

// إعادة تعيين فرق الأدوار الإقصائية لـ placeholders (آمن — لا يمس النتائج أو التوقعات)
// يحدّث teamA/teamB فقط للمباريات اللي مالهاش نتائج (actual_scoreA IS NULL)
async function resetKnockoutTeamsFromRound(fromRound) {
  const fixtures = generateFixtures();
  const koFixtures = fixtures.filter(f => f.round >= fromRound);
  const existing = await pool.query(
    'SELECT id, round FROM matches WHERE round >= $1 ORDER BY id', [fromRound]
  );
  for (let i = 0; i < koFixtures.length && i < existing.rows.length; i++) {
    const f = koFixtures[i];
    const m = existing.rows[i];
    await pool.query(
      'UPDATE matches SET teamA = $1, teamB = $2 WHERE id = $3 AND actual_scoreA IS NULL AND actual_scoreB IS NULL',
      [f.teamA, f.teamB, m.id]
    );
  }
  invalidateMatchesCache();
  console.log('Knockout teams reset from round', fromRound);
}

// حساب أفضل 8 ثوالث
async function getBestThirds() {
  const allMatches = await getMatches();
  const standings = getGroupStandingsCalc(allMatches);
  const groupNames = Object.keys(GROUPS);
  // الثالث من كل مجموعة
  const allThirds = groupNames.map(g => {
    const s = standings[g];
    const third = s[2] ? { ...s[2], group: g.replace('المجموعة ', '') } : null;
    return third;
  }).filter(t => t && t.name);
  // ترتيب: نقاط > فارق > أهداف
  const bestThirds = allThirds.sort((a, b) => b.points - a.points || b.gd - a.gd || b.scored - a.scored).slice(0, 8);
  return bestThirds;
}

// الحصول على توزيع دور الـ32 الحالي (المحفوظ في settings)
async function getRound32Seeding() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'round32_seeding'");
  if (result.rows.length === 0) return null;
  try { return JSON.parse(result.rows[0].value); } catch (e) { return null; }
}

// حفظ توزيع الثوالث (يسكن الأدمن المنتخبات في الخانات)
async function saveRound32Seeding(seedingData) {
  // seedingData: { 'R32-03': 'فرنسا', 'R32-06': 'البرازيل', ... }
  const bestThirds = await getBestThirds();
  const validTeams = bestThirds.map(t => t.name);
  // تحقق: كل القيم من أفضل 8 ثوالث
  for (const [slot, team] of Object.entries(seedingData)) {
    if (!validTeams.includes(team)) {
      throw new Error('الفريق ' + team + ' ليس من أفضل 8 ثوالث');
    }
  }
  // تحقق: لا تكرار
  const teams = Object.values(seedingData);
  if (new Set(teams).size !== teams.length) {
    throw new Error('لا يمكن اختيار نفس المنتخب أكثر من مرة');
  }
  // تحقق: 8 خانات
  const thirdSlots = BRACKET_SLOTS.round4.filter(s => s.teamB && s.teamB.type === 'best_third');
  if (Object.keys(seedingData).length !== thirdSlots.length) {
    throw new Error('يجب تسكين جميع خانات الثوالث (' + thirdSlots.length + ' خانات)');
  }
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('round32_seeding', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify(seedingData)]
  );
}

// الحصول على جميع مواجهات دور الـ32 مع معلومات التوزيع
async function getRound32Pairings() {
  // الحصول على أفضل 8 ثوالث
  const bestThirds = await getBestThirds();
  // الحصول على ترتيب المجموعات
  const standingResult = await getGroupStandings();
  const pos = {};
  if (standingResult) {
    for (const g of standingResult) {
      pos[g.name] = { first: g.teams[0]?.name, second: g.teams[1]?.name, third: g.teams[2]?.name };
    }
  }
  // الحصول على التوزيع الحالي (إن وجد)
  const seeding = await getRound32Seeding();

  // بناء كل مواجهة
  const pairings = [];
  const thirdSlots = BRACKET_SLOTS.round4.filter(s => s.teamB && s.teamB.type === 'best_third');
  let thirdIndex = 0;

  for (const slot of BRACKET_SLOTS.round4) {
    const p = { label: slot.label, slot, teamA: null, teamB: null, teamA_auto: false, teamB_auto: false, is_third_slot: false };
    // teamA
    if (slot.teamA.type === 'group_first') {
      const gName = 'المجموعة ' + slot.teamA.group;
      p.teamA = pos[gName]?.first || null;
      p.teamA_auto = true;
    } else if (slot.teamA.type === 'group_second') {
      const gName = 'المجموعة ' + slot.teamA.group;
      p.teamA = pos[gName]?.second || null;
      p.teamA_auto = true;
    }
    // teamB
    if (slot.teamB.type === 'group_first') {
      const gName = 'المجموعة ' + slot.teamB.group;
      p.teamB = pos[gName]?.first || null;
      p.teamB_auto = true;
    } else if (slot.teamB.type === 'group_second') {
      const gName = 'المجموعة ' + slot.teamB.group;
      p.teamB = pos[gName]?.second || null;
      p.teamB_auto = true;
    } else if (slot.teamB.type === 'best_third') {
      const seeded = seeding ? seeding[slot.label] : null;
      p.teamB = seeded || null;
      p.is_third_slot = true;
      p.third_index = thirdIndex;
      p.available_thirds = bestThirds;
      thirdIndex++;
    }
    pairings.push(p);
  }
  return pairings;
}

// اعتماد دور الـ32 (بعد تسكين الثوالث)
async function confirmRound32() {
  const seeding = await getRound32Seeding();
  if (!seeding) throw new Error('لم يتم تسكين الثوالث بعد');

  const standingResult = await getGroupStandings();
  if (!standingResult) throw new Error('لم يتم احتساب ترتيب المجموعات بعد');

  const pos = {};
  for (const g of standingResult) {
    pos[g.name] = { first: g.teams[0]?.name, second: g.teams[1]?.name, third: g.teams[2]?.name };
  }

  // الحصول على مباريات دور الـ32
  const r32matches = await pool.query('SELECT * FROM matches WHERE round = 4 ORDER BY id');
  const matches = r32matches.rows;

  if (matches.length !== 16) throw new Error('عدد مباريات دور الـ32 غير صحيح');
  if (matches.length === 0) throw new Error('لا توجد مباريات دور الـ32');

  // لك مباراة، حل teamA و teamB
  for (let i = 0; i < matches.length; i++) {
    const slot = BRACKET_SLOTS.round4[i];
    if (!slot) continue;
    const match = matches[i];

    let teamA = null, teamB = null;

    // حل teamA
    if (slot.teamA.type === 'group_first') {
      teamA = pos['المجموعة ' + slot.teamA.group]?.first;
    } else if (slot.teamA.type === 'group_second') {
      teamA = pos['المجموعة ' + slot.teamA.group]?.second;
    }

    // حل teamB
    if (slot.teamB.type === 'group_first') {
      teamB = pos['المجموعة ' + slot.teamB.group]?.first;
    } else if (slot.teamB.type === 'group_second') {
      teamB = pos['المجموعة ' + slot.teamB.group]?.second;
    } else if (slot.teamB.type === 'best_third') {
      teamB = seeding[slot.label];
    }

    if (!teamA) throw new Error('لم يتم تحديد الفريق A للمباراة ' + slot.label);
    if (!teamB) throw new Error('لم يتم تحديد الفريق B للمباراة ' + slot.label);

    // تحديث المباراة
    await pool.query(
      'UPDATE matches SET teamA = $1, teamB = $2, match_label = $3 WHERE id = $4',
      [teamA, teamB, slot.label, match.id]
    );
  }

  // تعيين مسارات الأدوار (winner_to_match_id, winner_to_side) لجميع مباريات الأدوار الإقصائية
  await initBracketPaths();

  // حفظ علامة أن دور الـ32 معتمد
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('round32_confirmed', '1') ON CONFLICT (key) DO UPDATE SET value = '1'"
  );

  // إعادة احتساب نقاط التوقعات
  await recalculateAllPredictionPoints();
}

// الحصول على حالة المسار الإقصائي
async function getKnockoutBracketStatus() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'round32_confirmed'");
  const confirmed = result.rows.length > 0 && result.rows[0].value === '1';
  const matches = await pool.query(
    'SELECT id, round, match_label, teamA, teamB, actual_scoreA, actual_scoreB, actual_winner, penalty_winner, winner_to_match_id, winner_to_side, stage FROM matches WHERE round >= 4 ORDER BY round, id'
  );
  const roundNames = { 4: 'دور الـ 32', 5: 'دور الـ 16', 6: 'ربع النهائي', 7: 'نصف النهائي', 8: 'النهائي' };
  const rounds = {};
  for (const m of matches.rows) {
    const r = m.round;
    if (!rounds[r]) rounds[r] = { round: r, name: roundNames[r] || '', matches: [] };
    // حساب الفائز
    let winner = m.actual_winner || null;
    if (!winner && m.actual_scorea != null && m.actual_scoreb != null) {
      if (m.actual_scorea > m.actual_scoreb) winner = m.teama || m.teamA;
      else if (m.actual_scoreb > m.actual_scorea) winner = m.teamb || m.teamB;
      else if (m.penalty_winner) winner = m.penalty_winner;
    }
    rounds[r].matches.push({
      id: m.id,
      match_label: m.match_label,
      teamA: m.teama || m.teamA,
      teamB: m.teamb || m.teamB,
      actual_winner: winner,
      penalty_winner: m.penalty_winner,
      winner_to_match_id: m.winner_to_match_id,
      winner_to_side: m.winner_to_side,
      stage: m.stage
    });
  }
  return { confirmed, rounds };
}

// إعادة بناء الأدوار الإقصائية بالكامل
async function rebuildKnockoutRounds() {
  // التحقق: لا توجد توقعات على مباريات الإقصائيات المنشورة
  const publishedRounds = await getPublishedRounds();
  const koRounds = [4, 5, 6, 7, 8];
  const publishedKoRounds = koRounds.filter(r => publishedRounds.includes(r));
  if (publishedKoRounds.length > 0) {
    const pubCheck = await pool.query(
      'SELECT COUNT(*) FROM predictions p JOIN matches m ON p.match_id = m.id WHERE m.round = ANY($1)',
      [publishedKoRounds]
    );
    if (parseInt(pubCheck.rows[0].count) > 0) {
      throw new Error('يوجد توقعات على مباريات إقصائية منشورة. قم بإلغاء نشر الجولات أولاً.');
    }
  }

  // التحقق: لا توجد نتائج لمباريات إقصائية بدأت بالفعل
  const startedCheck = await pool.query(
    "SELECT COUNT(*) FROM matches WHERE round >= 4 AND actual_scoreA IS NOT NULL AND start_at < NOW()"
  );
  if (parseInt(startedCheck.rows[0].count) > 0) {
    throw new Error('هناك مباريات إقصائية بدأت ولها نتائج. لا يمكن إعادة البناء.');
  }

  // إنشاء backup تلقائي
  const backupId = 'rebuild_backup_' + Date.now();
  const backupData = {
    predictions: (await pool.query('SELECT * FROM predictions')).rows,
    matches: (await pool.query('SELECT * FROM matches WHERE round >= 4')).rows,
    settings: (await pool.query("SELECT * FROM settings WHERE key IN ('round32_confirmed','round32_seeding','bracket_paths_initialized')")).rows,
  };
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
    [backupId, JSON.stringify(backupData)]
  );
  console.log('Backup saved:', backupId);

  // حذف علامات الاعتماد
  await pool.query("DELETE FROM settings WHERE key = 'round32_confirmed'");
  await pool.query("DELETE FROM settings WHERE key = 'round32_seeding'");

  // إعادة تعيين مباريات الأدوار الإقصائية — فقط الفرق والمسارات
  // لا نحذف actual_score أو النتائج أو التوقعات
  const fixtures = generateFixtures();
  const knockoutFixtures = fixtures.filter(f => f.round >= 4);
  const existingMatches = await pool.query(
    'SELECT id, round FROM matches WHERE round >= 4 ORDER BY id'
  );
  const existing = existingMatches.rows;

  for (let i = 0; i < knockoutFixtures.length && i < existing.length; i++) {
    const f = knockoutFixtures[i];
    const m = existing[i];
    await pool.query(
      'UPDATE matches SET teamA = $1, teamB = $2, match_label = NULL, winner_to_match_id = NULL, winner_to_side = NULL WHERE id = $3',
      [f.teamA, f.teamB, m.id]
    );
  }

  console.log('Knockout rounds rebuilt successfully. Backup key:', backupId);
}

// فحص مسار الأدوار الإقصائية
async function verifyKnockoutBracket() {
  const issues = [];
  const warnings = [];
  const allMatches = await pool.query(
    'SELECT id, round, match_label, teamA, teamB, winner_to_match_id, winner_to_side, actual_scoreA FROM matches WHERE round >= 4 ORDER BY round, id'
  );
  const matches = allMatches.rows;

  // تجميع المباريات حسب الدور
  const byRound = { 4: [], 5: [], 6: [], 7: [], 8: [] };
  const labelMap = {};
  for (const m of matches) {
    if (byRound[m.round]) byRound[m.round].push(m);
    if (m.match_label) labelMap[m.match_label] = m;
  }

  // 1. عدد المباريات لكل دور
  const expectedCount = { 4: 16, 5: 8, 6: 4, 7: 2, 8: 1 };
  for (const [r, expected] of Object.entries(expectedCount)) {
    const actual = (byRound[parseInt(r)] || []).length;
    if (actual !== expected) {
      issues.push(`الدور ${r}: عدد المباريات ${actual} (المتوقع ${expected})`);
    }
  }

  // 2. كل مباراة لها match_label (ما عدا إذا كان التوزيع لم يتم بعد)
  const koMatches = matches.filter(m => m.match_label);
  if (koMatches.length > 0) {
    const labels = new Set();
    for (const m of koMatches) {
      // تحقق من عدم تكرار match_label
      if (labels.has(m.match_label)) {
        issues.push(`مكرر match_label: ${m.match_label} (مباراة ${m.id})`);
      }
      labels.add(m.match_label);

      // تحقق من وجود winner_to_match_id (ما عدا النهائي)
      if (m.round < 8 && !m.winner_to_match_id) {
        issues.push(`مباراة ${m.id} (${m.match_label}) لا يوجد winner_to_match_id`);
      }
      // تحقق من وجود winner_to_side (ما عدا النهائي)
      if (m.round < 8 && !m.winner_to_side) {
        issues.push(`مباراة ${m.id} (${m.match_label}) لا يوجد winner_to_side`);
      }
      // تحقق من صحة winner_to_match_id (يشير لمباراة موجودة)
      if (m.winner_to_match_id) {
        const targetExists = matches.some(tm => tm.id === m.winner_to_match_id);
        if (!targetExists) {
          issues.push(`مباراة ${m.id} (${m.match_label}) winner_to_match_id=${m.winner_to_match_id} غير موجود`);
        }
      }
    }

    // تحقق من المباريات المقرر أن تستقبل فائزين
    for (const m of koMatches) {
      if (m.round >= 5 && m.round <= 8) {
        // هذه المباراة من المفترض أن تستقبل فائزين من الدور السابق
        const incomingFrom = koMatches.filter(
          src => src.winner_to_match_id === m.id
        );
        if (m.round < 8 && incomingFrom.length !== 2) {
          warnings.push(`مباراة ${m.id} (${m.match_label}) تستقبل ${incomingFrom.length} فائز (المتوقع 2)`);
        }
      }
    }
  }

  const counts = {};
  for (const r of [4, 5, 6, 7, 8]) {
    const list = byRound[r] || [];
    counts[r] = {
      total: list.length,
      with_label: list.filter(m => m.match_label).length,
      with_winner_to: list.filter(m => m.winner_to_match_id).length,
    };
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    counts,
    total_ko_matches: matches.length,
    bracket_initialized: koMatches.length > 0,
  };
}
