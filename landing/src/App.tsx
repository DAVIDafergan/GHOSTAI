import { motion, type Variants } from 'framer-motion';
import {
  ShieldCheck,
  ArrowLeft,
  Lock,
  Eye,
  ScrollText,
  Gavel,
  Puzzle,
  Server,
  ShieldAlert,
  Scale,
  HeartPulse,
  Landmark,
  Users,
  Mail,
} from 'lucide-react';

// Temporary contact address until a real domain/mailbox is registered for
// the chosen name (see BUILD_LOG.md) - still overridable via
// VITE_CONTACT_EMAIL per deployment without a code change once that exists.
const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || 'DA@101.ORG.IL';
const DEMO_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('בקשת דמו - Nistar')}`;

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-200/70 bg-white/75 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-[0_2px_8px_-2px_rgb(79_70_229/0.5)]">
            <ShieldCheck className="h-4.5 w-4.5" strokeWidth={2.5} />
          </div>
          <span className="text-lg font-extrabold tracking-tight text-gray-900">Nistar</span>
        </div>
        <a href={DEMO_MAILTO} className="btn-primary">
          בקשת דמו
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 bg-grid-pattern [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black_40%,transparent_100%)]" />
      <div className="pointer-events-none absolute right-1/2 top-[-120px] h-[420px] w-[620px] translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-300/40 via-violet-300/30 to-transparent blur-3xl" />

      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="relative mx-auto max-w-4xl px-6 pb-20 pt-24 text-center sm:pt-32"
      >
        <motion.div variants={fadeUp} className="mb-6 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50/80 px-4 py-1.5 text-sm font-medium text-indigo-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-600" />
            </span>
            הגנת מידע עבור ארגונים שמשתמשים בכלי AI
          </span>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          className="text-5xl font-black leading-[1.08] tracking-tight text-gray-900 sm:text-6xl lg:text-7xl"
        >
          העובדים שלכם כותבים
          <br />
          ל<span className="gradient-text">ChatGPT</span>. מה קורה כשהם
          <br />
          מדביקים שם <span className="gradient-text">פרטי לקוח</span>?
        </motion.h1>

        <motion.p
          variants={fadeUp}
          className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-gray-600 sm:text-xl"
        >
          Nistar חוסמת מידע רגיש - שמות, מספרי תעודת זהות, פרטי תיקים ועוד - לפני שהוא יוצא
          מהדפדפן אל ChatGPT, Claude או Gemini. בזמן אמת, בלי להאט את העבודה השוטפת.
        </motion.p>

        <motion.div variants={fadeUp} className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a href={DEMO_MAILTO} className="btn-primary">
            בקשת דמו
          </a>
          <a href="#how-it-works" className="btn-secondary">
            איך זה עובד
          </a>
        </motion.div>

        <motion.p
          variants={fadeUp}
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-gray-400"
        >
          <Lock className="h-3.5 w-3.5" strokeWidth={2} />
          המידע הרגיש שלכם אף פעם לא מגיע אלינו - רק hash חד-כיווני, שלא ניתן להפוך בחזרה לערך המקורי.
        </motion.p>
      </motion.div>
    </section>
  );
}

function ProblemSection() {
  const points = [
    {
      icon: ScrollText,
      title: 'זה כבר קורה',
      body: 'עובדים מדביקים מסמכים, מיילים ותכתובות עם פרטי לקוחות אמיתיים לתוך כלי AI - כדי לנסח, לסכם או לתרגם - בלי לחשוב פעמיים.',
    },
    {
      icon: Eye,
      title: 'לצוותי ה-IT והציות אין נראות',
      body: 'מה שקורה בתוך חלון הצ׳אט לא עובר דרך שום מערכת שהארגון שולט בה - אין לוג, אין התראה, אין דרך לדעת שזה קרה.',
    },
    {
      icon: Gavel,
      title: 'החשיפה היא משפטית, לא רק טכנית',
      body: 'עבור משרדי עו״ד, גופים רפואיים ופיננסיים, דליפת מידע לקוח לצד שלישי היא הפרת חובת סודיות - לא רק אירוע אבטחת מידע.',
    },
  ];
  return (
    <section className="border-t border-gray-100 bg-gray-50/60 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-2xl text-center"
        >
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
            הסיכון שכבר קיים אצלכם היום
          </h2>
        </motion.div>
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-14 grid gap-6 sm:grid-cols-3"
        >
          {points.map((p) => (
            <motion.div key={p.title} variants={fadeUp} className="card">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <p.icon className="h-5 w-5" strokeWidth={2} />
              </div>
              <h3 className="font-bold text-gray-900">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{p.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      step: '1',
      icon: Puzzle,
      title: 'תוסף דפדפן קליל לעובדים',
      body: 'מותקן תוך דקות, פועל ברקע על ChatGPT, Claude ו-Gemini, ולא משנה את חוויית העבודה הרגילה.',
    },
    {
      step: '2',
      icon: Server,
      title: 'ה-connector רץ אצלכם, לא אצלנו',
      body: 'מזהה אילו נתונים במערכות שלכם רגישים, ושולח החוצה רק hash חד-כיווני - לעולם לא את הערך המקורי.',
    },
    {
      step: '3',
      icon: ShieldAlert,
      title: 'חסימה בזמן אמת, לפני שהמידע יוצא',
      body: 'ניסיון לשלוח מידע רגיש נחסם או מוסתר על ידי התוסף בדפדפן עצמו - לפני שהבקשה בכלל יוצאת לרשת.',
    },
  ];
  return (
    <section id="how-it-works" className="py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-2xl text-center"
        >
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">איך זה עובד</h2>
        </motion.div>
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="relative mt-16 grid gap-8 sm:grid-cols-3"
        >
          <div className="absolute top-[38px] hidden h-px w-full bg-gradient-to-l from-transparent via-indigo-200 to-transparent sm:block" />
          {steps.map((s) => (
            <motion.div key={s.step} variants={fadeUp} className="relative">
              <div className="mb-5 flex h-[76px] w-[76px] flex-col items-center justify-center rounded-2xl border border-indigo-100 bg-white text-indigo-600 shadow-[0_8px_24px_-8px_rgb(79_70_229/0.25)]">
                <s.icon className="h-6 w-6" strokeWidth={1.8} />
                <span className="mt-1 text-[11px] font-bold text-indigo-400">שלב {s.step}</span>
              </div>
              <h3 className="font-bold text-gray-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-950 py-24 text-white sm:py-32">
      <div className="pointer-events-none absolute inset-0 bg-grid-pattern bg-grid opacity-[0.15] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black_0%,transparent_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/20 blur-3xl" />

      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
        className="relative mx-auto max-w-4xl px-6 text-center"
      >
        <div className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur">
          <ShieldCheck className="h-7 w-7" strokeWidth={1.8} />
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          אנחנו בנויים כך שלעולם לא נראה את המידע הרגיש שלכם
        </h2>
        <p className="mx-auto mt-6 max-w-2xl leading-relaxed text-indigo-100/90">
          המידע הגולמי נשאר תמיד בתוך הרשת שלכם או בדפדפן של העובד. המערכת המרכזית מקבלת ומאחסנת
          אך ורק hash חד-כיווני - לא ניתן לשחזר ממנו את הערך המקורי - כך שגם אנחנו, כספק, לעולם
          לא נחשפים לנתוני הלקוחות שלכם.
        </p>
        <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-indigo-100/90">
          ואם החיבור לשרת לא זמין? התוסף עובר אוטומטית למצב הגנה מחמיר יותר (fail-safe) - הוא לעולם
          לא שולח מידע לא בדוק, גם אם זה אומר לחסום יותר מהנדרש עד לחיבור מחדש.
        </p>
      </motion.div>
    </section>
  );
}

function AudienceSection() {
  const audiences = [
    { icon: Scale, label: 'משרדי עורכי דין' },
    { icon: HeartPulse, label: 'גופי בריאות וקופות חולים' },
    { icon: Landmark, label: 'פיננסים וביטוח' },
    { icon: Users, label: 'משאבי אנוש וגיוס' },
  ];
  return (
    <section className="py-24 sm:py-32">
      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
        className="mx-auto max-w-4xl px-6 text-center"
      >
        <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">למי זה מתאים</h2>
        <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-gray-600">
          לכל ארגון שמנהל מידע רגיש של לקוחות ורוצה לאפשר לעובדים להשתמש בכלי AI - בלי לוותר על
          סודיות ואחריות משפטית.
        </p>
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="mt-10 flex flex-wrap justify-center gap-3"
        >
          {audiences.map((a) => (
            <motion.span
              key={a.label}
              variants={fadeUp}
              whileHover={{ y: -3 }}
              className="inline-flex cursor-default items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-shadow duration-200 hover:border-indigo-200 hover:shadow-md"
            >
              <a.icon className="h-4 w-4 text-indigo-500" strokeWidth={2} />
              {a.label}
            </motion.span>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}

function ContactSection() {
  return (
    <section className="border-t border-gray-100 bg-gray-50/60 py-24 sm:py-32">
      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
        className="mx-auto max-w-2xl px-6 text-center"
      >
        <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
          רוצים לראות איך זה עובד אצלכם?
        </h2>
        <p className="mt-4 leading-relaxed text-gray-600">
          נשמח לתאם דמו קצר ולהראות בדיוק מה קורה כשעובד מנסה לשלוח מידע רגיש לכלי AI.
        </p>
        <div className="mt-8 flex justify-center">
          <a href={DEMO_MAILTO} className="btn-primary inline-flex items-center gap-2">
            בקשת דמו
            <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
          </a>
        </div>
        <p className="mt-5 inline-flex items-center gap-1.5 text-sm text-gray-500">
          <Mail className="h-3.5 w-3.5" strokeWidth={2} />
          או כתבו לנו ישירות ל־
          <a href={DEMO_MAILTO} className="font-medium text-indigo-600 hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </motion.div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-100 py-8">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-6 text-sm text-gray-400">
        <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
        <span>
          © {new Date().getFullYear()} Nistar. כל הזכויות שמורות.
        </span>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <div dir="rtl" className="overflow-x-hidden">
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
