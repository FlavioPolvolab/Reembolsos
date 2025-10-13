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
      console.warn('Submit já em andamento, ignorando nova tentativa');
      return null;
    }

    setIsSubmitting(true);
    setError(null);

    // Cancelar operação anterior se existir
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Criar novo AbortController para esta operação
    abortControllerRef.current = new AbortController();

    try {
      console.log('🚀 Iniciando envio direto...');

      // Verificar se a operação foi cancelada
      if (abortControllerRef.current?.signal.aborted) {
        console.log('Operação cancelada pelo usuário');
        return null;
      }

      // Executar a função de submit diretamente sem retry
      console.log('📤 Executando submitFn...');
      const result = await submitFn();
      console.log('📥 submitFn resolvido');

      console.log('✅ Sucesso no envio');
      onSuccess?.();
      return result;

    } catch (err: any) {
      console.error('❌ Erro no envio:', err?.message || err);

      const errorMessage = err?.message || 'Erro desconhecido';
      setError(errorMessage);
      onError?.(err);

      return null;
    } finally {
      setIsSubmitting(false);
    }
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
