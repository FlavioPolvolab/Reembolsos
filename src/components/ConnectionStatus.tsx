import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Wifi, WifiOff, Loader2, RefreshCw } from 'lucide-react';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';

const ConnectionStatus: React.FC = () => {
  const { isOnline, isConnected, isReconnecting, reconnect } = useConnectionStatus();

  // Só mostrar se houver problema real de conexão
  if (isOnline && isConnected && !isReconnecting) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm">
      <Alert variant={!isOnline || !isConnected ? "destructive" : "default"}>
        <div className="flex items-center gap-2">
          {!isOnline ? (
            <WifiOff className="h-4 w-4" />
          ) : isReconnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wifi className="h-4 w-4" />
          )}
          
          <div className="flex-1">
            <AlertDescription>
              {!isOnline ? (
                "Você está offline"
              ) : isReconnecting ? (
                "Reconectando..."
              ) : !isConnected ? (
                "Conexão perdida"
              ) : (
                "Reconectando..."
              )}
            </AlertDescription>
          </div>

          {isOnline && !isConnected && !isReconnecting && (
            <Button
              size="sm"
              variant="outline"
              onClick={reconnect}
              className="ml-2"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Reconectar
            </Button>
          )}
        </div>
      </Alert>
    </div>
  );
};

export default ConnectionStatus;