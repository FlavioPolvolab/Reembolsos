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
      console.log('🔄 Verificando e renovando conexão...');

      await new Promise(resolve => setTimeout(resolve, 300));

      try {
        await supabase.auth.refreshSession();
      } catch (e: any) {
        console.warn('Refresh de sessão falhou, continuando:', e?.message);
      }

      const connected = await checkConnection();

      if (connected) {
        setIsConnected(true);
        setConnectionError(null);
        console.log('✅ Conexão restaurada com sucesso');
      } else {
        setIsConnected(false);
        setConnectionError('Conexão perdida. Tente recarregar a página.');
        console.warn('❌ Falha ao restaurar conexão');
      }
    } catch (err) {
      console.error('Erro ao renovar conexão:', err);
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
        if (now - lastVisibilityChangeRef.current < 5000) {
          console.log('Ignorando mudança de visibilidade (muito recente)');
          return;
        }

        lastVisibilityChangeRef.current = now;

        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }

        refreshTimeoutRef.current = setTimeout(async () => {
          console.log('👁️ Página recebeu foco, verificando conexão...');
          await refreshConnection();
        }, 1000);
      }
      
      // Se a página ficou oculta, marcar como potencialmente desconectada
      if (!isNowVisible && wasVisible) {
        console.log('👁️ Página perdeu foco, conexão pode ser afetada');
        // Não marcar como desconectada imediatamente, apenas avisar
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

  // Monitorar mudanças na sessão do Supabase
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(`[Auth State Change] Event: ${event}`, session ? 'Sessão válida' : 'Sessão inválida');
      
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        setIsConnected(!!session);
        if (!session) {
          setConnectionError('Sessão expirada. Faça login novamente.');
        } else {
          setConnectionError(null);
        }
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
