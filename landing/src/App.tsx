// Configurable so the operator can point this at a real support/sales
// address per deployment without a code change - falls back to a clearly
// placeholder-looking address so it's obvious this needs to be set for
// real before the page is shown to actual prospects (see BUILD_LOG.md).
const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || 'contact@example.com';
const DEMO_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('בקשת דמו - PII Shield')}`;

function Nav() {
  return (
    <header className="border-b border-gray-100">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-lg font-bold text-indigo-700">PII Shield</span>
        <a href={DEMO_MAILTO} className="btn-primary">
          בקשת דמו
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
      <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-indigo-600">
        הגנת מידע עבור ארגונים שמשתמשים בכלי AI
      </p>
      <h1 className="text-4xl font-bold leading-tight text-gray-900 sm:text-5xl">
        העובדים שלכם כותבים לChatGPT.
        <br />
        מה קורה כשהם מדביקים שם פרטי לקוח?
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600">
        PII Shield חוסמת מידע רגיש - שמות, מספרי תעודת זהות, פרטי תיקים ועוד - לפני שהוא יוצא
        מהדפדפן אל ChatGPT, Claude או Gemini. בזמן אמת, בלי להאט את העבודה השוטפת.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <a href={DEMO_MAILTO} className="btn-primary">
          בקשת דמו
        </a>
        <a href="#how-it-works" className="btn-secondary">
          איך זה עובד
        </a>
      </div>
      <p className="mt-4 text-sm text-gray-400">
        המידע הרגיש שלכם אף פעם לא מגיע אלינו - רק hash חד-כיווני, שלא ניתן להפוך בחזרה לערך המקורי.
      </p>
    </section>
  );
}

function ProblemSection() {
  const points = [
    {
      title: 'זה כבר קורה',
      body: 'עובדים מדביקים מסמכים, מיילים ותכתובות עם פרטי לקוחות אמיתיים לתוך כלי AI - כדי לנסח, לסכם או לתרגם - בלי לחשוב פעמיים.',
    },
    {
      title: 'לצוותי ה-IT והציות אין נראות',
      body: 'מה שקורה בתוך חלון הצ׳אט לא עובר דרך שום מערכת שהארגון שולט בה - אין לוג, אין התראה, אין דרך לדעת שזה קרה.',
    },
    {
      title: 'החשיפה היא משפטית, לא רק טכנית',
      body: 'עבור משרדי עו״ד, גופים רפואיים ופיננסיים, דליפת מידע לקוח לצד שלישי היא הפרת חובת סודיות - לא רק אירוע אבטחת מידע.',
    },
  ];
  return (
    <section className="bg-gray-50 py-16">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-center text-2xl font-bold text-gray-900">הסיכון שכבר קיים אצלכם היום</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {points.map((p) => (
            <div key={p.title} className="card">
              <h3 className="font-semibold text-gray-900">{p.title}</h3>
              <p className="mt-2 text-sm text-gray-600">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      step: '1',
      title: 'תוסף דפדפן קליל לעובדים',
      body: 'מותקן תוך דקות, פועל ברקע על ChatGPT, Claude ו-Gemini, ולא משנה את חוויית העבודה הרגילה.',
    },
    {
      step: '2',
      title: 'ה-connector רץ אצלכם, לא אצלנו',
      body: 'מזהה אילו נתונים במערכות שלכם רגישים, ושולח החוצה רק hash חד-כיווני - לעולם לא את הערך המקורי.',
    },
    {
      step: '3',
      title: 'חסימה בזמן אמת, לפני שהמידע יוצא',
      body: 'ניסיון לשלוח מידע רגיש נחסם או מוסתר על ידי התוסף בדפדפן עצמו - לפני שהבקשה בכלל יוצאת לרשת.',
    },
  ];
  return (
    <section id="how-it-works" className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-center text-2xl font-bold text-gray-900">איך זה עובד</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.step} className="card">
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                {s.step}
              </div>
              <h3 className="font-semibold text-gray-900">{s.title}</h3>
              <p className="mt-2 text-sm text-gray-600">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section className="bg-indigo-950 py-16 text-white">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-2xl font-bold">אנחנו בנויים כך שלעולם לא נראה את המידע הרגיש שלכם</h2>
        <p className="mx-auto mt-4 max-w-2xl text-indigo-100">
          המידע הגולמי נשאר תמיד בתוך הרשת שלכם או בדפדפן של העובד. המערכת המרכזית מקבלת ומאחסנת
          אך ורק hash חד-כיווני - לא ניתן לשחזר ממנו את הערך המקורי - כך שגם אנחנו, כספק, לעולם
          לא נחשפים לנתוני הלקוחות שלכם.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-indigo-100">
          ואם החיבור לשרת לא זמין? התוסף עובר אוטומטית למצב הגנה מחמיר יותר (fail-safe) - הוא לעולם
          לא שולח מידע לא בדוק, גם אם זה אומר לחסום יותר מהנדרש עד לחיבור מחדש.
        </p>
      </div>
    </section>
  );
}

function AudienceSection() {
  const audiences = ['משרדי עורכי דין', 'גופי בריאות וקופות חולים', 'פיננסים וביטוח', 'משאבי אנוש וגיוס'];
  return (
    <section className="py-16">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-2xl font-bold text-gray-900">למי זה מתאים</h2>
        <p className="mx-auto mt-3 max-w-2xl text-gray-600">
          לכל ארגון שמנהל מידע רגיש של לקוחות ורוצה לאפשר לעובדים להשתמש בכלי AI - בלי לוותר על
          סודיות ואחריות משפטית.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {audiences.map((a) => (
            <span key={a} className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700">
              {a}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContactSection() {
  return (
    <section className="bg-gray-50 py-16">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-2xl font-bold text-gray-900">רוצים לראות איך זה עובד אצלכם?</h2>
        <p className="mt-3 text-gray-600">
          נשמח לתאם דמו קצר ולהראות בדיוק מה קורה כשעובד מנסה לשלוח מידע רגיש לכלי AI.
        </p>
        <div className="mt-6">
          <a href={DEMO_MAILTO} className="btn-primary">
            בקשת דמו
          </a>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          או כתבו לנו ישירות ל־
          <a href={DEMO_MAILTO} className="font-medium text-indigo-600 hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-100 py-8">
      <div className="mx-auto max-w-6xl px-6 text-center text-sm text-gray-400">
        © {new Date().getFullYear()} PII Shield. כל הזכויות שמורות.
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <div dir="rtl">
      <Nav />
      <Hero />
      <ProblemSection />
      <HowItWorks />
      <TrustSection />
      <AudienceSection />
      <ContactSection />
      <Footer />
    </div>
  );
}
