import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import {
  PlusCircle,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  LogOut,
  RefreshCw,
} from "lucide-react";
import ExpenseTable from "./ExpenseTable";
import FilterBar from "./FilterBar";
import ExpenseForm from "@/components/ExpenseForm";
import ExpenseDetail from "./ExpenseDetail";
import { fetchExpenses, fetchExpensesTest, testExpensesView, approveExpense, rejectExpense, updateExpense, deleteExpense } from "@/services/expenseService";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import UserRegisterTab from "@/components/admin/UserRegisterTab";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";

const Home = () => {
  const [activeTab, setActiveTab] = useState("pending");
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showExpenseDetail, setShowExpenseDetail] = useState(false);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [filters, setFilters] = useState<{
    search: string;
    status?: string;
    category?: string;
    costCenter?: string;
    dateRange?: { from: Date | undefined; to: Date | undefined };
  }>({ search: "" });
  const { toast } = useToast();
  const { isAdmin, user, signOut, hasRole } = useAuth();
  const navigate = useNavigate();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const loadExpenses = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      // Recarregar perfil do usuário primeiro
      if (user) {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          const { data: profileData } = await supabase
            .from("users")
            .select("*")
            .eq("id", currentUser.id)
            .single();
          console.log("Perfil recarregado:", profileData);
        }
      }
      
      // Verificar dados das tabelas relacionadas
      const { data: categories } = await supabase.from("categories").select("*");
      const { data: costCenters } = await supabase.from("cost_centers").select("*");
      console.log("Categorias disponíveis:", categories);
      console.log("Centros de custo disponíveis:", costCenters);
      
      // Testar ambas as abordagens
      const dataView = await fetchExpenses(filters);
      const dataTest = await fetchExpensesTest(filters);
      const dataRPC = await testExpensesView();
      
      console.log("Dados da view:", dataView);
      console.log("Dados do teste (query direta):", dataTest);
      console.log("Dados da função RPC:", dataRPC);
      
      // Usar os dados da view por enquanto
      const data = dataView;
      console.log("Dados brutos da view:", data);
      const formattedData = (data || []).map((expense: any) => {
        const formatted = {
          id: expense.id,
          user_id: expense.user_id,
          name: expense.user_name || "Desconhecido",
          description: expense.description,
          amount: expense.amount,
          status: expense.status,
          payment_status: expense.payment_status || "pending",
          date: expense.submitted_date,
          purpose: expense.purpose,
          costCenter: expense.cost_center_name || "",
          category: expense.category_name || "",
          paymentDate: expense.payment_date,
        };
        console.log("Expense formatada:", formatted);
        return formatted;
      });
      setExpenses(formattedData);
    } catch (error: any) {
      setLoadError(error);
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      // Recarregar perfil do usuário
      if (user) {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          const { data: profileData } = await supabase
            .from("users")
            .select("*")
            .eq("id", currentUser.id)
            .single();
          console.log("Perfil recarregado no refresh:", profileData);
        }
      }
      
      // Recarregar dados
      await loadExpenses();
      toast({
        title: "Sucesso",
        description: "Dados atualizados com sucesso!",
      });
    } catch (error) {
      console.error("Erro no refresh:", error);
      toast({
        title: "Erro",
        description: "Erro ao atualizar dados",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [loadExpenses, toast]);

  const handleViewDetails = (expense) => {
    setSelectedExpenseId(expense.id);
    setShowExpenseDetail(true);
  };

  const handleCreateExpense = () => {
    setShowExpenseForm(true);
  };

  const handleCloseForm = () => {
    setShowExpenseForm(false);
    loadExpenses();
  };

  const handleCloseDetail = () => {
    setShowExpenseDetail(false);
    setSelectedExpenseId(null);
    loadExpenses();
  };

  const handleApprove = async (expense) => {
    // Esta função não é usada diretamente aqui, mas é passada para o ExpenseTable
    // A aprovação real acontece no componente ExpenseDetail
  };

  const handleReject = async (expense) => {
    // Esta função não é usada diretamente aqui, mas é passada para o ExpenseTable
    // A rejeição real acontece no componente ExpenseDetail
  };

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
  };

  const handleStatusChange = () => {
    loadExpenses();
  };

  const handleDelete = async (expense) => {
    if (!window.confirm("Tem certeza que deseja excluir esta despesa? Esta ação não pode ser desfeita.")) return;
    try {
      await deleteExpense(expense.id);
      toast({
        title: "Sucesso",
        description: "Despesa excluída com sucesso!",
      });
      loadExpenses();
    } catch (error) {
      toast({
        title: "Erro",
        description: "Não foi possível excluir a despesa.",
        variant: "destructive",
      });
    }
  };

  const handleMarkPaid = async (expense) => {
    try {
      await updateExpense(expense.id, { payment_status: "paid" });
      toast({
        title: "Sucesso",
        description: "Despesa marcada como paga!",
      });
      loadExpenses();
    } catch (error) {
      toast({
        title: "Erro",
        description: "Não foi possível marcar como paga.",
        variant: "destructive",
      });
    }
  };
  // Memoize os dados filtrados para evitar recálculos desnecessários
  const filteredExpenses = useMemo(() => {
    let result = expenses;
    // Usuários não-admin só veem suas próprias despesas
    // Admins veem todas as despesas
    if (!isAdmin && user?.id) {
      result = result.filter(e => e.user_id === user.id);
    }
    if (filters.search && filters.search.trim() !== "") {
      const search = filters.search.trim().toLowerCase();
      result = result.filter(e =>
        Object.values(e).some(v =>
          v && typeof v === "string" && v.toLowerCase().includes(search)
        )
      );
    }
    if (activeTab === "pending") result = result.filter(e => e.status === "pending");
    if (activeTab === "approved") result = result.filter(e => e.status === "approved");
    if (activeTab === "rejected") result = result.filter(e => e.status === "rejected");
    return result;
  }, [expenses, isAdmin, user?.id, filters.search, activeTab]);

  // Ordenar aprovados: pendentes de pagamento primeiro
  const filteredExpensesSorted = useMemo(() => {
    if (activeTab === "approved") {
      return [...filteredExpenses].sort((a, b) => {
        if ((a.payment_status === "paid") === (b.payment_status === "paid")) return 0;
        return a.payment_status === "paid" ? 1 : -1;
      });
    }
    return filteredExpenses;
  }, [filteredExpenses, activeTab]);

  // Resumo baseado nas permissões do usuário
  const userExpenses = isAdmin ? expenses : expenses.filter(e => e.user_id === user?.id);
  const pendingExpenses = userExpenses.filter((e) => e.status === "pending");
  const approvedExpenses = userExpenses.filter((e) => e.status === "approved");
  const rejectedExpenses = userExpenses.filter((e) => e.status === "rejected");
  const paidExpenses = expenses.filter((e) => e.status === "approved" && e.payment_status === "paid");
  const unpaidExpenses = expenses.filter((e) => e.status === "approved" && e.payment_status !== "paid");
  const paidCount = paidExpenses.length;
  const unpaidCount = unpaidExpenses.length;
  const approvedCount = approvedExpenses.length;
  const pendingCount = pendingExpenses.length;
  const rejectedCount = rejectedExpenses.length;
  const totalCount = userExpenses.length;
  const paidTotal = paidExpenses.reduce((acc, curr) => acc + curr.amount, 0);
  const unpaidTotal = unpaidExpenses.reduce((acc, curr) => acc + curr.amount, 0);
  const approvedTotal = approvedExpenses.reduce((acc, curr) => acc + curr.amount, 0);
  const pendingTotal = pendingExpenses.reduce((acc, curr) => acc + curr.amount, 0);
  const rejectedTotal = rejectedExpenses.reduce((acc, curr) => acc + curr.amount, 0);
  const totalAmount = userExpenses.reduce((acc, curr) => acc + curr.amount, 0);

  // Calcular totais em R$
  const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  };

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
      toast({
        title: "Erro",
        description: "Não foi possível fazer logout. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="container mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Sistema de Reembolso</h1>
          <div className="flex gap-2 items-center">
            <Button
              onClick={() => navigate('/')}
              variant="outline"
              className="flex items-center gap-2"
            >
              Home
            </Button>
            <Button
              onClick={handleRefresh}
              variant="outline"
              disabled={isLoading}
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-5 w-5" />
              Atualizar
            </Button>
            <Button
              onClick={handleCreateExpense}
              className="flex items-center gap-2"
            >
              <PlusCircle className="h-5 w-5" />
              Novo Reembolso
            </Button>
            {isAdmin && (
              <Button
                onClick={() => setActiveTab("register")}
                className="flex items-center gap-2"
              >
                <PlusCircle className="h-5 w-5" />
                Cadastrar Usuário
              </Button>
            )}
            <Button
              type="button"
              onClick={handleLogout}
              variant="outline"
              className="flex items-center gap-2"
            >
              <LogOut className="h-5 w-5" />
              Sair
            </Button>
          </div>
        </div>

        {/* Cards de resumo - visíveis para todos os usuários */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {isAdmin ? "Total de Solicitações" : "Minhas Solicitações"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCount}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {formatCurrency(totalAmount)}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pendentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <span className="text-2xl font-bold">{pendingCount}</span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {formatCurrency(pendingTotal)}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Aprovados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-2xl font-bold">{approvedCount}</span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {formatCurrency(approvedTotal)}
              </div>
              {isAdmin && (
                <div className="mt-2 text-xs">
                  <span className="text-green-600">Pagos: {paidCount} ({formatCurrency(paidTotal)})</span>
                  <br />
                  <span className="text-amber-600">Pendentes: {unpaidCount} ({formatCurrency(unpaidTotal)})</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Rejeitados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                <span className="text-2xl font-bold">{rejectedCount}</span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {formatCurrency(rejectedTotal)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Botão de cadastrar usuário apenas para admins */}
        {isAdmin && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Espaço para futuras funcionalidades admin */}
          </div>
        )}

        <Tabs
          defaultValue="pending"
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="pending" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Pendentes
            </TabsTrigger>
            <TabsTrigger value="approved" className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Aprovados
            </TabsTrigger>
            <TabsTrigger value="rejected" className="flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              Rejeitados
            </TabsTrigger>
          </TabsList>

          <FilterBar onFilterChange={setFilters} />

          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2">
                Carregando despesas...
              </span>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <XCircle className="h-12 w-12 text-red-500" />
              <div className="text-center">
                <h3 className="text-lg font-semibold">Erro ao carregar dados</h3>
                <p className="text-muted-foreground">
                  {loadError.message || "Não foi possível carregar as despesas."}
                </p>
              </div>
              <Button onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Tentar novamente
              </Button>
            </div>
          ) : (
            <>
              <TabsContent value="pending" className="mt-4">
                <ExpenseTable
                  expenses={filteredExpenses}
                  onViewDetails={handleViewDetails}
                  showPaymentStatus={false}
                  isAdmin={isAdmin}
                  hasRole={hasRole}
                  onBulkAction={async (selected, action) => {
                    await Promise.all(selected.map(e => updateExpense(e.id, { status: action === "approve" ? "approved" : "rejected" })));
                    await loadExpenses();
                  }}
                  onDelete={handleDelete}
                  onMarkPaid={handleMarkPaid}
                />
              </TabsContent>
              <TabsContent value="approved" className="mt-4">
                <ExpenseTable
                  expenses={filteredExpensesSorted}
                  onViewDetails={handleViewDetails}
                  showPaymentStatus={true}
                  isAdmin={isAdmin}
                  hasRole={hasRole}
                  onBulkMarkPaid={async (selected) => {
                    await Promise.all(
                      selected.map(e => updateExpense(e.id, { payment_status: "paid" }))
                    );
                    await loadExpenses();
                  }}
                  onMarkPaid={handleMarkPaid}
                />
              </TabsContent>
              <TabsContent value="rejected" className="mt-4">
                <ExpenseTable
                  expenses={filteredExpenses}
                  onViewDetails={handleViewDetails}
                  showPaymentStatus={false}
                  isAdmin={isAdmin}
                  hasRole={hasRole}
                  onMarkPaid={handleMarkPaid}
                />
              </TabsContent>
              {isAdmin && activeTab === "register" && (
                <TabsContent value="register" className="mt-4">
                  <UserRegisterTab />
                </TabsContent>
              )}
            </>
          )}
        </Tabs>
      </div>

      {showExpenseDetail && selectedExpenseId && (
        <ExpenseDetail
          expenseId={selectedExpenseId}
          isOpen={showExpenseDetail}
          onClose={handleCloseDetail}
          onStatusChange={handleStatusChange}
        />
      )}

      <Dialog open={showExpenseForm} onOpenChange={setShowExpenseForm}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Reembolso</DialogTitle>
          </DialogHeader>
          <ExpenseForm onClose={handleCloseForm} />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Home;
