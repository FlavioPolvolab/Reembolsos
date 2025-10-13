import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { useResilientSubmit } from "@/hooks/useResilientSubmit";

interface NovoPedidoProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const NovoPedido: React.FC<NovoPedidoProps> = ({ open, onOpenChange, onSuccess }) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const { user } = useAuth();
  const [items, setItems] = useState<{ name: string; quantity: number; price: string }[]>([]);
  const [itemName, setItemName] = useState("");
  const [itemQty, setItemQty] = useState(1);
  const [itemPrice, setItemPrice] = useState("");

  // Hooks para gerenciar visibilidade e submissão resiliente
  const { isVisible, isConnected, isRefreshing, connectionError, refreshConnection } = usePageVisibility();
  const { isSubmitting, error, submitWithRetry, clearError, cancelSubmit } = useResilientSubmit({
    maxRetries: 3,
    retryDelay: 2000,
    // Deixa o timeout externo bem alto; gerenciamos timeouts internos por operação
    timeoutMs: 120000,
    onRetry: (attempt, error) => {
      console.log(`🔄 Tentativa ${attempt} falhou:`, error.message);
    },
    onSuccess: () => {
      console.log('✅ Pedido criado com sucesso!');
    },
    onError: (error) => {
      console.error('❌ Todas as tentativas falharam:', error);
    }
  });

  // Guarda o payload do submit atual para poder enfileirar se a aba ficar oculta
  const pendingPayloadRef = useRef<any>(null);
  const hasQueuedRef = useRef<boolean>(false);

  // Limpar erros quando o modal abre
  useEffect(() => {
    if (open) {
      clearError();
    }
  }, [open, clearError]);

  // Cancelar submissão se a aba ficar oculta
  useEffect(() => {
    if (!isVisible && isSubmitting) {
      cancelSubmit();
    }
  }, [isVisible, isSubmitting, cancelSubmit]);

  // Auto-envio de pedidos pendentes ao voltar o foco
  useEffect(() => {
    const trySendPending = async () => {
      if (document.hidden) return;
      try {
        const raw = localStorage.getItem('pending_purchase_order');
        if (!raw) return;
        const pending = JSON.parse(raw);
        localStorage.removeItem('pending_purchase_order');
        console.log('⏫ Enviando pedido pendente ao voltar o foco...');
        const { data: fnData, error: fnError } = await (supabase as any).functions.invoke('create_purchase_order', {
          body: pending
        });
        if (fnError) throw fnError;
        if (fnData?.order?.id) {
          console.log('✅ Pedido pendente enviado:', fnData.order.id);
        }
      } catch (e) {
        console.warn('⚠️ Falha ao enviar pendente:', (e as any)?.message || e);
      }
    };
    const onVisibility = () => { if (!document.hidden) void trySendPending(); };
    const onFocus = () => { void trySendPending(); };
    const intervalId = window.setInterval(() => { void trySendPending(); }, 3000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(intervalId);
    };
  }, []);

  // Se a aba ficar oculta durante um envio, enfileira automaticamente o payload atual
  useEffect(() => {
    const onHidden = async () => {
      if (document.hidden && isSubmitting && pendingPayloadRef.current && !hasQueuedRef.current) {
        try {
          const { data: sess } = await supabase.auth.getSession();
          const access_token = (sess as any)?.session?.access_token;
          localStorage.setItem('pending_purchase_order', JSON.stringify({ ...pendingPayloadRef.current, access_token }));
          hasQueuedRef.current = true;
          console.log('💾 Pedido atual armazenado porque a aba ficou oculta.');
        } catch {}
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [isSubmitting]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleRemoveFile = (idx: number) => {
    setFiles(files.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;

    // Se a aba estiver oculta, preferimos rotas que funcionam em background (Edge/sendBeacon)

    // Validações básicas
    if (!user) {
      alert("Usuário não autenticado");
      return;
    }
    
    if (items.length === 0) {
      alert("Adicione pelo menos um item ao pedido");
      return;
    }

    if (!isConnected) {
      alert("Conexão perdida. Aguarde a reconexão ou recarregue a página.");
      return;
    }

    console.log("🚀 Iniciando criação do pedido...");

    const result = await submitWithRetry(async () => {
      // Preflight muito rápido para garantir que o PostgREST esteja "acordado"
      try {
        await Promise.race([
          supabase.from("purchase_orders").select("id", { head: true, count: "exact" }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("PREFLIGHT_TIMEOUT")), 3000))
        ]);
      } catch (e) {
        console.warn("⚠️ Preflight falhou/demorou, prosseguindo mesmo assim...", (e as any)?.message || e);
      }
      // 1. Criar pedido
      const total = items.reduce((sum, item) => {
        const preco = Number(item.price);
        return sum + (isNaN(preco) ? 0 : preco * item.quantity);
      }, 0);

      console.log("📝 Criando pedido com total:", total);

      // Primeiro, tente via Edge Function (1 chamada transacional)
      try {
        const invokePayload = {
          title,
          description,
          user_id: user.id,
          items: items.map(it => ({ name: it.name, quantity: it.quantity, price: Number(it.price) }))
        };
        pendingPayloadRef.current = invokePayload;
        hasQueuedRef.current = false;

        // Helper para enfileirar
        const queuePending = async () => {
          const { data: sess } = await supabase.auth.getSession();
          const access_token = (sess as any)?.session?.access_token;
          localStorage.setItem('pending_purchase_order', JSON.stringify({ ...invokePayload, access_token }));
          console.log('💾 Pedido armazenado para envio quando a aba voltar.');
          return { id: 'queued' } as any;
        };

        // Se a aba estiver oculta, persistir para envio automático quando voltar ao foco
        if (typeof document !== 'undefined' && document.hidden) {
          return await queuePending();
        }

        const { data: fnData, error: fnError } = await (supabase as any).functions.invoke('create_purchase_order', {
          body: invokePayload
        });

        if (fnError) {
          // Se falhou e a aba está oculta ou houve timeout/rede, enfileira para envio automático
          if (typeof document !== 'undefined' && document.hidden) {
            return await queuePending();
          }
          const msg = String(fnError?.message || '').toLowerCase();
          if (msg.includes('timeout') || msg.includes('fetch') || msg.includes('network')) {
            return await queuePending();
          }
          throw fnError;
        }
        pendingPayloadRef.current = null;
        if (fnData?.order?.id) {
          return fnData.order;
        }
      } catch (edgeErr: any) {
        console.warn('⚠️ Edge function falhou, caindo para insert direto:', edgeErr?.message || edgeErr);
        // Gatilho final de fila se falhou por qualquer motivo
        if (pendingPayloadRef.current && !hasQueuedRef.current) {
          try {
            const { data: sess } = await supabase.auth.getSession();
            const access_token = (sess as any)?.session?.access_token;
            localStorage.setItem('pending_purchase_order', JSON.stringify({ ...pendingPayloadRef.current, access_token }));
            hasQueuedRef.current = true;
            console.log('💾 Pedido armazenado após erro de envio.');
          } catch {}
        }
      }

      // Função fallback com fetch nativo (keepalive) para contornar throttling
      const createOrderDirect = async () => {
        const { data: sess } = await supabase.auth.getSession();
        const token = (sess as any)?.session?.access_token;
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/purchase_orders`;
        const body = [{ title, description, total_amount: total, user_id: user.id }];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort('NATIVE_FETCH_TIMEOUT'), 20000);
        console.log('➡️ Enviando fetch nativo (keepalive) para', url, 'payload:', body);
        const res = await fetch(url, {
          method: 'POST',
          mode: 'cors',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(body),
          keepalive: true,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.message || res.statusText);
        }
        return json?.[0];
      };

      let data: any = null;
      // Timeout curto para o insert via SDK. Se estourar, cai no fallback keepalive
      const sdkInsert = supabase
        .from("purchase_orders")
        .insert({
          title,
          description,
          total_amount: total,
          user_id: user.id,
        })
        .select()
        .single();

      const insertWithTimeout = Promise.race([
        sdkInsert,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('INSERT_TIMEOUT')), 15000)),
      ]);

      try {
        const res: any = await insertWithTimeout;
        data = res?.data ?? res; // res é do SDK ({data,error}) quando não estoura
        if (res?.error) throw res.error;
      } catch (err: any) {
        if ((err?.message || '') === 'INSERT_TIMEOUT') {
          console.warn('⏩ Fallback para fetch nativo (keepalive)');
          data = await createOrderDirect();
        } else {
          throw err;
        }
      }

      if (!data) {
        throw new Error("Pedido não foi criado. Verifique suas permissões.");
      }

      console.log("✅ Pedido criado:", data.id);

      // 2. Salvar itens
      console.log("📦 Salvando", items.length, "itens...");

      for (const item of items) {
        const { error: itemError } = await supabase
          .from("purchase_order_items")
          .insert({
            purchase_order_id: data.id,
            name: item.name,
            quantity: item.quantity,
            unit_price: parseFloat(item.price),
          });

        if (itemError) {
          console.error("❌ Erro ao inserir item:", itemError);
          throw new Error(`Erro ao salvar item ${item.name}: ${itemError.message}`);
        }
      }

      console.log("✅ Todos os itens salvos");

      // 3. Upload dos arquivos
      if (files.length > 0) {
        console.log("📎 Fazendo upload de", files.length, "arquivos...");

        for (const file of files) {
          const fileName = `${data.id}/${Date.now()}_${file.name}`;
          const filePath = `${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from("receipts")
            .upload(filePath, file);

          if (uploadError) {
            console.error("❌ Erro no upload:", uploadError);
            throw new Error(`Erro ao fazer upload de ${file.name}: ${uploadError.message}`);
          }

          const { error: dbError } = await supabase
            .from("purchase_order_receipts")
            .insert({
              purchase_order_id: data.id,
              file_name: file.name,
              file_type: file.type,
              file_size: file.size,
              storage_path: filePath,
            });

          if (dbError) {
            console.error("❌ Erro ao registrar comprovante:", dbError);
            throw new Error(`Erro ao registrar comprovante ${file.name}: ${dbError.message}`);
          }
        }

        console.log("✅ Todos os arquivos enviados");
      }

      return data;
    });

    if (result) {
      console.log("🎉 Pedido criado com sucesso!");
      
      // Limpar formulário
      setTitle("");
      setDescription("");
      setItems([]);
      setFiles([]);
      
      if (onSuccess) onSuccess();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-full p-8 sm:rounded-xl">
        <DialogHeader>
          <DialogTitle>Novo Pedido de Compra</DialogTitle>
          <DialogDescription>Preencha os campos abaixo para criar um novo pedido de compra.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Título</label>
            <input
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition placeholder-gray-400 bg-white"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              placeholder="Ex: Compra de materiais de escritório"
            />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Descrição</label>
            <textarea
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition placeholder-gray-400 bg-white min-h-[80px] resize-none"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Detalhe o motivo ou itens do pedido"
            />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Itens do Pedido</label>
            <div className="flex gap-2 mb-2 flex-wrap">
              <input
                className="border border-gray-300 rounded-md px-2 py-1 w-1/2 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition placeholder-gray-400 bg-white"
                placeholder="Nome do item"
                value={itemName}
                onChange={e => setItemName(e.target.value)}
              />
              <input
                className="border border-gray-300 rounded-md px-2 py-1 w-16 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition bg-white"
                type="number"
                min="1"
                value={itemQty}
                onChange={e => setItemQty(Number(e.target.value))}
                placeholder="Qtd"
              />
              <input
                className="border border-gray-300 rounded-md px-2 py-1 w-24 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition bg-white"
                type="number"
                min="0"
                step="0.01"
                value={itemPrice}
                onChange={e => setItemPrice(e.target.value)}
                placeholder="Preço"
              />
              <Button type="button" size="sm" className="bg-primary text-white rounded-md px-4 py-2 font-semibold hover:bg-primary/90 transition" onClick={() => {
                const precoNum = Number(itemPrice);
                if (itemName && !isNaN(precoNum) && precoNum > 0) {
                  setItems([...items, { name: itemName, quantity: itemQty, price: precoNum.toString() }]);
                  setItemName("");
                  setItemQty(1);
                  setItemPrice("");
                }
              }}>Adicionar</Button>
            </div>
            {items.length > 0 ? (
              <ul className="mb-2 divide-y divide-gray-100 bg-gray-50 rounded-md p-2">
                {items.map((item, idx) => (
                  <li key={idx} className="flex gap-2 items-center text-sm py-1">
                    <span className="w-1/2 truncate text-gray-800">{item.name}</span>
                    <span className="w-12 text-center text-gray-600">{item.quantity}</span>
                    <span className="w-20 text-right text-gray-700">R$ {parseFloat(item.price).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                    <Button type="button" size="sm" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => setItems(items.filter((_, i) => i !== idx))}>Remover</Button>
                  </li>
                ))}
              </ul>
            ) : <div className="text-gray-400 text-sm">Nenhum item adicionado.</div>}
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Comprovantes <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-white hover:file:bg-primary/90"
            />
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((file, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="truncate max-w-[70%]">{file.name}</span>
                    <Button type="button" size="sm" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => handleRemoveFile(idx)} disabled={isSubmitting}>
                      Remover
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {isRefreshing && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800">
              <strong>🔄 Atualizando conexão...</strong>
              <p className="mt-1">Aguarde alguns instantes enquanto sincronizamos sua conexão.</p>
            </div>
          )}
          {!isConnected && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
              <strong>⚠️ Conexão perdida:</strong> {connectionError || "Aguarde a reconexão ou recarregue a página."}
              <button 
                type="button"
                onClick={refreshConnection}
                className="ml-2 text-blue-600 hover:text-blue-800 underline"
                disabled={isRefreshing}
              >
                Tentar reconectar
              </button>
            </div>
          )}
          {isSubmitting && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800 animate-pulse">
              <strong>Processando...</strong>
              <p className="mt-1">Aguarde enquanto criamos seu pedido.</p>
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">
              <strong>❌ Erro:</strong> {error}
              <button 
                type="button"
                onClick={clearError}
                className="ml-2 text-red-600 hover:text-red-800 underline"
              >
                Fechar
              </button>
            </div>
          )}
          <DialogFooter className="flex flex-col gap-2">
            <Button 
              type="submit" 
              className="w-full h-12 text-lg bg-primary text-white font-bold rounded-md hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed" 
              disabled={isSubmitting || !isConnected || isRefreshing || !isVisible}
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Salvando...
                </div>
              ) : isRefreshing ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Reconectando...
                </div>
              ) : !isConnected ? (
                "Conexão perdida"
              ) : (
                "Salvar Pedido"
              )}
            </Button>
            <Button 
              type="button" 
              variant="outline" 
              className="w-full h-12 text-lg border-gray-300 font-bold rounded-md" 
              onClick={() => onOpenChange(false)} 
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NovoPedido; 