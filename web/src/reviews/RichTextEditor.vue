<template>
  <div class="rv-rte">
    <div class="rv-rte-toolbar">
      <button v-for="b in buttons" :key="b.cmd + (b.arg ?? '')" type="button" :title="b.title"
        :class="{ active: active[b.cmd + (b.arg ?? '')] }" @mousedown.prevent="run(b)" v-html="b.label"></button>
      <span class="sep"></span>
      <button type="button" title="Link" @mousedown.prevent="addLink">🔗</button>
      <button type="button" title="Clear formatting" @mousedown.prevent="clearFormatting">⌫</button>
    </div>
    <div
      ref="surface" class="rv-rte-surface rv-prose" contenteditable="true" role="textbox" aria-multiline="true"
      :data-placeholder="placeholder" @input="emitValue" @paste="onPaste" @keyup="refreshActive" @mouseup="refreshActive" @focus="onFocus"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch } from "vue";

// A deliberately small contenteditable editor. The HTML it produces is sanitised again on the
// server against the same set of tags these buttons can create.
const props = defineProps<{ modelValue: string; placeholder?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

type Btn = { cmd: string; arg?: string; label: string; title: string };
const buttons: Btn[] = [
  { cmd: "bold", label: "<b>B</b>", title: "Bold" },
  { cmd: "italic", label: "<i>I</i>", title: "Italic" },
  { cmd: "underline", label: "<u>U</u>", title: "Underline" },
  { cmd: "strikeThrough", label: "<s>S</s>", title: "Strikethrough" },
  { cmd: "formatBlock", arg: "h3", label: "H", title: "Heading" },
  { cmd: "formatBlock", arg: "blockquote", label: "❝", title: "Quote" },
  { cmd: "insertUnorderedList", label: "•&thinsp;≡", title: "Bulleted list" },
  { cmd: "insertOrderedList", label: "1.&thinsp;≡", title: "Numbered list" },
];

const surface = ref<HTMLDivElement | null>(null);
const active = reactive<Record<string, boolean>>({});

function emitValue() {
  const el = surface.value!;
  // An editor the user has emptied often keeps a stray <br>; treat it as blank so the placeholder returns.
  if (!el.textContent?.trim() && !el.querySelector("li")) el.innerHTML = "";
  emit("update:modelValue", el.innerHTML);
  refreshActive();
}

function run(b: Btn) {
  surface.value?.focus();
  if (b.cmd === "formatBlock") {
    const current = String(document.queryCommandValue("formatBlock")).toLowerCase();
    document.execCommand("formatBlock", false, current === b.arg ? "p" : b.arg);
  } else {
    document.execCommand(b.cmd, false);
  }
  emitValue();
}

function addLink() {
  const url = window.prompt("Link URL (https://…)");
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) { window.alert("Links must start with http:// or https://"); return; }
  surface.value?.focus();
  document.execCommand("createLink", false, url);
  emitValue();
}

function clearFormatting() {
  surface.value?.focus();
  document.execCommand("removeFormat", false);
  document.execCommand("formatBlock", false, "p");
  emitValue();
}

// Paste as plain text so formatting from web pages and Word doesn't come along for the ride.
function onPaste(e: ClipboardEvent) {
  e.preventDefault();
  document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
}

function onFocus() {
  document.execCommand("defaultParagraphSeparator", false, "p");
}

function refreshActive() {
  if (!surface.value || document.activeElement !== surface.value) return;
  const block = String(document.queryCommandValue("formatBlock")).toLowerCase();
  for (const b of buttons) {
    active[b.cmd + (b.arg ?? "")] = b.cmd === "formatBlock" ? block === b.arg : document.queryCommandState(b.cmd);
  }
}

// Only push outside changes into the DOM (e.g. an existing review finishing loading) — rewriting
// innerHTML on every keystroke would throw the caret back to the start.
watch(() => props.modelValue, (v) => {
  if (surface.value && v !== surface.value.innerHTML) surface.value.innerHTML = v;
});

onMounted(() => {
  surface.value!.innerHTML = props.modelValue;
  document.addEventListener("selectionchange", refreshActive);
});
onUnmounted(() => document.removeEventListener("selectionchange", refreshActive));
</script>
