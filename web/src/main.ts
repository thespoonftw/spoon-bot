import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import LandingView from "./views/LandingView.vue";
import AlbumList from "./views/AlbumList.vue";
import AlbumView from "./views/AlbumView.vue";
import UsersView from "./views/UsersView.vue";
import GroupsView from "./views/GroupsView.vue";
import ShareView from "./views/ShareView.vue";
import LocationShareView from "./views/LocationShareView.vue";
import StatusView from "./views/StatusView.vue";
import DatabaseView from "./views/DatabaseView.vue";
import SnekView from "./views/SnekView.vue";
import SearchView from "./views/SearchView.vue";
import MapView from "./views/MapView.vue";
import LoginView from "./views/LoginView.vue";
import MagicLinkSent from "./views/MagicLinkSent.vue";
import AuthVerify from "./views/AuthVerify.vue";
import ReviewsLayout from "./reviews/ReviewsLayout.vue";
import ReviewsHome from "./reviews/ReviewsHome.vue";
import ReviewDetail from "./reviews/ReviewDetail.vue";
import ReviewEditor from "./reviews/ReviewEditor.vue";
import ReviewProfileView from "./reviews/ReviewProfileView.vue";
import ReviewsLogin from "./reviews/ReviewsLogin.vue";
import ReviewsLoginSent from "./reviews/ReviewsLoginSent.vue";
import ReviewsAuthVerify from "./reviews/ReviewsAuthVerify.vue";
import ReviewTypesAdmin from "./reviews/ReviewTypesAdmin.vue";
import ReviewsAppView from "./reviews/ReviewsAppView.vue";
import PhotosView from "./views/PhotosView.vue";
import PhotosAppView from "./views/PhotosAppView.vue";
import AdminView from "./views/AdminView.vue";
import { appForPath, syncAppHead, registerServiceWorker, listenForInstallPrompt, APPS } from "./utils/pwa";
import "./style.css";

function applyMobileZoom() {
  const breakpoint = 430;
  const zoom = window.innerWidth < breakpoint ? window.innerWidth / breakpoint : 1;
  document.documentElement.style.zoom = zoom === 1 ? '' : String(zoom);
  // The screen's height in zoomed px, so a page can fill exactly one screen (vh units don't account for the zoom).
  document.documentElement.style.setProperty('--screen-height', `${window.innerHeight / zoom}px`);
}
applyMobileZoom();
window.addEventListener('resize', applyMobileZoom);

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.path === '/photos/albums') return false;
    // Only the query changed (e.g. an album's sort) — stay put.
    if (to.path === from.path) return false;
    return { top: 0 };
  },
  routes: [
    { path: "/login", component: LoginView, meta: { public: true } },
    { path: "/login/sent", component: MagicLinkSent, meta: { public: true } },
    { path: "/auth/verify/:token", component: AuthVerify, meta: { public: true } },
    { path: "/share/:token", component: ShareView, meta: { public: true } },
    { path: "/location/:token", component: LocationShareView, meta: { public: true } },
    { path: "/", component: LandingView },
    { path: "/admin", component: AdminView },
    // The photos section is also the installable brunchPhotos app (scope /photos), so everything it
    // needs, its own login pages included, lives under /photos.
    { path: "/photos", component: PhotosView },
    { path: "/photos/login", component: LoginView, meta: { public: true } },
    { path: "/photos/login/sent", component: MagicLinkSent, meta: { public: true } },
    { path: "/photos/auth/verify/:token", component: AuthVerify, meta: { public: true } },
    // How to install the app: open to anyone, so the link can be passed around before signing in.
    { path: "/photos/app", component: PhotosAppView, meta: { public: true } },
    { path: "/photos/albums", component: AlbumList },
    { path: "/photos/albums/:channelId", component: AlbumView },
    { path: "/photos/search", component: SearchView },
    { path: "/photos/map", component: MapView },
    // Old addresses, still linked from earlier Discord posts and bookmarks.
    { path: "/albums", redirect: "/photos/albums" },
    { path: "/album/:channelId", redirect: (to) => ({ path: `/photos/albums/${to.params.channelId}`, query: to.query }) },
    { path: "/search", redirect: (to) => ({ path: "/photos/search", query: to.query }) },
    { path: "/map", redirect: "/photos/map" },
    { path: "/users", component: UsersView },
    { path: "/groups", component: GroupsView },
    { path: "/status", component: StatusView },
    { path: "/database", component: DatabaseView },
    { path: "/snek", component: SnekView },
    {
      path: "/reviews", component: ReviewsLayout,
      children: [
        { path: "login", component: ReviewsLogin, meta: { public: true } },
        { path: "login/sent", component: ReviewsLoginSent, meta: { public: true } },
        { path: "auth/verify/:token", component: ReviewsAuthVerify, meta: { public: true } },
        // How to install the app: open to anyone, so the link can be passed around before signing in.
        { path: "app", component: ReviewsAppView, meta: { public: true, openToAll: true } },
        { path: "", component: ReviewsHome },
        { path: "new", component: ReviewEditor },
        { path: "people/:userId", component: ReviewProfileView },
        { path: "types", component: ReviewTypesAdmin },
        { path: ":id(\\d+)", component: ReviewDetail },
        { path: ":id(\\d+)/edit", component: ReviewEditor },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  try {
    // Auth rides on the HttpOnly snek_session cookie, sent automatically same-origin.
    const res = await fetch("/api/auth/check");
    const data = await res.json();
    if (data.valid) return true;
  } catch { /* network error, fall through to login */ }
  // The reviews and photos apps have their own login pages, so signing in never leaves the app.
  const app = appForPath(to.path);
  return { path: app ? `${APPS[app].scope}/login` : "/login" };
});

// The browser tab names the section you're in: "Brunch Reviews", "brunchPhotos", or "Brunch Projects"
// for the rest. Those two sections are installable apps, so their pages carry that app's manifest.
router.afterEach((to) => {
  const app = appForPath(to.path);
  document.title = app ? APPS[app].title : "Brunch Projects";
  syncAppHead(app);
  if (app) registerServiceWorker(app);
});
listenForInstallPrompt();

const app = createApp(App);
app.use(router).mount("#app");
