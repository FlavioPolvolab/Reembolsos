import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

interface ResilientSubmitOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeoutMs?: number;
  onRetry?: (attempt: number, error: any) => void;
  onSuccess?: () => void;
  onError?: (error: any) => void;
}

interface ResilientSubmitReturn<T> {
  isSubmitting: boolean;
  error: string | null;
  submitWithRetry: (submitFn: () => Promise<T>) => Promise<T | null>;
  clearError: () => void;
  cancelSubmit: () => void;
}

export function useResilientSubmit<T = any>(options: ResilientSubmitOptions = {}): ResilientSubmitReturn<T> {
  const {
    maxRetries = 3,
    retryDelay = 2000,
    timeoutMs = 45000,
    onRetry,
    onSuccess,
    onError
  } = options;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const submitWithRetry = useCallback(async (submitFn: () => Promise<T>): Promise<T | null> => {
    if (isSubmitting) {
      console.warn('[useResilientSubmit] Submit já em andamento, ignorando');
      return null;
    }

    setIsSubmitting(true);
    setError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    let lastError: any = null;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`[useResilientSubmit] Tentativa ${attempts}/${maxAttempts}`);

        if (abortControllerRef.current?.signal.aborted) {
          console.log('[useResilientSubmit] Operação cancelada');
          return null;
        }

        const result = await submitFn();
        console.log('[useResilientSubmit] ✅ Sucesso no envio');
        onSuccess?.();
        return result;

      } catch (err: any) {
        lastError = err;
        console.error(`[useResilientSubmit] ❌ Erro na tentativa ${attempts}:`, err?.message || err);

        if (attempts < maxAttempts) {
          const isSessionError = err?.message?.includes('sessão') ||
                                 err?.message?.includes('Sessão') ||
                                 err?.message?.includes('token');

          if (isSessionError) {
            console.log('[useResilientSubmit] Erro de sessão detectado, aguardando antes de retry...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            break;
          }
        }
      }
    }

    const errorMessage = lastError?.message || 'Erro desconhecido ao criar pedido';
    setError(errorMessage);
    onError?.(lastError);
    setIsSubmitting(false);
    return null;

  }, [isSubmitting, onSuccess, onError]);

  const cancelSubmit = useCallback(() => {
    if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
      abortControllerRef.current.abort();
    }
    setIsSubmitting(false);
  }, []);

  // Cleanup ao desmontar
  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    isSubmitting,
    error,
    submitWithRetry,
    clearError,
    cancelSubmit
  };
}
