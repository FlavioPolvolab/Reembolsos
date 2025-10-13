import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface UsePageVisibilityReturn {
  isVisible: boolean;
  isConnected: boolean;
  isRefreshing: boolean;
  connectionError: string | null;
  refreshConnection: () => Promise<void>;
}

export function usePageVisibility(): UsePageVisibilityReturn {
  const [isVisible, setIsVisible] = useState(!document.hidden);
  const [isConnected, setIsConnected] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  const lastVisibilityChangeRef = useRef<number>(0);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);

  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        console.warn('Sessão inválida detectada:', error);
        return false;
      }

      return true;
    } catch (err: any) {
      console.error('Erro ao verificar conexão:', err);
      return false;
    }
  }, []);

  const refreshConnection = useCallback(async (): Promise<void> => {
    if (isProcessingRef.current) return;

    isProcessingRef.current = true;
    setIsRefreshing(true);
    setConnectionError(null);

    try {
      console.log('🔄 Verificando conexão...');

      await new Promise(resolve => setTimeout(resolve, 300));

      const connected = await checkConnection();

      if (connected) {
        setIsConnected(true);
        setConnectionError(null);
        console.log('✅ Conexão verificada com sucesso');
      } else {
        setIsConnected(false);
        setConnectionError('Conexão perdida. Tente recarregar a página.');
        console.warn('❌ Falha na verificação de conexão');
      }
    } catch (err) {
      console.error('Erro ao verificar conexão:', err);
      setIsConnected(false);
      setConnectionError('Erro ao verificar conexão. Tente recarregar a página.');
    } finally {
      setIsRefreshing(false);
      isProcessingRef.current = false;
    }
  }, [checkConnection]);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      const now = Date.now();
      const wasVisible = isVisible;
      const isNowVisible = !document.hidden;

      setIsVisible(isNowVisible);

      if (isNowVisible && !wasVisible) {
        if (now - lastVisibilityChangeRef.current < 10000) {
          console.log('[usePageVisibility] Mudança de visibilidade ignorada (muito recente)');
          return;
        }

        lastVisibilityChangeRef.current = now;

        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }

        refreshTimeoutRef.current = setTimeout(async () => {
          console.log('[usePageVisibility] Verificando conexão após retorno de foco');
          await refreshConnection();
        }, 2000);
      }

      if (!isNowVisible && wasVisible) {
        console.log('[usePageVisibility] Página perdeu foco');
      }
    };

    // Verificar conexão inicial
    const checkInitialConnection = async () => {
      const connected = await checkConnection();
      setIsConnected(connected);
      if (!connected) {
        setConnectionError('Conexão inicial falhou. Verifique sua internet.');
      }
    };

    checkInitialConnection();
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [isVisible, refreshConnection, checkConnection]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setIsConnected(false);
        setConnectionError('Sessão expirada. Faça login novamente.');
      } else if (event === 'TOKEN_REFRESHED' && session) {
        setIsConnected(true);
        setConnectionError(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return {
    isVisible,
    isConnected,
    isRefreshing,
    connectionError,
    refreshConnection
  };
}
