<!--
  -*- coding: utf-8 -*-

  -------------------------------------------------------------------------
  COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
  Licensed under "AiDiy 公開利用ライセンス v1.1".
  Commercial use requires prior written consent from all copyright holders.
  See LICENSE for full terms. Thank you for keeping the rules.
  https://github.com/monjyu1101/AiDiy2027
  -------------------------------------------------------------------------
-->

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';

interface 車両型 {
  車両ID: string
  車両名: string
  車両備考?: string
}

interface 配車型 {
  配車伝票ID: string
  配車開始日時: string
  配車終了日時: string
  車両ID: string
  配車区分ID: string
  配車区分名?: string
  配車内容?: string
  配車備考?: string
  配色枠?: string
  配色背景?: string
  配色前景?: string
  [key: string]: any
}

const props = defineProps({
  車両リスト: {
    type: Array as () => 車両型[],
    default: () => []
  },
  配車リスト: {
    type: Array as () => 配車型[],
    default: () => []
  },
  対象日付: {
    type: Date,
    required: true
  }
});

const emit = defineEmits([
  'update-schedule-resize',
  'update-schedule-drop',
  'open-edit-form'
]);

let draggingScheduleId: string | null = null;
let resizeState: any = null;

const normalizeQueryValue = (value) => (Array.isArray(value) ? value[0] : value);

const formatDate = (date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
};

const formatDateISO = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatTime = (date) => {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const displayDates = computed(() => {
  if (!props.対象日付) return [];
  // 10日間表示
  return Array.from({ length: 10 }, (_, index) => {
    const date = addDays(props.対象日付, index);
    return {
      date,
      dateStr: formatDateISO(date),
      label: formatDate(date),
      dayOfWeek: date.getDay(),
      dayName: ['日', '月', '火', '水', '木', '金', '土'][date.getDay()]
    };
  });
});

const getCellWidth = () => {
  const cell = document.querySelector('.droppable-area');
  if (cell) {
    const width = cell.getBoundingClientRect().width;
    if (width > 0) return width;
  }

  const grid = document.querySelector('.weekly-grid');
  if (!grid) return 0;

  const gridWidth = grid.getBoundingClientRect().width;
  const vehicleColumnWidth = 150;
  const dateColumns = 10;
  const gap = 1;

  const totalGaps = 11;
  const availableWidth = gridWidth - vehicleColumnWidth - (totalGaps * gap);
  const cellWidth = availableWidth / dateColumns;
  return cellWidth;
};

const SLOT_HEIGHT = 70;

const clearScheduleElements = () => {
  document.querySelectorAll('.schedule-item').forEach((item) => item.remove());
};

const resetCellHeights = () => {
  props.車両リスト.forEach((vehicle) => {
    const vehicleCell = document.getElementById(`vehicle-cell-${vehicle.車両ID}`);
    if (vehicleCell) {
      vehicleCell.style.height = `${SLOT_HEIGHT}px`;
      vehicleCell.style.minHeight = `${SLOT_HEIGHT}px`;
    }
    for (const day of displayDates.value) {
      const cellId = `cell-${vehicle.車両ID}-${day.dateStr}`;
      const cell = document.getElementById(cellId);
      if (cell) {
        cell.style.height = `${SLOT_HEIGHT}px`;
        cell.style.minHeight = `${SLOT_HEIGHT}px`;
      }
    }
  });
};

const renderSchedules = () => {
  clearScheduleElements();
  resetCellHeights();
  if (!props.対象日付) return;
  
  const displayStartDate = new Date(props.対象日付);
  const displayEndDate = addDays(props.対象日付, 9);
  // displayEndDateをその日の終わりに設定（比較用）
  displayEndDate.setHours(23, 59, 59, 999);

  // displayStartDateをその日の始まりに設定
  displayStartDate.setHours(0, 0, 0, 0);

  // 比較用に終了日の翌日の0時を作成
  const displayRangeEnd = new Date(displayEndDate);
  displayRangeEnd.setDate(displayRangeEnd.getDate() + 1);
  displayRangeEnd.setHours(0, 0, 0, 0);

  // Phase 1: Pre-compute layout info
  const slotInfos: { schedule: any, dateCols: string[], lane: number }[] = [];
  const rowSlots = new Map<string, typeof slotInfos>();

  props.配車リスト.forEach((schedule) => {
    const startDateTime = new Date(schedule.配車開始日時);
    const endDateTime = new Date(schedule.配車終了日時);
    if (endDateTime < displayStartDate || startDateTime >= displayRangeEnd) return;

    const dispStart = new Date(Math.max(startDateTime.getTime(), displayStartDate.getTime()));
    const dispEnd = new Date(Math.min(endDateTime.getTime(), displayRangeEnd.getTime()));

    const dStart = new Date(dispStart); dStart.setHours(0,0,0,0);
    const dEnd = new Date(dispEnd);
    if (dEnd.getHours() === 0 && dEnd.getMinutes() === 0 && dEnd > dStart) {
      dEnd.setDate(dEnd.getDate() - 1);
    }
    dEnd.setHours(0,0,0,0);

    const dateCols: string[] = [];
    let curDate = new Date(dStart);
    while (curDate <= dEnd) {
      dateCols.push(formatDateISO(curDate));
      curDate.setDate(curDate.getDate() + 1);
    }
    if (dateCols.length === 0) return;

    const info = { schedule, dateCols, lane: 0 };
    slotInfos.push(info);
    const rowKey = schedule.車両ID;
    if (!rowSlots.has(rowKey)) rowSlots.set(rowKey, []);
    rowSlots.get(rowKey)!.push(info);
  });

  // Phase 2: Assign lanes per row
  for (const [rowKey, infos] of rowSlots) {
    infos.sort((a, b) => a.dateCols[0].localeCompare(b.dateCols[0]));
    const lanes: Set<string>[] = [];
    for (const info of infos) {
      let lane = 0;
      while (lane < lanes.length) {
        let conflict = false;
        for (const d of info.dateCols) {
          if (lanes[lane].has(d)) { conflict = true; break; }
        }
        if (!conflict) break;
        lane++;
      }
      if (lane === lanes.length) lanes.push(new Set());
      for (const d of info.dateCols) {
        lanes[lane].add(d);
      }
      info.lane = lane;
    }
    // Expand row cells
    const maxLanes = Math.max(1, lanes.length);
    const newHeight = maxLanes * SLOT_HEIGHT;
    const vehicleCell = document.getElementById(`vehicle-cell-${rowKey}`);
    if (vehicleCell) {
      vehicleCell.style.height = `${newHeight}px`;
      vehicleCell.style.minHeight = `${newHeight}px`;
    }
    for (const day of displayDates.value) {
      const cellId = `cell-${rowKey}-${day.dateStr}`;
      const cell = document.getElementById(cellId);
      if (cell) {
        cell.style.height = `${newHeight}px`;
        cell.style.minHeight = `${newHeight}px`;
      }
    }
  }

  // Force reflow
  const grid = document.getElementById('weekly-grid');
  if (grid) void grid.offsetHeight;

  // Phase 3: Build lane map and render
  const scheduleLaneMap = new Map<string, number>();
  for (const info of slotInfos) {
    scheduleLaneMap.set(info.schedule.配車伝票ID, info.lane);
  }

  props.配車リスト.forEach((schedule) => {
    const startDateTime = new Date(schedule.配車開始日時);
    const endDateTime = new Date(schedule.配車終了日時);
    if (endDateTime < displayStartDate || startDateTime >= displayRangeEnd) return;
    const displayStart = new Date(Math.max(startDateTime.getTime(), displayStartDate.getTime()));
    const displayEnd = new Date(Math.min(endDateTime.getTime(), displayRangeEnd.getTime()));
    const lane = scheduleLaneMap.get(schedule.配車伝票ID) || 0;
    renderSchedule(schedule, startDateTime, endDateTime, displayStart, displayEnd, displayStartDate, displayRangeEnd, lane);
  });
};

const renderSchedule = (schedule, startDateTime, endDateTime, displayStart, displayEnd, rangeStart, rangeEnd, lane = 0) => {
  const vehicleId = schedule.車両ID;
  const renderStartStr = formatDateISO(displayStart);
  
  // 開始セルを探す
  // もし開始日が範囲外(より過去)なら、範囲の最初の日を基準にする
  // ただし、displayStartはすでにMath.maxされているので、その日付のセルを探す
  const startCell = document.getElementById(`cell-${vehicleId}-${renderStartStr}`);
  
  // 週の途中で車両が変わることはない前提だが、もしセルがない（車両が表示されていない）ならスキップ
  if (!startCell) return;

  // 日数を計算
  const msPerDay = 24 * 60 * 60 * 1000;
  // startDateTimeとendDateTimeの日付部分の差分ではなく、表示されている矩形の期間
  // displayStartの0:00からdisplayEndの次の日の0:00までの日数差分
  
  const dStart = new Date(displayStart);
  dStart.setHours(0,0,0,0);
  
  // displayEndが0:00ジャストの場合、それは前の日の終わりを意味することが多いが、
  // ここではdisplayEndはendTime自体か、期間終わりの翌日0時。
  // 単純に日付の差分を取る。
  // 例: 1日～3日なら、1,2,3の3日間。
  // displayStart: 1日xx時, displayEnd: 3日xx時
  
  let currentDate = new Date(dStart);
  let visibleDays = 0;
  
  // 表示終了日の日付部分
  const dEnd = new Date(displayEnd);
  if (dEnd.getHours() === 0 && dEnd.getMinutes() === 0 && dEnd > dStart) {
      // 終了時刻が00:00の場合、前日までを表示対象とする扱い
      dEnd.setDate(dEnd.getDate() - 1);
  }
  dEnd.setHours(0,0,0,0);

  // 表示日数計算
  while (currentDate <= dEnd) {
      // 念のためセルが存在するか確認（週をまたぐ場合の制御）
      const cellId = `cell-${vehicleId}-${formatDateISO(currentDate)}`;
      if (document.getElementById(cellId)) {
          visibleDays++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
  }

  if (visibleDays === 0) return;

  const isPartialStart = startDateTime < displayStart || (startDateTime.getTime() === displayStart.getTime() && startDateTime < rangeStart); 
  // 単純な日付比較
  const originalStartDate = new Date(startDateTime); originalStartDate.setHours(0,0,0,0);
  const rangeTitleStart = new Date(rangeStart); rangeTitleStart.setHours(0,0,0,0);
  const isStartOverflow = originalStartDate < rangeTitleStart;

  const originalEndDate = new Date(endDateTime); originalEndDate.setHours(0,0,0,0);
  const rangeTitleEnd = new Date(rangeEnd); rangeTitleEnd.setDate(rangeTitleEnd.getDate() - 1); rangeTitleEnd.setHours(0,0,0,0); // rangeEndは翌日0時
  const isEndOverflow = originalEndDate > rangeTitleEnd; 
  // ※厳密には時刻も含めるべきだが、日表示ではないので「前の週から続いている」「次の週へ続く」の判定ができればよい

  let startTimeStr = `${formatDate(startDateTime)} ${formatTime(startDateTime)}`;
  let endTimeStr = `～${formatDate(endDateTime)} ${formatTime(endDateTime)}`;
  if (isStartOverflow) {
    startTimeStr = `\u25c0${formatDate(startDateTime)} ${formatTime(startDateTime)}`;
  }
  if (isEndOverflow) {
    endTimeStr = `～${formatDate(endDateTime)} ${formatTime(endDateTime)}\u25b6`;
  }

  const categoryName = schedule.配車区分名 || '';
  const content = schedule.配車内容 || '';
  const borderColor = schedule.配色枠 || '#0056b3';
  const backgroundColor = schedule.配色背景 || '#007bff';
  const textColor = schedule.配色前景 || '#ffffff';

  const cellWidth = getCellWidth();
  if (cellWidth === 0) return;

  const gapWidth = 1;
  const totalWidth = (cellWidth * visibleDays) + (gapWidth * (visibleDays - 1));

  const grid = document.getElementById('weekly-grid');
  if (!grid) return;

  const gridRect = grid.getBoundingClientRect();
  const cellRect = startCell.getBoundingClientRect();

  const left = cellRect.left - gridRect.left;
  const top = cellRect.top - gridRect.top + lane * SLOT_HEIGHT;

  const scheduleElement = document.createElement('div');
  scheduleElement.className = 'schedule-item';
  scheduleElement.setAttribute('data-配車伝票ID', schedule.配車伝票ID);
  scheduleElement.title = schedule.配車内容 || '';
  scheduleElement.style.position = 'absolute';
  scheduleElement.style.left = `${left}px`;
  scheduleElement.style.top = `${top}px`;
  scheduleElement.style.width = `${totalWidth}px`;
  scheduleElement.style.maxWidth = `${totalWidth}px`;
  scheduleElement.style.backgroundColor = backgroundColor;
  scheduleElement.style.border = `1px solid ${borderColor}`;
  scheduleElement.style.borderLeft = `6px solid ${borderColor}`;
  scheduleElement.style.color = textColor;
  scheduleElement.innerHTML = `
    <div class="schedule-text schedule-text-start">${startTimeStr} ${categoryName}</div>
    <div class="schedule-text schedule-text-center">${content || '&nbsp;'}</div>
    <div class="schedule-text schedule-text-end">${endTimeStr}</div>
  `;

  scheduleElement.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    emit('open-edit-form', schedule.配車伝票ID);
  });
  scheduleElement.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  scheduleElement.addEventListener('dragstart', (event) => {
    draggingScheduleId = schedule.配車伝票ID;
    event.dataTransfer?.setData('text/plain', schedule.配車伝票ID);
    requestAnimationFrame(() => {
      const g = document.getElementById('weekly-grid');
      if (g) g.classList.add('dragging-active');
    });
  });
  scheduleElement.addEventListener('dragend', () => {
    draggingScheduleId = null;
    const g = document.getElementById('weekly-grid');
    if (g) g.classList.remove('dragging-active');
  });
  scheduleElement.draggable = true;

  if (!isStartOverflow) {
    const leftHandle = document.createElement('div');
    leftHandle.className = 'resize-handle resize-handle-left';
    leftHandle.addEventListener('pointerdown', (event) => {
      startResize(event, schedule, 'left', scheduleElement);
    });
    // バブリング防止
    leftHandle.addEventListener('click', e => e.stopPropagation());
    leftHandle.addEventListener('dblclick', e => e.stopPropagation());
    scheduleElement.appendChild(leftHandle);
  }

  if (!isEndOverflow) {
    const rightHandle = document.createElement('div');
    rightHandle.className = 'resize-handle resize-handle-right';
    rightHandle.addEventListener('pointerdown', (event) => {
      startResize(event, schedule, 'right', scheduleElement);
    });
    rightHandle.addEventListener('click', e => e.stopPropagation());
    rightHandle.addEventListener('dblclick', e => e.stopPropagation());
    scheduleElement.appendChild(rightHandle);
  }

  grid.style.position = 'relative';
  grid.appendChild(scheduleElement);
};

const startResize = (event, schedule, direction, element) => {
  event.preventDefault();
  event.stopPropagation();

  const cellWidth = getCellWidth();
  if (!cellWidth) return;

  const rect = element.getBoundingClientRect();
  const originalLeft = parseFloat(element.style.left) || 0;

  element.draggable = false;

  resizeState = {
    schedule,
    direction,
    startX: event.clientX,
    originalWidth: rect.width,
    originalLeft: originalLeft,
    element,
    cellWidth
  };

  const onMove = (moveEvent) => {
    if (!resizeState) return;
    moveEvent.preventDefault();
    const delta = moveEvent.clientX - resizeState.startX;

    const gapWidth = 1;
    const cellWithGap = resizeState.cellWidth + gapWidth;
    const deltaDays = Math.round(delta / cellWithGap);
    const snappedDelta = deltaDays * cellWithGap;

    if (resizeState.direction === 'left') {
      const newLeft = resizeState.originalLeft + snappedDelta;
      const newWidth = resizeState.originalWidth - snappedDelta;
      if (newWidth > cellWithGap - 10) {
        resizeState.element.style.left = `${newLeft}px`;
        resizeState.element.style.width = `${newWidth}px`;
      }
    } else {
      const newWidth = resizeState.originalWidth + snappedDelta;
      if (newWidth > cellWithGap - 10) {
        resizeState.element.style.width = `${newWidth}px`;
      }
    }
  };

  const onUp = (upEvent) => {
    const state = resizeState;
    resizeState = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);

    if (element) {
      element.draggable = true;
    }

    if (!state) return;

    const delta = upEvent.clientX - state.startX;
    const gapWidth = 1;
    const cellWithGap = state.cellWidth + gapWidth;
    const deltaDays = Math.round(delta / cellWithGap);

    if (deltaDays !== 0) {
      emit('update-schedule-resize', { schedule: state.schedule, direction: state.direction, deltaDays });
    } else {
      // 変更なしの場合は再描画で元に戻す
      renderSchedules();
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
};

const handleDrop = (event, vehicleId, dateStr) => {
  event.preventDefault();
  const scheduleId = event.dataTransfer?.getData('text/plain') || draggingScheduleId;
  if (!scheduleId) return;
  emit('update-schedule-drop', { scheduleId, vehicleId, dateStr });
};

const openDispatchScheduleForm = (vehicleId, dateStr) => {
  emit('open-edit-form', null, vehicleId, dateStr);
};

// リサイズイベント時のちらつき防止等を考慮しつつ、props変更検知で再描画
watch(() => props.配車リスト, () => {
  nextTick(renderSchedules);
}, { deep: true });

watch(() => props.対象日付, () => {
  nextTick(renderSchedules);
});

onMounted(() => {
  // マウント時に少し待ってから描画（DOM確定待ち）
  setTimeout(renderSchedules, 100);
  window.addEventListener('resize', renderSchedules);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', renderSchedules);
  clearScheduleElements();
});

// 親からの再描画要求を受け付ける必要があるかもしれないが、基本はwatchで
</script>

<template>
  <div class="weekly-grid" id="weekly-grid">
    <div class="grid-cell header-cell">車両</div>
    <div
      v-for="day in displayDates"
      :key="day.dateStr"
      class="grid-cell header-cell"
      :class="{
        'sunday-background': day.dayOfWeek === 0,
        'saturday-background': day.dayOfWeek === 6
      }"
    >
      <div class="day-header">{{ day.label }} ({{ day.dayName }})</div>
    </div>

    <template v-for="vehicle in 車両リスト" :key="vehicle.車両ID">
      <div class="grid-cell vehicle-cell" :id="`vehicle-cell-${vehicle.車両ID}`">
        <div class="vehicle-id">{{ vehicle.車両ID }} {{ vehicle.車両備考 || '' }}</div>
        <div class="vehicle-name">{{ vehicle.車両名 }}</div>
      </div>
      <div
        v-for="day in displayDates"
        :key="`${vehicle.車両ID}-${day.dateStr}`"
        :id="`cell-${vehicle.車両ID}-${day.dateStr}`"
        class="grid-cell droppable-area empty-cell"
        :class="{
          'sunday-background': day.dayOfWeek === 0,
          'saturday-background': day.dayOfWeek === 6
        }"
        @dragover.prevent
        @drop="(event) => handleDrop(event, vehicle.車両ID, day.dateStr)"
        @dblclick="openDispatchScheduleForm(vehicle.車両ID, day.dateStr)"
      ></div>
    </template>
  </div>
</template>

<style scoped>
.weekly-grid {
  display: grid;
  grid-template-columns: 150px repeat(10, 1fr);
  grid-gap: 1px;
  background-color: #ccc;
  border: 1px solid #ccc;
  height: auto;
  width: calc(100% - 25px);
  margin: 0 10px 10px 15px;
  position: relative;
  user-select: none; /* テキスト選択防止 */
}

.grid-cell {
  background-color: #fff;
  padding: 0;
  height: 70px;
  min-height: 70px;
  position: relative;
  border: 1px solid #ddd;
  box-sizing: border-box;
}

.header-cell {
  background-color: #2c3e50;
  color: #fff;
  font-weight: bold;
  text-align: center;
  font-size: 16px;
  border-bottom: 2px solid #007bff;
  line-height: 1;
  height: 32px;
  min-height: 32px;
  max-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-top: none;
  border-left: none;
  border-right: none;
}

.vehicle-cell {
  background-color: #e6e6e6;
  font-weight: bold;
  padding: 8px 5px;
  font-size: 12px;
  border-right: 2px solid #007bff;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.vehicle-id {
  font-size: 12px;
  text-align: left;
}

.vehicle-name {
  font-size: 14px;
  text-align: center;
  margin-top: 2px;
}

.day-header {
  text-align: center;
  font-size: 14px;
  line-height: 1;
  height: 30px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.empty-cell {
  cursor: pointer;
}

.empty-cell:hover {
  background-color: #f8f9fa;
}

.saturday-background:not(.header-cell) {
  background-color: #e0f7fa;
}

.sunday-background:not(.header-cell) {
  background-color: #ffebee;
}
</style>

<style>
/* 動的生成される要素用スタイル (scoped外) */
.schedule-item {
  background-color: #007bff;
  color: #fff;
  border: 1px solid #0056b3;
  border-left: 8px solid #0056b3;
  border-radius: 3px;
  padding: 3px 6px;
  margin: 0;
  font-size: 14px;
  cursor: pointer;
  position: absolute;
  top: 0;
  left: 0;
  height: 65px;
  min-height: 65px;
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  z-index: 5;
}

.schedule-item:hover {
  z-index: 10;
}

.dragging-active .schedule-item {
  pointer-events: none;
}

.schedule-text {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.schedule-text-start {
  text-align: left;
  padding-left: 4px;
  font-size: 12px;
}

.schedule-text-center {
  text-align: center;
  font-size: 14px;
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.schedule-text-end {
  text-align: right;
  padding-right: 4px;
  font-size: 12px;
}

.resize-handle {
  position: absolute;
  top: 0;
  width: 20px;
  height: 100%;
  cursor: ew-resize;
  z-index: 30;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: auto;
}

.resize-handle-left {
  left: 0;
}

.resize-handle-right {
  right: 0;
}
</style>

