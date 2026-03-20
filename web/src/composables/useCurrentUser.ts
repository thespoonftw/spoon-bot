import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";

export function useCurrentUser() {
  const router = useRouter();
  const currentUser = ref<{ displayName: string; firstName?: string; avatarUrl: string } | null>(null);

  onMounted(async () => {
    const session = localStorage.getItem("snek_session");
    const res = await fetch("/api/auth/check", { headers: { Authorization: `Bearer ${session}` } });
    if (res.ok) {
      const data = await res.json();
      if (data.valid) currentUser.value = { displayName: data.displayName, firstName: data.firstName ?? undefined, avatarUrl: data.avatarUrl };
    }
  });

  async function logout() {
    const session = localStorage.getItem("snek_session");
    await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${session}` } });
    localStorage.removeItem("snek_session");
    router.push("/login");
  }

  return { currentUser, logout };
}
