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
      
      // Preflight rápido (HEAD) para acordar o PostgREST sem custo
      const { error: testError } = await supabase
        .from('purchase_orders')
        .select('id', { head: true, count: 'exact' });
      
      if (testError) {
        console.warn('Erro de conectividade detectado:', testError);
        return false;
      }
      
      return true;
    } catch (err) {
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
      
      // Aguardar um pouco para estabilizar
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Forçar refresh do token antes do preflight
      try {
        await supabase.auth.refreshSession();
      } catch (_) {}
      
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
      
      // Se a página ficou visível após estar oculta
      if (isNowVisible && !wasVisible) {
        // Evitar múltiplas verificações em sequência
        if (now - lastVisibilityChangeRef.current < 2000) {
          console.log('Ignorando mudança de visibilidade (muito recente)');
          return;
        }
        
        lastVisibilityChangeRef.current = now;
        
        // Limpar timeout anterior se existir
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
        
        // Aguardar um pouco antes de verificar a conexão
        refreshTimeoutRef.current = setTimeout(async () => {
          console.log('👁️ Página recebeu foco, verificando conexão...');
          await refreshConnection();
        }, 1500);
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
