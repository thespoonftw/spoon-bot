import { ref, computed, watch, onUnmounted } from "vue";
import type { Ref } from "vue";

export function useEscKey(active: Ref<boolean>, handler: () => void) {
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { e.stopImmediatePropagation(); handler(); }
  }
  watch(active, (v) => {
    if (v) window.addEventListener("keydown", onKeyDown, true);
    else window.removeEventListener("keydown", onKeyDown, true);
  });
  onUnmounted(() => window.removeEventListener("keydown", onKeyDown, true));
}


export function useDraggable() {
  const x = ref(0);
  const y = ref(0);

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX - x.value;
    const startY = e.clientY - y.value;

    function onMouseMove(e: MouseEvent) {
      x.value = e.clientX - startX;
      y.value = e.clientY - startY;
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  const style = computed(() => ({ transform: `translate(${x.value}px, ${y.value}px)` }));
  const reset = () => { x.value = 0; y.value = 0; };

  return { onMouseDown, style, reset };
}
