import { useState } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Send, CheckCircle, Star } from 'lucide-react';
import { AnimatedButton } from './AnimatedButton';
import { FadeInSection } from './FadeInSection';

/**
 * In-app feedback form for collecting user feedback.
 * No private data is collected — only rating, category, and free text.
 */

const GOOGLE_FORM_URL = 'https://forms.gle/PLACEHOLDER';

interface FeedbackFormProps {
  walletAddress?: string | null;
}

export function FeedbackForm({ walletAddress }: FeedbackFormProps) {
  const [rating, setRating] = useState<number>(0);
  const [category, setCategory] = useState<string>('');
  const [feedback, setFeedback] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const categories = [
    { id: 'ux', label: 'User Experience' },
    { id: 'feature', label: 'Feature Request' },
    { id: 'bug', label: 'Bug Report' },
    { id: 'privacy', label: 'Privacy Concern' },
    { id: 'other', label: 'Other' },
  ];

  const handleSubmit = async () => {
    if (!rating || !category || !feedback.trim()) return;

    setIsSubmitting(true);

    const formUrl = new URL(GOOGLE_FORM_URL);
    formUrl.searchParams.set('rating', String(rating));
    formUrl.searchParams.set('category', category);
    formUrl.searchParams.set('feedback', feedback);
    if (walletAddress) {
      formUrl.searchParams.set('wallet', walletAddress.slice(0, 12) + '...');
    }

    await new Promise((r) => setTimeout(r, 800));

    window.open(formUrl.toString(), '_blank');
    setSubmitted(true);
    setIsSubmitting(false);
  };

  if (submitted) {
    return (
      <FadeInSection delay={0}>
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass rounded-2xl p-8 text-center max-w-lg mx-auto"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-green-500/10 border border-green-500/30 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-green-400" strokeWidth={1.5} />
          </div>
          <h3 className="text-xl font-bold text-night-text mb-2">Thank You!</h3>
          <p className="text-sm text-night-muted mb-4">
            Your feedback helps us improve NightScore for everyone.
          </p>
          <AnimatedButton
            variant="secondary"
            onClick={() => {
              setSubmitted(false);
              setRating(0);
              setCategory('');
              setFeedback('');
            }}
            className="px-4 py-2 text-sm"
          >
            Submit More Feedback
          </AnimatedButton>
        </motion.div>
      </FadeInSection>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto mt-8">
      <FadeInSection delay={0}>
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-blue-400" strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-night-text">
                Share Your Feedback
              </h3>
              <p className="text-xs text-night-muted">
                Help us improve NightScore — your input shapes the product
              </p>
            </div>
          </div>

          <div className="mb-5">
            <label className="text-xs text-night-muted block mb-2">
              How would you rate your experience?
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    className={`w-8 h-8 ${
                      star <= rating
                        ? 'text-amber-400 fill-amber-400'
                        : 'text-night-muted/30'
                    }`}
                    strokeWidth={1.5}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="mb-5">
            <label className="text-xs text-night-muted block mb-2">
              Category
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    category === cat.id
                      ? 'bg-night-accent/20 border-night-accent/50 text-night-accent border'
                      : 'bg-night-bg border border-night-accent/10 text-night-muted hover:border-night-accent/30'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-5">
            <label className="text-xs text-night-muted block mb-2">
              Your feedback
            </label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Tell us what you think — what works, what doesn't, what you'd like to see..."
              rows={4}
              className="w-full px-3 py-2 bg-night-bg border border-night-accent/20 rounded-lg text-night-text text-sm focus:outline-none focus:border-night-accent/50 transition-colors resize-none"
            />
          </div>

          <AnimatedButton
            variant="primary"
            onClick={handleSubmit}
            disabled={!rating || !category || !feedback.trim() || isSubmitting}
            fullWidth
            className="px-5 py-3"
          >
            <span className="flex items-center justify-center gap-2">
              <Send className="w-4 h-4" strokeWidth={1.5} />
              {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
            </span>
          </AnimatedButton>

          <p className="text-xs text-night-muted/50 text-center mt-3">
            No private wallet data is included in feedback. Only your rating and comments are shared.
          </p>
        </div>
      </FadeInSection>
    </div>
  );
}
