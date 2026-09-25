import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";

export function useCurrentUser() {
  const router = useRouter();
  const currentUser = ref<{ userId: string; displayName: string; firstName?: string; avatarUrl: string; level: number; groups: { id: number; name: string; color: string }[] } | null>(null);

  async function reload() {
    const res = await fetch("/api/auth/check");
    if (res.ok) {
      const data = await res.json();
      if (data.valid) currentUser.value = { userId: data.userId, displayName: data.displayName, firstName: data.firstName ?? undefined, avatarUrl: data.avatarUrl, level: data.level ?? 1, groups: data.groups ?? [] };
    }
  }

  onMounted(reload);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return { currentUser, logout, reload };
}
