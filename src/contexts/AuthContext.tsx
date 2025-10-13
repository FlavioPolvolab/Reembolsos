import React, { createContext, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type UserRole = "submitter" | "approver" | "rejector" | "deleter";

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: any | null;
  isLoading: boolean;
  isAdmin: boolean;
  userRoles: UserRole[];
  hasRole: (role: UserRole) => boolean;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{
    error: any | null;
    data: any | null;
  }>;
  signUp: (
    email: string,
    password: string,
    name: string,
    role: string
  ) => Promise<{
    error: any | null;
    data: any | null;
  }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);

  const isFetchingRef = React.useRef(false);
  const lastFetchTimeRef = React.useRef<number>(0);
  const fetchCountRef = React.useRef<number>(0);

  useEffect(() => {
    let initialLoadDone = false;
    let lastEventTime = 0;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserProfile(session.user.id);
      } else {
        setIsLoading(false);
      }
      initialLoadDone = true;
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const now = Date.now();

      if (!initialLoadDone) {
        return;
      }

      if (now - lastEventTime < 1000) {
        console.log('[AuthContext] Ignorando evento muito próximo:', event);
        return;
      }

      lastEventTime = now;

      if (event === 'INITIAL_SESSION') {
        return;
      }

      if (event === 'SIGNED_IN') {
        console.log('[AuthContext] SIGNED_IN - atualizando sessão sem recarregar perfil');
        setSession(session);
        setUser(session?.user ?? null);
        return;
      }

      console.log(`[AuthContext] Evento de auth: ${event}`);

      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        await fetchUserProfile(session.user.id);
      } else {
        setProfile(null);
        setIsAdmin(false);
        setUserRoles([]);
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchUserProfile = async (userId: string) => {
    const now = Date.now();

    if (isFetchingRef.current) {
      console.log('[AuthContext] Fetch já em andamento, ignorando');
      return;
    }

    if (now - lastFetchTimeRef.current < 2000) {
      console.log('[AuthContext] Fetch muito recente, ignorando');
      return;
    }

    fetchCountRef.current++;
    if (fetchCountRef.current > 10) {
      console.error('[AuthContext] Circuit breaker ativado! Muitas tentativas de fetch.');
      setTimeout(() => {
        fetchCountRef.current = 0;
      }, 30000);
      return;
    }

    isFetchingRef.current = true;
    lastFetchTimeRef.current = now;
    setIsLoading(true);

    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("Erro ao buscar perfil do usuário:", error);

        // Tenta criar o perfil do usuário se não existir
        if (error.code === "PGRST116") {
          // Código para "não encontrado"
          const userData = await supabase.auth.getUser();
          if (userData.data?.user) {
            const { error: insertError } = await supabase.from("users").insert([
              {
                id: userId,
                name:
                  userData.data.user.user_metadata?.name ||
                  userData.data.user.email,
                email: userData.data.user.email,
                role: "user",
              },
            ]);

            if (!insertError) {
              // Tenta buscar o perfil novamente
              const { data: newData } = await supabase
                .from("users")
                .select("*")
                .eq("id", userId)
                .single();

              if (newData) {
                setProfile(newData);
                setIsAdmin(newData?.role === "admin");
                setUserRoles(newData?.role ? [newData.role as UserRole] : []);
                setIsLoading(false);
                return;
              }
            }
          }
        }

        setProfile(null);
        setIsAdmin(false);
        setUserRoles([]);
      } else {
        console.log("Perfil de usuário carregado:", data);
        // Corrigir para aceitar tanto roles (array) quanto role (string)
        const roles = data?.roles || (data?.role ? [data.role] : []);
        setProfile(data);
        setIsAdmin(data?.role === "admin" || (Array.isArray(data?.roles) && data.roles.includes("admin")));
        setUserRoles((data?.roles || (data?.role ? [data.role] : [])) as UserRole[]);
      }
    } catch (error) {
      console.error("Erro ao buscar perfil do usuário:", error);
      setProfile(null);
      setIsAdmin(false);
      setUserRoles([]);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;

      setTimeout(() => {
        if (fetchCountRef.current > 0) {
          fetchCountRef.current--;
        }
      }, 5000);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const signUp = async (email: string, password: string, name: string, role: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
          },
        },
      });

      if (error) {
        return { data: null, error };
      }

      // Verificar se o perfil do usuário foi criado pelo trigger
      if (data?.user) {
        // Esperar um momento para o trigger executar
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verificar se o perfil foi criado
        const { data: profileData, error: profileError } = await supabase
          .from("users")
          .select("*")
          .eq("id", data.user.id)
          .single();

        // Se não encontrou o perfil, criar manualmente
        if (profileError) {
          const { error: insertError } = await supabase.from("users").insert([
            {
              id: data.user.id,
              name,
              email,
              roles: [role],
            },
          ]);

          if (insertError) {
            console.error(
              "Erro ao criar perfil de usuário manualmente:",
              insertError,
            );
          }
        } else {
          // Se o perfil já existe, atualiza o campo roles
          await supabase.from("users").update({ roles: [role] } as any).eq("id", data.user.id);
        }
      }

      return { data, error: null };
    } catch (err) {
      console.error("Erro ao registrar usuário:", err);
      return { data: null, error: err };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setIsAdmin(false);
    setUserRoles([]);
    setIsLoading(false);
  };

  // Função para verificar se o usuário tem um papel específico
  const hasRole = (role: UserRole): boolean => {
    if (isAdmin) return true; // Administradores têm todos os papéis
    return userRoles.includes(role);
  };

  const value = {
    session,
    user,
    profile,
    isLoading,
    isAdmin,
    userRoles,
    hasRole,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  }
  return context;
};
