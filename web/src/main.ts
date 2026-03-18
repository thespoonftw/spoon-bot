import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import AlbumList from "./views/AlbumList.vue";
import AlbumView from "./views/AlbumView.vue";
import "./style.css";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: AlbumList },
    { path: "/album/:channelId", component: AlbumView },
  ],
});

createApp(App).use(router).mount("#app");
