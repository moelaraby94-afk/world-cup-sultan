const { Pool, types } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

// Force TIMESTAMP (type 1114) values to be treated as UTC regardless of Node.js timezone
types.setTypeParser(1114, (val) => new Date(val + 'Z'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
});

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
  fixtures.push({ teamA: 'فائز م49', teamB: 'فائز م50', stage: 'دور الـ 16', round: 5, start: '2026-07-04T17:00:00Z' }); // 1pm ET
  fixtures.push({ teamA: 'فائز م53', teamB: 'فائز م54', stage: 'دور الـ 16', round: 5, start: '2026-07-04T21:00:00Z' }); // 5pm ET

  // يوم 5 يوليو (الأحد)
  fixtures.push({ teamA: 'فائز م51', teamB: 'فائز م52', stage: 'دور الـ 16', round: 5, start: '2026-07-05T20:00:00Z' }); // 4pm ET
  fixtures.push({ teamA: 'فائز م55', teamB: 'فائز م56', stage: 'دور الـ 16', round: 5, start: '2026-07-06T00:00:00Z' }); // 8pm ET

  // يوم 6 يوليو (الإثنين)
  fixtures.push({ teamA: 'فائز م57', teamB: 'فائز م58', stage: 'دور الـ 16', round: 5, start: '2026-07-06T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'فائز م59', teamB: 'فائز م60', stage: 'دور الـ 16', round: 5, start: '2026-07-06T21:00:00Z' }); // 5pm ET

  // يوم 7 يوليو (الثلاثاء)
  fixtures.push({ teamA: 'فائز م61', teamB: 'فائز م62', stage: 'دور الـ 16', round: 5, start: '2026-07-07T16:00:00Z' }); // 12pm ET
  fixtures.push({ teamA: 'فائز م63', teamB: 'فائز م64', stage: 'دور الـ 16', round: 5, start: '2026-07-07T20:00:00Z' }); // 4pm ET

  // ============================
  // ربع النهائي (Round 6) — 4 مباريات
  // ============================
  fixtures.push({ teamA: 'فائز ثمن 1', teamB: 'فائز ثمن 2', stage: 'ربع النهائي', round: 6, start: '2026-07-09T20:00:00Z' }); // 4pm ET
  fixtures.push({ teamA: 'فائز ثمن 3', teamB: 'فائز ثمن 4', stage: 'ربع النهائي', round: 6, start: '2026-07-10T19:00:00Z' }); // 3pm ET
  fixtures.push({ teamA: 'فائز ثمن 5', teamB: 'فائز ثمن 6', stage: 'ربع النهائي', round: 6, start: '2026-07-11T21:00:00Z' }); // 5pm ET
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

    await client.query('CREATE INDEX IF NOT EXISTS idx_predictions_user_id ON predictions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_predictions_match_id ON predictions(match_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_matches_start_at ON matches(start_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');

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
    // Clean up old migration flag
    await client.query("DELETE FROM settings WHERE key = 'tz_migration_done'");

    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminCheck = await client.query("SELECT id FROM users WHERE username = $1", [adminUsername]);
    if (adminCheck.rows.length === 0) {
      const hash = bcrypt.hashSync(adminPassword, 10);
      await client.query(
        "INSERT INTO users (name, username, password_hash, role, status) VALUES ($1, $2, $3, $4, $5)",
        ['المدير', adminUsername, hash, 'admin', 'approved']
      );
    }

    const settingsCheck = await client.query("SELECT value FROM settings WHERE key = 'current_round'");
    if (settingsCheck.rows.length === 0) {
      await client.query("INSERT INTO settings (key, value) VALUES ('current_round', '1')");
    }

    const matchesCheck = await client.query('SELECT COUNT(*) FROM matches');
    const expectedCount = 103;
    const currentCount = parseInt(matchesCheck.rows[0].count);
    if (currentCount !== expectedCount) {
      console.log(`Matches count is ${currentCount}, expected ${expectedCount}. Recreating...`);
      await client.query('DELETE FROM predictions');
      await client.query('DELETE FROM matches');
      const fixtures = generateFixtures();
      for (const fixture of fixtures) {
        await client.query(
          'INSERT INTO matches (teamA, teamB, stage, start_at, round) VALUES ($1, $2, $3, $4, $5)',
          [fixture.teamA, fixture.teamB, fixture.stage, fixture.start, fixture.round]
        );
      }
      console.log(`Created ${fixtures.length} matches`);
    } else if (currentCount > 0) {
      const sampleMatch = await client.query('SELECT teamA FROM matches LIMIT 1');
      const expectedTeams = Object.values(GROUPS).flat();
      if (!expectedTeams.includes(sampleMatch.rows[0].teama)) {
        console.log('Match team names are outdated. Recreating...');
        await client.query('DELETE FROM predictions');
        await client.query('DELETE FROM matches');
        const fixtures = generateFixtures();
        for (const fixture of fixtures) {
          await client.query(
            'INSERT INTO matches (teamA, teamB, stage, start_at, round) VALUES ($1, $2, $3, $4, $5)',
            [fixture.teamA, fixture.teamB, fixture.stage, fixture.start, fixture.round]
          );
        }
        console.log(`Created ${fixtures.length} matches`);
      }
    }

    await client.query('COMMIT');
    console.log('Database initialized successfully');
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

async function getMatches() {
  const result = await pool.query('SELECT * FROM matches ORDER BY start_at ASC');
  return result.rows.map(normalizeMatch);
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

async function getMatchById(matchId) {
  const result = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
  return normalizeMatch(result.rows[0]) || null;
}

async function savePrediction(userId, matchId, scoreA, scoreB) {
  const result = await pool.query(`
    INSERT INTO predictions (user_id, match_id, scoreA, scoreB, updated_at)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, match_id)
    DO UPDATE SET scoreA = $3, scoreB = $4, updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [userId, matchId, scoreA, scoreB]);
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
    SELECT p.*, m.teamA, m.teamB, m.stage, m.start_at, m.round, m.actual_scoreA, m.actual_scoreB
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
}

async function updateMatchResult(matchId, scoreA, scoreB) {
  await pool.query(
    'UPDATE matches SET actual_scoreA = $1, actual_scoreB = $2 WHERE id = $3',
    [scoreA, scoreB, matchId]
  );
}

async function getLeaderboard() {
  const result = await pool.query(`
    SELECT u.id, u.name, u.username,
      COALESCE(SUM(
        CASE
          WHEN p.scoreA = m.actual_scoreA AND p.scoreB = m.actual_scoreB THEN 20
          WHEN p.scoreA IS NOT NULL AND m.actual_scoreA IS NOT NULL THEN
            CASE
              WHEN (p.scoreA > p.scoreB AND m.actual_scoreA > m.actual_scoreB)
                OR (p.scoreA < p.scoreB AND m.actual_scoreA < m.actual_scoreB)
                OR (p.scoreA = p.scoreB AND m.actual_scoreA = m.actual_scoreB) THEN
                CASE
                  WHEN (p.scoreA - p.scoreB) = (m.actual_scoreA - m.actual_scoreB) THEN 15
                  ELSE 10
                END
              ELSE 0
            END
          ELSE 0
        END
      ), 0) AS total,
      COUNT(p.id) AS predictions_count,
      COALESCE(SUM(
        CASE
          WHEN p.scoreA = m.actual_scoreA AND p.scoreB = m.actual_scoreB THEN 1
          ELSE 0
        END
      ), 0)::int AS correct_predictions,
      COUNT(CASE WHEN m.actual_scoreA IS NOT NULL THEN 1 END) AS judged_predictions
    FROM users u
    LEFT JOIN predictions p ON u.id = p.user_id
    LEFT JOIN matches m ON p.match_id = m.id
    WHERE u.role != 'admin' AND u.status = 'approved'
    GROUP BY u.id, u.name, u.username
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
    SELECT u.name, COALESCE(SUM(
      CASE
        WHEN p.scoreA = m.actual_scoreA AND p.scoreB = m.actual_scoreB THEN 20
        WHEN p.scoreA IS NOT NULL AND m.actual_scoreA IS NOT NULL THEN
          CASE
            WHEN (p.scoreA > p.scoreB AND m.actual_scoreA > m.actual_scoreB)
              OR (p.scoreA < p.scoreB AND m.actual_scoreA < m.actual_scoreB)
              OR (p.scoreA = p.scoreB AND m.actual_scoreA = m.actual_scoreB) THEN
              CASE
                WHEN (p.scoreA - p.scoreB) = (m.actual_scoreA - m.actual_scoreB) THEN 15
                ELSE 10
              END
            ELSE 0
          END
        ELSE 0
      END
    ), 0) AS total
    FROM users u
    LEFT JOIN predictions p ON u.id = p.user_id
    LEFT JOIN matches m ON p.match_id = m.id
    WHERE u.role != 'admin' AND u.status = 'approved'
    GROUP BY u.id, u.name
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
    created_at: row.created_at
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
    user_name: row.user_name || row.username || null
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

function calculatePoints(predA, predB, actA, actB) {
  if (actA == null || actB == null) return 0;
  if (predA == null || predB == null) return 0;

  if (predA === actA && predB === actB) return 20;
  const actualDiff = actA - actB;
  const predictedDiff = predA - predB;
  const actualOutcome = Math.sign(actualDiff);
  const predictedOutcome = Math.sign(predictedDiff);

  if (actualOutcome === predictedOutcome) {
    if (actualDiff === predictedDiff) return 15;
    return 10;
  }
  return 0;
}

function getGroups() {
  return GROUPS;
}

module.exports = {
  pool,
  init,
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
  getMatchById,
  savePrediction,
  getPrediction,
  getUserPredictions,
  getLastPrediction,
  updateKnockoutTeams,
  updateMatchResult,
  getLeaderboard,
  getLeaderboardStats,
  getGroupStandings,
  calculateGroupStandings,
  calculatePoints,
  getTeamFlags,
  getGroups,
  initNewsTable,
  initNewsCommentsTable,
  getNews,
  addNews,
  deleteNews,
  updateNews,
  addComment,
  getCommentsByNewsId,
  getApprovedUsers,
  getAllComments,
  hideComment,
  showComment,
  deleteComment,
  advanceKnockoutTeams
};

// ===== AUTO KNOCKOUT ADVANCEMENT =====
// نظام كأس العالم 2026 الرسمي
// 12 مجموعة × 4 فرق = 48 فريق
// الأول والثاني من كل مجموعة + أفضل 8 ثوالث = 32 فريق
// دور الـ 32 = 16 مباراة → دور الـ 16 = 8 مباريات → ربع = 4 → نصف = 2 → نهائي = 1
async function advanceKnockoutTeams() {
  try {
    const allMatches = await getMatches();

    // تحقق هل دور المجموعات اكتمل
    const groupMatches = allMatches.filter(m => m.round >= 1 && m.round <= 3);
    const completedGroupMatches = groupMatches.filter(m => m.actual_scoreA !== null && m.actual_scoreB !== null);

    if (groupMatches.length > 0 && completedGroupMatches.length === groupMatches.length) {
      await advanceToRound32(allMatches);
    }

    // تقدم الفائزين في كل دور إقصائي
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
    if (isPlaceholder(m.teamA)) {
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

function getMatchWinner(match) {
  if (match.actual_scoreA === null || match.actual_scoreB === null) return null;
  if (match.actual_scoreA > match.actual_scoreB) return match.teamA;
  if (match.actual_scoreB > match.actual_scoreA) return match.teamB;
  // تعادل في الأدوار الإقصائية - نرجع الفريق A كـ default (الأدمن يقدر يعدل يدوي)
  return match.teamA;
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
  return result.rows[0];
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
    SELECT c.*, u.name AS user_name, n.title AS news_title
    FROM news_comments c
    JOIN users u ON c.user_id = u.id
    JOIN news n ON c.news_id = n.id
    ORDER BY c.created_at DESC
  `);
  return result.rows;
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
