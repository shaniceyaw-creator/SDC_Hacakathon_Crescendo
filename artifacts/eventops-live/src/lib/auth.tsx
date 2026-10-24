import { createContext, useContext, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMe, getGetMeQueryKey, useLogin, useLogout, useResetDemo, type Account } from '@workspace/api-client-react';

type Auth = {
  account: Account | null;
  loading: boolean;
  signIn: (accountId: string) => Promise<Account>;
  signOut: () => Promise<void>;
  resetDemo: () => Promise<number>;
  resetting: boolean;
};

const AuthContext = createContext<Auth | null>(null);

/** Demo sign-in. The server keeps the account in a signed cookie and checks the role on every request. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false, staleTime: 5 * 60_000 } });
  const login = useLogin();
  const logout = useLogout();
  const reset = useResetDemo();

  const value: Auth = {
    account: me.isError ? null : me.data ?? null,
    loading: me.isLoading,
    async signIn(accountId) {
      const account = await login.mutateAsync({ data: { accountId } });
      queryClient.clear();
      queryClient.setQueryData(getGetMeQueryKey(), account);
      return account;
    },
    async signOut() {
      await logout.mutateAsync();
      queryClient.clear();
      queryClient.setQueryData(getGetMeQueryKey(), null);
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    },
    async resetDemo() {
      const result = await reset.mutateAsync();
      // Everything shown may have changed; keep the signed-in account.
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== getGetMeQueryKey()[0] });
      return result.events;
    },
    resetting: reset.isPending,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}

export function homeFor(role: Account['role']) {
  return role === 'manager' ? '/manager' : role === 'worker' ? '/worker' : '/customer';
}
