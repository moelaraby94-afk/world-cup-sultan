# 🏆 World Cup 2026 Predictions

نظام مسابقة توقعات كأس العالم 2026 — Node.js + Express + PostgreSQL + EJS

## المتطلبات
- Node.js 18+ (LTS)
- PostgreSQL 14+
- npm

## التشغيل المحلي
```bash
npm install
npm start
```
ثم افتح `http://localhost:3000`

## متغيرات البيئة
انسخ `.env.example` إلى `.env` وعدّل القيم:
```bash
cp .env.example .env
```

## Docker
```bash
docker-compose up -d
```

## المميزات
- تسجيل متسابقين وموافقة الأدمن
- توقعات المباريات (دوري المجموعات + الأدوار الإقصائية)
- إغلاق التوقع تلقائياً قبل المباراة بـ 10 دقائق
- نظام نقاط متقدم (تطابق مضبوط، فائز صحيح، فارق أهداف، ركلات ترجيح)
- لعبة التحدي (توقع المتأهلين للأدوار المتقدمة)
- لوحة تحكم كاملة للأدمن
- نظام أخبار مع تعليقات
- ترتيب تلقائي للمتسابقين
- تصميم متجاوب (Mobile + Desktop)

## نظام النقاط
| الحالة | النقاط |
|---|---|
| تطابق النتيجة بالضبط | 20 |
| الفائز الصحيح + فارق الأهداف | 15 |
| الفائز الصحيح فقط | 10 |
| ركلات الترجيح الصحيحة | +5 (الأدوار الإقصائية) |

## التقنيات
- **Backend**: Node.js, Express
- **Database**: PostgreSQL (connection pooling)
- **Frontend**: EJS templates, CSS3
- **Security**: Helmet CSP, session management, rate limiting, XSS prevention
- **Deployment**: Docker, Dokploy
