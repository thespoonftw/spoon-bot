<template>
  <div class="form-group">
    <label>Start Date</label>
    <input v-model="startDate" type="date" />
  </div>
  <div class="form-group">
    <label>End Date</label>
    <div v-if="endDate" style="display:flex;gap:8px;align-items:center">
      <input v-model="endDate" type="date" style="flex:1" />
      <button type="button" class="btn-remove" @click="endDate = ''">remove</button>
    </div>
    <button v-else type="button" class="btn-secondary btn-small" @click="endDate = startDate">+ Add end date</button>
  </div>
</template>

<script setup lang="ts">
const startDate = defineModel<string>("startDate", { required: true });
const endDate = defineModel<string>("endDate", { required: true });
</script>
