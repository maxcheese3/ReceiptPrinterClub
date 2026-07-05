interface FeedbackBannerProps {
  type: 'success' | 'error' | null;
  message: string;
}

export default function FeedbackBanner({ type, message }: FeedbackBannerProps) {
  if (!type) return null;
  return <div className={`feedback ${type}`}>{message}</div>;
}
