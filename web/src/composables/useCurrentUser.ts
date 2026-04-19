import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { getSession, clearSession } from "../utils/session";

export function useCurrentUser() {
  const router = useRouter();
  const currentUser = ref<{ userId: string; displayName: string; firstName?: string; avatarUrl: string; groups: { id: number; name: string; color: string }[] } | null>(null);

  onMounted(async () => {
    const session = getSession();
    const res = await fetch("/api/auth/check", { headers: { Authorization: `Bearer ${session}` } });
    if (res.ok) {
      const data = await res.json();
      if (data.valid) currentUser.value = { userId: data.userId, displayName: data.displayName, firstName: data.firstName ?? undefined, avatarUrl: data.avatarUrl, groups: data.groups ?? [] };
    }
  });

  async function logout() {
    const session = getSession();
    await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${session}` } });
    clearSession();
    router.push("/login");
  }

  return { currentUser, logout };
}
