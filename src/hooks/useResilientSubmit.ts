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

    let lastError: any = null;

    try {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`🔄 Tentativa ${attempt}/${maxRetries} de envio...`);

          // Se a aba estiver oculta, aguardar voltar a ficar visível para evitar throttling do navegador
          if (typeof document !== 'undefined' && document.hidden) {
            console.log('⏸️ Aba oculta: aguardando visibilidade para enviar...');
            await new Promise<void>((resolve, reject) => {
              const maxWait = setTimeout(() => {
                document.removeEventListener('visibilitychange', onVisible);
                reject(new Error('PAGE_HIDDEN_TOO_LONG'));
              }, 45000);
              const onVisible = () => {
                if (!document.hidden) {
                  clearTimeout(maxWait);
                  document.removeEventListener('visibilitychange', onVisible);
                  resolve();
                }
              };
              document.addEventListener('visibilitychange', onVisible);
            });
          }

          // Verificar se a operação foi cancelada
          if (abortControllerRef.current?.signal.aborted) {
            console.log('Operação cancelada pelo usuário');
            return null;
          }

          // Verificar sessão antes de cada tentativa
          if (attempt === 1) {
            console.log('🔐 Verificando sessão antes do envio...');
            try {
              const { data: { session }, error: sessionError } = await supabase.auth.getSession();
              if (sessionError || !session) {
                throw new Error('Sessão inválida. Faça login novamente.');
              }
              console.log('🔐 Sessão válida.');
            } catch (e: any) {
              console.warn('⚠️ Erro ao verificar sessão:', e?.message || e);
              throw new Error('Sessão inválida. Faça login novamente.');
            }
          }

          // Executar a função de submit com timeout
          const timeoutPromise = new Promise<never>((_, reject) => {
            const timeoutId = setTimeout(() => {
              reject(new Error(`Timeout: Operação demorou mais de ${timeoutMs}ms`));
            }, timeoutMs);
            
            // Limpar timeout se a operação for cancelada
            abortControllerRef.current?.signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
            });
          });

          console.log('📤 Executando submitFn com proteção de timeout...');
          const result = await Promise.race([
            (async () => {
              const r = await submitFn();
              console.log('📥 submitFn resolvido');
              return r;
            })(),
            timeoutPromise
          ]);

          console.log(`✅ Sucesso na tentativa ${attempt}`);
          onSuccess?.();
          return result;

        } catch (err: any) {
          lastError = err;
          console.error(`❌ Erro na tentativa ${attempt}:`, err?.message || err);

          // Se não é a última tentativa, aguardar antes de tentar novamente
          if (attempt < maxRetries) {
            console.log(`⏳ Aguardando ${retryDelay}ms antes da próxima tentativa...`);
            onRetry?.(attempt, err);
            
            // Aguardar com possibilidade de cancelamento
            await new Promise(resolve => {
              const timeoutId = setTimeout(resolve, retryDelay);
              abortControllerRef.current?.signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
              });
            });

            // Verificar se foi cancelado durante a espera
            if (abortControllerRef.current?.signal.aborted) {
              console.log('Operação cancelada durante retry');
              return null;
            }
          }
        }
      }

      // Se chegou aqui, todas as tentativas falharam
      const errorMessage = lastError?.message || 'Erro desconhecido';
      console.error(`❌ Todas as ${maxRetries} tentativas falharam:`, errorMessage);
      
      setError(errorMessage);
      onError?.(lastError);
      
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, maxRetries, retryDelay, timeoutMs, onRetry, onSuccess, onError]);

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
