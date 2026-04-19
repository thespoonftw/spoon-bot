import { ref } from "vue";

const dirty = ref(false);

export function useAlbumsCache() {
  return {
    albumsDirty: dirty,
    markAlbumsDirty: () => { dirty.value = true; },
    clearDirty: () => { dirty.value = false; },
  };
}
