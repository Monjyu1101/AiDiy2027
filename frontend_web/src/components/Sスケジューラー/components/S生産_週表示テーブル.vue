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

interface 工程型 {
  生産工程ID: string
  生産工程名: string
  生産工程備考?: string
}

interface 生産型 {
  生産伝票ID: string
  生産開始日時: string
  生産終了日時: string
  生産工程ID: string
  生産区分ID: string
  生産区分名?: string
  生産内容?: string
  生産備考?: string
  配色枠?: string
  配色背景?: string
  配色前景?: string
  [key: string]: any
}

const props = defineProps({
  工程リスト: {
    type: Array as () => 工程型[],
    default: () => []
  },
  生産リスト: {
    type: Array as () => 生産型[],
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

  const grid = document.querySelector('.weekly-grid-seisan');
  if (!grid) return 0;

  const gridWidth = grid.getBoundingClientRect().width;
  const processColumnWidth = 150;
  const dateColumns = 10;
  const gap = 1;

  const totalGaps = 11;
  const availableWidth = gridWidth - processColumnWidth - (totalGaps * gap);
  const cellWidth = availableWidth / dateColumns;
  return cellWidth;
};

const SLOT_HEIGHT = 70;

const clearScheduleElements = () => {
  document.querySelectorAll('.schedule-item-seisan').forEach((item) => item.remove());
};

const resetCellHeights = () => {
  props.工程リスト.forEach((process) => {
    const processCell = document.getElementById(`process-cell-${process.生産工程ID}`);
    if (processCell) {
      processCell.style.height = `${SLOT_HEIGHT}px`;
      processCell.style.minHeight = `${SLOT_HEIGHT}px`;
    }
    for (const day of displayDates.value) {
      const cellId = `seisan-cell-${process.生産工程ID}-${day.dateStr}`;
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
  displayEndDate.setHours(23, 59, 59, 999);
  displayStartDate.setHours(0, 0, 0, 0);

  const displayRangeEnd = new Date(displayEndDate);
  displayRangeEnd.setDate(displayRangeEnd.getDate() + 1);
  displayRangeEnd.setHours(0, 0, 0, 0);

  // Phase 1: Pre-compute layout info
  const slotInfos: { schedule: any, dateCols: string[], lane: number }[] = [];
  const rowSlots = new Map<string, typeof slotInfos>();

  props.生産リスト.forEach((schedule) => {
    const startDateTime = new Date(schedule.生産開始日時);
    const endDateTime = new Date(schedule.生産終了日時);
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
    const rowKey = schedule.生産工程ID;
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
    const processCell = document.getElementById(`process-cell-${rowKey}`);
    if (processCell) {
      processCell.style.height = `${newHeight}px`;
      processCell.style.minHeight = `${newHeight}px`;
    }
    for (const day of displayDates.value) {
      const cellId = `seisan-cell-${rowKey}-${day.dateStr}`;
      const cell = document.getElementById(cellId);
      if (cell) {
        cell.style.height = `${newHeight}px`;
        cell.style.minHeight = `${newHeight}px`;
      }
    }
  }

  // Force reflow
  const grid = document.getElementById('weekly-grid-seisan');
  if (grid) void grid.offsetHeight;

  // Phase 3: Build lane map and render
  const scheduleLaneMap = new Map<string, number>();
  for (const info of slotInfos) {
    scheduleLaneMap.set(info.schedule.生産伝票ID, info.lane);
  }

  props.生産リスト.forEach((schedule) => {
    const startDateTime = new Date(schedule.生産開始日時);
    const endDateTime = new Date(schedule.生産終了日時);
    if (endDateTime < displayStartDate || startDateTime >= displayRangeEnd) return;
    const displayStart = new Date(Math.max(startDateTime.getTime(), displayStartDate.getTime()));
    const displayEnd = new Date(Math.min(endDateTime.getTime(), displayRangeEnd.getTime()));
    const lane = scheduleLaneMap.get(schedule.生産伝票ID) || 0;
    renderSchedule(schedule, startDateTime, endDateTime, displayStart, displayEnd, displayStartDate, displayRangeEnd, lane);
  });
};

const renderSchedule = (schedule, startDateTime, endDateTime, displayStart, displayEnd, rangeStart, rangeEnd, lane = 0) => {
  const processId = schedule.生産工程ID;
  const renderStartStr = formatDateISO(displayStart);

  const startCell = document.getElementById(`seisan-cell-${processId}-${renderStartStr}`);
  if (!startCell) return;

  const msPerDay = 24 * 60 * 60 * 1000;

  const dStart = new Date(displayStart);
  dStart.setHours(0,0,0,0);

  let currentDate = new Date(dStart);
  let visibleDays = 0;

  const dEnd = new Date(displayEnd);
  if (dEnd.getHours() === 0 && dEnd.getMinutes() === 0 && dEnd > dStart) {
      dEnd.setDate(dEnd.getDate() - 1);
  }
  dEnd.setHours(0,0,0,0);

  while (currentDate <= dEnd) {
      const cellId = `seisan-cell-${processId}-${formatDateISO(currentDate)}`;
      if (document.getElementById(cellId)) {
          visibleDays++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
  }

  if (visibleDays === 0) return;

  const originalStartDate = new Date(startDateTime); originalStartDate.setHours(0,0,0,0);
  const rangeTitleStart = new Date(rangeStart); rangeTitleStart.setHours(0,0,0,0);
  const isStartOverflow = originalStartDate < rangeTitleStart;

  const originalEndDate = new Date(endDateTime); originalEndDate.setHours(0,0,0,0);
  const rangeTitleEnd = new Date(rangeEnd); rangeTitleEnd.setDate(rangeTitleEnd.getDate() - 1); rangeTitleEnd.setHours(0,0,0,0);
  const isEndOverflow = originalEndDate > rangeTitleEnd;

  let startTimeStr = `${formatDate(startDateTime)} ${formatTime(startDateTime)}`;
  let endTimeStr = `～${formatDate(endDateTime)} ${formatTime(endDateTime)}`;
  if (isStartOverflow) {
    startTimeStr = `\u25c0${formatDate(startDateTime)} ${formatTime(startDateTime)}`;
  }
  if (isEndOverflow) {
    endTimeStr = `～${formatDate(endDateTime)} ${formatTime(endDateTime)}\u25b6`;
  }

  const categoryName = schedule.生産区分名 || '';
  const 商品名 = schedule.商品名 || '';
  const 受入数量 = schedule.受入数量 != null ? schedule.受入数量 : '';
  const 単位 = schedule.単位 || '';
  const centerText = 商品名 ? `${商品名} (${受入数量} ${単位})` : (schedule.生産内容 || '');
  const borderColor = schedule.配色枠 || '#0056b3';
  const backgroundColor = schedule.配色背景 || '#007bff';
  const textColor = schedule.配色前景 || '#ffffff';

  const cellWidth = getCellWidth();
  if (cellWidth === 0) return;

  const gapWidth = 1;
  const totalWidth = (cellWidth * visibleDays) + (gapWidth * (visibleDays - 1));

  const grid = document.getElementById('weekly-grid-seisan');
  if (!grid) return;

  const gridRect = grid.getBoundingClientRect();
  const cellRect = startCell.getBoundingClientRect();

  const left = cellRect.left - gridRect.left;
  const top = cellRect.top - gridRect.top + lane * SLOT_HEIGHT;

  const scheduleElement = document.createElement('div');
  scheduleElement.className = 'schedule-item-seisan';
  scheduleElement.setAttribute('data-生産伝票ID', schedule.生産伝票ID);
  scheduleElement.title = schedule.生産内容 || '';
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
    <div class="schedule-text schedule-text-center">${centerText || '&nbsp;'}</div>
    <div class="schedule-text schedule-text-end">${endTimeStr}</div>
  `;

  scheduleElement.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    emit('open-edit-form', schedule.生産伝票ID);
  });
  scheduleElement.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  scheduleElement.addEventListener('dragstart', (event) => {
    draggingScheduleId = schedule.生産伝票ID;
    event.dataTransfer?.setData('text/plain', schedule.生産伝票ID);
    requestAnimationFrame(() => {
      const g = document.getElementById('weekly-grid-seisan');
      if (g) g.classList.add('dragging-active');
    });
  });
  scheduleElement.addEventListener('dragend', () => {
    draggingScheduleId = null;
    const g = document.getElementById('weekly-grid-seisan');
    if (g) g.classList.remove('dragging-active');
  });
  scheduleElement.draggable = true;

  if (!isStartOverflow) {
    const leftHandle = document.createElement('div');
    leftHandle.className = 'resize-handle resize-handle-left';
    leftHandle.addEventListener('pointerdown', (event) => {
      startResize(event, schedule, 'left', scheduleElement);
    });
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
      renderSchedules();
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
};

const handleDrop = (event, processId, dateStr) => {
  event.preventDefault();
  const scheduleId = event.dataTransfer?.getData('text/plain') || draggingScheduleId;
  if (!scheduleId) return;
  emit('update-schedule-drop', { scheduleId, processId, dateStr });
};

const openProductionScheduleForm = (processId, dateStr) => {
  emit('open-edit-form', null, processId, dateStr);
};

watch(() => props.生産リスト, () => {
  nextTick(renderSchedules);
}, { deep: true });

watch(() => props.対象日付, () => {
  nextTick(renderSchedules);
});

onMounted(() => {
  setTimeout(renderSchedules, 100);
  window.addEventListener('resize', renderSchedules);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', renderSchedules);
  clearScheduleElements();
});
</script>

<template>
  <div class="weekly-grid-seisan" id="weekly-grid-seisan">
    <div class="grid-cell header-cell">工程</div>
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

    <template v-for="process in 工程リスト" :key="process.生産工程ID">
      <div class="grid-cell vehicle-cell" :id="`process-cell-${process.生産工程ID}`">
        <div class="vehicle-id">{{ process.生産工程ID }} {{ process.生産工程備考 || '' }}</div>
        <div class="vehicle-name">{{ process.生産工程名 }}</div>
      </div>
      <div
        v-for="day in displayDates"
        :key="`${process.生産工程ID}-${day.dateStr}`"
        :id="`seisan-cell-${process.生産工程ID}-${day.dateStr}`"
        class="grid-cell droppable-area empty-cell"
        :class="{
          'sunday-background': day.dayOfWeek === 0,
          'saturday-background': day.dayOfWeek === 6
        }"
        @dragover.prevent
        @drop="(event) => handleDrop(event, process.生産工程ID, day.dateStr)"
        @dblclick="openProductionScheduleForm(process.生産工程ID, day.dateStr)"
      ></div>
    </template>
  </div>
</template>

<style scoped>
.weekly-grid-seisan {
  display: grid;
  grid-template-columns: 150px repeat(10, 1fr);
  grid-gap: 1px;
  background-color: #ccc;
  border: 1px solid #ccc;
  height: auto;
  width: calc(100% - 25px);
  margin: 0 10px 10px 15px;
  position: relative;
  user-select: none;
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

.schedule-item-seisan {
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

.schedule-item-seisan:hover {
  z-index: 10;
}

.dragging-active .schedule-item-seisan {
  pointer-events: none;
}
</style>
