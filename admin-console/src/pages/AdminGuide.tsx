import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ShieldCheck, Workflow, HelpCircle } from 'lucide-react';

export function AdminGuide() {
  const { t } = useTranslation();
  const faq = t('guide.faq', { returnObjects: true }) as { q: string; a: string }[];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t('guide.title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('guide.intro')}</p>
      </div>

      <div className="card">
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold text-gray-800">{t('guide.whatIsTitle')}</h2>
        </div>
        <p className="text-sm leading-relaxed text-gray-600">{t('guide.whatIsBody')}</p>
      </div>

      <div className="card">
        <div className="mb-2 flex items-center gap-2">
          <Workflow className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold text-gray-800">{t('guide.howItWorksTitle')}</h2>
        </div>
        <p className="text-sm leading-relaxed text-gray-600">{t('guide.howItWorksBody')}</p>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold text-gray-800">{t('guide.faqTitle')}</h2>
        </div>
        <div className="space-y-4">
          {faq.map((item, i) => (
            <div key={i}>
              <p className="text-sm font-medium text-gray-800">{item.q}</p>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
