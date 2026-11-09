import React from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  score: number;
  max?: number;
  onChange?: (newScore: number) => void;
  size?: 'sm' | 'md' | 'lg';
}

export const StarRating: React.FC<StarRatingProps> = ({
  score,
  max = 5,
  onChange,
  size = 'md',
}) => {
  const iconSize = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';
  const stars = Array.from({ length: max }, (_, idx) => idx + 1);

  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`Rating: ${score} out of ${max} stars`}>
      {stars.map((star) => {
        const filled = star <= Math.round(score);
        if (onChange) {
          return (
            <button
              key={star}
              type="button"
              onClick={() => onChange(star)}
              className="p-0.5 rounded hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-amber-400"
              title={`Rate ${star} star${star > 1 ? 's' : ''}`}
            >
              <Star
                className={`${iconSize} ${
                  filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-300'
                }`}
              />
            </button>
          );
        }
        return (
          <Star
            key={star}
            className={`${iconSize} ${
              filled ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
            }`}
          />
        );
      })}
    </div>
  );
};
