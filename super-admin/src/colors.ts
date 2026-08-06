// Same scheme as the admin-console: green = healthy/OK, orange = needs
// attention, red = critical/disabled.
export const COLORS = {
  ok: 'bg-green-100 text-green-800',
  okDot: 'bg-green-500',
  warning: 'bg-orange-100 text-orange-800',
  warningDot: 'bg-orange-500',
  critical: 'bg-red-100 text-red-700',
  criticalDot: 'bg-red-500',
  neutral: 'bg-gray-100 text-gray-600',
  neutralDot: 'bg-gray-400',
} as const;
