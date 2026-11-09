import React, { useEffect, useRef, useState } from 'react';
import { Fish, Lock, Waves } from 'lucide-react';
import type { AuthUserInfo } from '../../shared/types.ts';
import { api } from '../api.ts';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              shape?: 'rectangular' | 'pill';
              width?: number;
              text?: 'signin_with' | 'continue_with';
            }
          ) => void;
        };
      };
    };
  }
}

interface GoogleSignInGateProps {
  googleClientId: string;
  onSignedIn: (user: AuthUserInfo) => void;
}

export const GoogleSignInGate: React.FC<GoogleSignInGateProps> = ({
  googleClientId,
  onSignedIn,
}) => {
  const buttonContainerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const initGoogleButton = () => {
      if (cancelled || !window.google || !buttonContainerRef.current) return;

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          if (!response.credential) {
            setError('Google Sign-In did not return a credential.');
            return;
          }
          setVerifying(true);
          setError('');
          try {
            const res = await api.signInWithGoogle(response.credential);
            onSignedIn(res.user);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Sign-in failed');
          } finally {
            setVerifying(false);
          }
        },
      });

      buttonContainerRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(buttonContainerRef.current, {
        theme: 'filled_blue',
        size: 'large',
        shape: 'pill',
        width: 280,
        text: 'signin_with',
      });
    };

    if (window.google?.accounts?.id) {
      initGoogleButton();
    } else {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[src="https://accounts.google.com/gsi/client"]'
      );
      if (existingScript) {
        existingScript.addEventListener('load', initGoogleButton);
      } else {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = initGoogleButton;
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [googleClientId, onSignedIn]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-sky-950 to-teal-950 p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-white/15 max-w-md w-full p-8 text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center mx-auto text-teal-600 shadow-xs">
          <Fish className="w-9 h-9" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1 rounded-full">
            <Waves className="w-3.5 h-3.5" /> Truckee &amp; Sierra Fly Log
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">Sign in to RiverBeat</h1>
          <p className="text-sm text-slate-500">
            Personal fly-fishing journal, river beats, and USGS stream gauge tracker.
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium text-left">
            {error}
          </div>
        )}

        <div className="flex flex-col items-center justify-center min-h-[52px]">
          {verifying ? (
            <p className="text-sm font-medium text-slate-600 animate-pulse">
              Verifying Google account...
            </p>
          ) : (
            <div ref={buttonContainerRef} className="flex justify-center" />
          )}
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <Lock className="w-3.5 h-3.5" />
          <span>Protected by Google Identity Services</span>
        </div>
      </div>
    </div>
  );
};
