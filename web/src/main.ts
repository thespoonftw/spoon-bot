import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import LandingView from "./views/LandingView.vue";
import AlbumList from "./views/AlbumList.vue";
import AlbumView from "./views/AlbumView.vue";
import UsersView from "./views/UsersView.vue";
import ShareView from "./views/ShareView.vue";
import StatusView from "./views/StatusView.vue";
import DatabaseView from "./views/DatabaseView.vue";
import SearchView from "./views/SearchView.vue";
import MapView from "./views/MapView.vue";
import LoginView from "./views/LoginView.vue";
import MagicLinkSent from "./views/MagicLinkSent.vue";
import AuthVerify from "./views/AuthVerify.vue";
import "./style.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: LoginView, meta: { public: true } },
    { path: "/login/sent", component: MagicLinkSent, meta: { public: true } },
    { path: "/auth/verify/:token", component: AuthVerify, meta: { public: true } },
    { path: "/share/:token", component: ShareView, meta: { public: true } },
    { path: "/", component: LandingView },
    { path: "/albums", component: AlbumList },
    { path: "/album/:channelId", component: AlbumView },
    { path: "/search", component: SearchView },
    { path: "/map", component: MapView },
    { path: "/users", component: UsersView },
    { path: "/status", component: StatusView },
    { path: "/database", component: DatabaseView },
  ],
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  try {
    const token = localStorage.getItem("snek_session") ?? "";
    const res = await fetch("/api/auth/check", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const data = await res.json();
    if (data.valid) return true;
  } catch { /* network error, let it through */ }
  return { path: "/login" };
});

createApp(App).use(router).mount("#app");
