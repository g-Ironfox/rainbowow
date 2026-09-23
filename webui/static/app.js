const state = {
  crawlers: [],
  busy: false,
  crawlerMarkup: null,
  logMarkup: null,
  filterMarkup: null,
  firstCrawlerRender: true,
  paused: false,
  refreshTimer: null,
  editingCrawlerId: null,
  currentView: location.hash === "#/tasks" ? "tasks" : location.hash === "#/data" ? "data" : location.hash === "#/images" ? "images" : location.hash === "#/analysis" ? "analysis" : "fleet",
  taskMarkup: null,
  taskDetailTask: null,
  durationDistributionOptions: {},
  rawdataItems: [],
  rawdataNextBefore: null,
  rawdataMarkup: null,
  selectedRawdataId: null,
  imageCacheItems: [],
  imageCacheNextOffset: 0,
  imageCacheTotal: 0,
};

const elements = {
  crawlerList: document.querySelector("#crawlerList"),
  emptyState: document.querySelector("#emptyState"),
  logList: document.querySelector("#logList"),
  logFilter: document.querySelector("#logFilter"),
  totalCount: document.querySelector("#totalCount"),
  runningCount: document.querySelector("#runningCount"),
  idleCount: document.querySelector("#idleCount"),
  rawdataCount: document.querySelector("#rawdataCount"),
  lastRefresh: document.querySelector("#lastRefresh"),
  refreshState: document.querySelector("#refreshState"),
  refreshInterval: document.querySelector("#refreshInterval"),
  refreshIntervalPicker: document.querySelector("#refreshIntervalPicker"),
  refreshIntervalButton: document.querySelector("#refreshIntervalButton"),
  refreshIntervalValue: document.querySelector("#refreshIntervalValue"),
  refreshIntervalMenu: document.querySelector("#refreshIntervalMenu"),
  pauseButton: document.querySelector("#pauseButton"),
  refreshButton: document.querySelector("#refreshButton"),
  crawlerDialog: document.querySelector("#crawlerDialog"),
  createForm: document.querySelector("#createForm"),
  createError: document.querySelector("#createError"),
  crawlerDialogEyebrow: document.querySelector("#crawlerDialogEyebrow"),
  crawlerDialogTitle: document.querySelector("#crawlerDialogTitle"),
  submitCrawler: document.querySelector("#submitCrawler"),
  deleteCrawler: document.querySelector("#deleteCrawler"),
  timingDialog: document.querySelector("#timingDialog"),
  timingForm: document.querySelector("#timingForm"),
  timingError: document.querySelector("#timingError"),
  gotoDialog: document.querySelector("#gotoDialog"),
  gotoForm: document.querySelector("#gotoForm"),
  gotoError: document.querySelector("#gotoError"),
  imagePreviewDialog: document.querySelector("#imagePreviewDialog"),
  imagePreview: document.querySelector("#imagePreview"),
  fleetView: document.querySelector("#fleetView"),
  dataView: document.querySelector("#dataView"),
  imagesView: document.querySelector("#imagesView"),
  tasksView: document.querySelector("#tasksView"),
  analysisView: document.querySelector("#analysisView"),
  analysisContent: document.querySelector("#analysisContent"),
  analysisEmptyState: document.querySelector("#analysisEmptyState"),
  analysisCrawlerFilter: document.querySelector("#analysisCrawlerFilter"),
  analysisCount: document.querySelector("#analysisCount"),
  analysisZoom: document.querySelector("#analysisZoom"),
  analysisZoomValue: document.querySelector("#analysisZoomValue"),
  rawdataList: document.querySelector("#rawdataList"),
  dataEmptyState: document.querySelector("#dataEmptyState"),
  dataTotalCount: document.querySelector("#dataTotalCount"),
  dataPagination: document.querySelector("#dataPagination"),
  loadMoreData: document.querySelector("#loadMoreData"),
  dataDetailDialog: document.querySelector("#dataDetailDialog"),
  dataDetailTitle: document.querySelector("#dataDetailTitle"),
  dataDetailContent: document.querySelector("#dataDetailContent"),
  deleteRawdata: document.querySelector("#deleteRawdata"),
  taskList: document.querySelector("#taskList"),
  taskEmptyState: document.querySelector("#taskEmptyState"),
  taskCrawlerFilter: document.querySelector("#taskCrawlerFilter"),
  taskStatusFilter: document.querySelector("#taskStatusFilter"),
  taskCount: document.querySelector("#taskCount"),
  taskSuccessRate: document.querySelector("#taskSuccessRate"),
  taskAverageExecution: document.querySelector("#taskAverageExecution"),
  taskWaitRatio: document.querySelector("#taskWaitRatio"),
  taskDetailDialog: document.querySelector("#taskDetailDialog"),
  taskDetailTitle: document.querySelector("#taskDetailTitle"),
  taskDetailContent: document.querySelector("#taskDetailContent"),
  toast: document.querySelector("#toast"),
  imageCacheGrid: document.querySelector("#imageCacheGrid"),
  imageCacheEmptyState: document.querySelector("#imageCacheEmptyState"),
  imageCacheCount: document.querySelector("#imageCacheCount"),
  imageCachePagination: document.querySelector("#imageCachePagination"),
  loadMoreImages: document.querySelector("#loadMoreImages"),
};

const statusLabels = { running: "运行中", idle: "空闲", stopped: "已停止", error: "状态异常" };
const taskStatusLabels = { queued: "排队中", running: "执行中", completed: "已完成", failed: "失败", cancelled: "已取消" };
const operationStatusLabels = { running: "执行中", completed: "已完成", failed: "失败", skipped: "已跳过" };
const waitStageLabels = { initial: "首次加载", scroll: "滚动加载", post: "帖子交互", detail_open: "打开详情", detail_close: "关闭详情", error_recovery: "异常恢复" };

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || `请求失败 (${response.status})`);
  return body;
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.className = `toast visible${isError ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.className = "toast", 2600);
}

function formatTime(timestamp) {
  if (!timestamp) return "--:--:--";
  return new Date(timestamp * 1000).toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDateTime(timestamp) {
  if (!timestamp) return "---- -- --\n--:--:--";
  const date = new Date(timestamp * 1000);
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];
  return `${parts[0]}-${parts[1]}-${parts[2]}\n${parts[3]}:${parts[4]}:${parts[5]}`;
}

function getRawdataTitle(item) {
  return item.title || item.text || item.name || "未命名帖子";
}

function getRawdataContent(item) {
  return item.content || item.desc || item.description || "暂无正文";
}

function getRawdataTimestamp(item) {
  if (item.timestamp) return Number(item.timestamp);
  if (/^[0-9a-f]{24}$/i.test(item._id || "")) return Number.parseInt(item._id.slice(0, 8), 16);
  return null;
}

function getRawdataImageUrl(item) {
  if (typeof item.img !== "string") return null;
  return item.img.startsWith("/api/images/") || item.img.startsWith("data:")
    ? item.img
    : null;
}

function renderRawdata() {
  elements.dataEmptyState.hidden = state.rawdataItems.length > 0;
  elements.dataPagination.hidden = !state.rawdataNextBefore;
  const markup = state.rawdataItems.map(item => {
    const title = getRawdataTitle(item);
    const content = getRawdataContent(item);
    const imageUrl = getRawdataImageUrl(item);
    const interaction = [item.like && `赞 ${item.like}`, item.comments_count].filter(Boolean).join(" · ") || "--";
    return `
      <tr tabindex="0" data-rawdata-id="${escapeHtml(item._id)}">
        <td>${imageUrl ? `<img class="data-thumbnail" src="${escapeHtml(imageUrl)}" alt="" loading="lazy">` : `<span class="data-thumbnail-placeholder">无图</span>`}</td>
        <td><strong class="data-title" title="${escapeHtml(title)}">${escapeHtml(title)}</strong><span class="data-content" title="${escapeHtml(content)}">${escapeHtml(content)}</span></td>
        <td><span class="data-source">${escapeHtml(item.crawler_id || item.source || "未知")}</span><small class="data-source-detail">${item.task_id ? "任务关联" : escapeHtml(item.source || "历史数据")}</small></td>
        <td class="data-interaction">${escapeHtml(interaction)}</td>
        <td class="data-time">${formatDateTime(getRawdataTimestamp(item)).replace("\n", " ")}</td>
      </tr>`;
  }).join("");
  if (markup !== state.rawdataMarkup) {
    elements.rawdataList.innerHTML = markup;
    state.rawdataMarkup = markup;
  }
}

async function loadRawdata({ append = false, refresh = false, silent = false } = {}) {
  try {
    const params = new URLSearchParams({ limit: "100" });
    if (append && state.rawdataNextBefore) params.set("before", state.rawdataNextBefore);
    const result = await api(`/api/rawdata?${params}`);
    if (append) {
      state.rawdataItems = [...state.rawdataItems, ...result.items];
      state.rawdataNextBefore = result.next_before;
    } else if (refresh && state.rawdataItems.length) {
      const latestIds = new Set(result.items.map(item => item._id));
      state.rawdataItems = [
        ...result.items,
        ...state.rawdataItems.filter(item => !latestIds.has(item._id)),
      ];
    } else {
      state.rawdataItems = result.items;
      state.rawdataNextBefore = result.next_before;
    }
    renderRawdata();
  } catch (error) {
    if (!silent) showToast(error.message, true);
    throw error;
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function renderImageUrlDetails(item, expandedIds) {
  const value = item.url;
  if (!value) return `<span class="image-cache-url-empty">无来源 URL</span>`;
  try {
    const parsed = new URL(value);
    const label = `${parsed.hostname}${parsed.pathname}`;
    const parameters = [...parsed.searchParams.entries()];
    return `
      <details class="image-cache-url" data-image-url-id="${escapeHtml(item._id)}"${expandedIds.has(item._id) ? " open" : ""}>
        <summary title="${escapeHtml(value)}">${escapeHtml(label)}</summary>
        <a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>
        ${parameters.length ? `<dl>${parameters.map(([key, parameterValue]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(parameterValue)}</dd></div>`).join("")}</dl>` : `<span class="image-cache-url-empty">无查询参数</span>`}
      </details>`;
  } catch {
    return `<div class="image-cache-url-raw">${escapeHtml(value)}</div>`;
  }
}

function renderImageCache() {
  const expandedIds = new Set(
    [...elements.imageCacheGrid.querySelectorAll("details[open][data-image-url-id]")]
      .map(details => details.dataset.imageUrlId),
  );
  const scrollTop = elements.imageCacheGrid.scrollTop;
  elements.imageCacheCount.textContent = state.imageCacheTotal.toLocaleString("zh-CN");
  elements.imageCacheEmptyState.hidden = state.imageCacheItems.length > 0;
  elements.imageCachePagination.hidden = state.imageCacheItems.length === 0 || state.imageCacheNextOffset >= state.imageCacheTotal;
  elements.imageCacheGrid.innerHTML = state.imageCacheItems.map(item => `
    <article class="image-cache-card">
      <a href="${escapeHtml(item.image_url)}" target="_blank" rel="noopener noreferrer" class="image-cache-preview">
        <img src="${escapeHtml(item.image_url)}" alt="缓存图片" loading="lazy">
      </a>
      <div class="image-cache-meta">
        <strong>${Number(item.hit_count || 0).toLocaleString("zh-CN")} 次命中</strong>
        <span>${escapeHtml(item.content_type || "未知类型")} · ${formatBytes(item.size)}</span>
        <small>${formatDateTime(item.created_at).replace("\n", " ")}</small>
        ${renderImageUrlDetails(item, expandedIds)}
      </div>
    </article>`).join("");
  elements.imageCacheGrid.scrollTop = scrollTop;
}

async function loadImageCache({ append = false, refresh = false, silent = false } = {}) {
  try {
    const offset = append ? state.imageCacheNextOffset : 0;
    const result = await api(`/api/image-cache?limit=100&offset=${offset}`);
    if (append) {
      const existingIds = new Set(state.imageCacheItems.map(item => item._id));
      state.imageCacheItems = [...state.imageCacheItems, ...result.items.filter(item => !existingIds.has(item._id))];
    } else if (refresh && state.imageCacheItems.length) {
      const latestIds = new Set(result.items.map(item => item._id));
      state.imageCacheItems = [
        ...result.items,
        ...state.imageCacheItems.filter(item => !latestIds.has(item._id)),
      ];
    } else {
      state.imageCacheItems = result.items;
    }
    state.imageCacheNextOffset = state.imageCacheItems.length;
    state.imageCacheTotal = result.total;
    renderImageCache();
  } catch (error) {
    if (!silent) showToast(error.message, true);
    throw error;
  }
}

function openRawdataDetail(item) {
  const title = getRawdataTitle(item);
  const imageUrl = getRawdataImageUrl(item);
  const postUrl = item.source === "xhs" && item.id
    ? `https://www.xiaohongshu.com/explore/${encodeURIComponent(item.id)}`
    : null;
  state.selectedRawdataId = item._id;
  elements.dataDetailTitle.textContent = title;
  elements.dataDetailContent.innerHTML = `
    <div class="data-detail-summary">
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}">` : ""}
      <div><p>${escapeHtml(getRawdataContent(item))}</p>${postUrl ? `<a href="${postUrl}" target="_blank" rel="noopener noreferrer">打开原帖</a>` : ""}</div>
    </div>
    <section class="data-json-section"><h3>完整记录</h3><pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre></section>`;
  elements.dataDetailDialog.showModal();
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "--";
  if (seconds < 60) return `${seconds.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}

function formatFinalTaskDuration(task, field) {
  if (["queued", "running"].includes(task.status)) return "--";
  return formatDuration(task[field]);
}

function renderDurationDistribution(samples, config, options = {}) {
  const values = samples
    .map(Number)
    .filter(value => Number.isFinite(value) && value >= 0);
  if (!values.length) {
    return `<section class="task-detail-section duration-distribution-panel" data-distribution-chart="${config.key}"><div class="task-detail-section-heading"><h3>${config.title}</h3><span>暂无${config.sampleName}样本</span></div></section>`;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
  const median = percentile(.5);
  const maximum = sorted[sorted.length - 1];
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const format = value => `${value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}s`;
  const left = 34;
  const right = 356;
  const top = 14;
    const bottom = 166;
    const plotHeight = 126;
  const binDuration = Math.max(0.1, Number(options.binDurationSeconds) || 5);
  const binCount = Math.max(1, Math.ceil(maximum / binDuration));
  const axisMaximum = binCount * binDuration;
  const position = value => left + Math.min(1, Math.max(0, value / axisMaximum)) * (right - left);
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: index * binDuration,
    end: (index + 1) * binDuration,
    count: 0,
  }));
  values.forEach(value => bins[Math.min(binCount - 1, Math.floor(value / binDuration))].count += 1);
  const peak = Math.max(...bins.map(bin => bin.count), 1);
  const chartWidth = right - left;
  const barWidth = chartWidth / binCount;
  const bars = bins.map((bin, index) => {
    const height = (bin.count / peak) * plotHeight;
    return `<rect class="active-distribution-bar" x="${(left + index * barWidth).toFixed(2)}" y="${(bottom - height).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}"><title>${format(bin.start)} - ${format(bin.end)}：${bin.count} 个${config.sampleName}</title></rect>`;
  }).join("");
  const yTickCount = Math.min(4, peak);
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, index) => {
    const value = Math.round(peak * index / yTickCount);
      const y = bottom - plotHeight * index / yTickCount;
    return `<line class="active-distribution-grid" x1="${left}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}"></line><text class="active-distribution-y-label" x="${left - 6}" y="${(y + 3).toFixed(2)}" text-anchor="end">${value}</text>`;
  }).join("");
  const minimumTickSpacing = 42;
  const maximumTickCount = Math.max(2, Math.floor((right - left) / minimumTickSpacing));
  const tickDuration = Math.max(1, Math.ceil(axisMaximum / maximumTickCount));
  const tickValues = Array.from(
    { length: Math.floor(axisMaximum) + 1 },
    (_, index) => index,
  );
  const xTicks = tickValues.map(value => {
    const x = position(value);
    const label = value % tickDuration === 0
      ? `<text class="active-distribution-x-label" x="${x.toFixed(2)}" y="184" text-anchor="middle">${format(value)}</text>`
      : "";
    return `<line class="active-distribution-tick" x1="${x.toFixed(2)}" y1="${bottom}" x2="${x.toFixed(2)}" y2="${bottom + 4}"></line>${label}`;
  }).join("");
  return `
    <section class="task-detail-section duration-distribution-panel" data-distribution-chart="${config.key}"><div class="task-detail-section-heading"><div><h3>${config.title}</h3><span>${values.length} 个样本</span></div><label class="active-distribution-setting">每柱时长 <output data-distribution-output="binDurationSeconds">${format(binDuration)}</output><input data-distribution-option="binDurationSeconds" type="number" min="0.1" max="3600" step="0.5" value="${binDuration}"></label></div>
      <div class="active-distribution-wrap">
        <svg class="active-distribution" viewBox="0 0 390 220" role="img" aria-label="${config.title}，横轴为${config.axisName}，纵轴为${config.sampleName}数量">
          <text class="active-distribution-axis-title" x="8" y="14" text-anchor="middle" transform="rotate(-90 8 14)">${config.sampleName}数</text>
          ${yTicks}
          <line class="active-distribution-axis" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}"></line>
          ${bars}
          ${xTicks}
            <text class="active-distribution-axis-title" x="195" y="211" text-anchor="middle">${config.axisName}（秒）</text>
        </svg>
        <div class="active-distribution-legend"><span><i class="sample"></i>采样频数</span><span>中位数 ${format(median)}</span><span>均值 ${format(mean)}</span><span>最大值 ${format(maximum)}</span></div>
      </div>
    </section>`;
}

function renderDurationDistributions(operations, waits) {
  const charts = [
    {
      samples: operations.map(operation => operation.active_seconds),
      config: { key: "active", title: "耗时分布", axisName: "耗时", sampleName: "操作" },
    },
    {
      samples: waits.map(wait => wait.actual_seconds),
      config: { key: "wait", title: "停顿分布", axisName: "停顿时长", sampleName: "停顿" },
    },
  ];
  return `<div class="duration-distribution-grid">${charts.map(chart => renderDurationDistribution(
    chart.samples,
    chart.config,
    state.durationDistributionOptions[chart.config.key],
  )).join("")}</div>`;
}

function renderNonWaitDistribution(operations) {
  const values = operations
    .map(operation => Number(operation.active_seconds))
    .filter(value => Number.isFinite(value) && value >= 0);
  if (!values.length) {
    return `<section class="task-detail-section non-wait-distribution"><div class="task-detail-section-heading"><h3>非停顿时间分布</h3><span>暂无非停顿样本</span></div></section>`;
  }

  const left = 8;
  const chartWidth = Math.max(348, left + 24 + Math.max(0, values.length - 1) * 32);
  const right = chartWidth - 24;
  const top = 14;
  const bottom = 166;
  const maximum = Math.max(...values, 1);
  const roughTickStep = maximum / 5;
  const tickMagnitude = 10 ** Math.floor(Math.log10(roughTickStep));
  const normalizedTickStep = roughTickStep / tickMagnitude;
  const tickFactor = normalizedTickStep <= 1 ? 1 : normalizedTickStep <= 2 ? 2 : normalizedTickStep <= 5 ? 5 : 10;
  const tickStep = Math.max(1, tickFactor * tickMagnitude);
  const axisMaximum = Math.max(4, Math.ceil(maximum / tickStep) * tickStep);
  const positionX = index => left + (values.length === 1 ? (right - left) / 2 : index / (values.length - 1) * (right - left));
  const positionY = value => bottom - value / axisMaximum * (bottom - top);
  const points = values.map((value, index) => `${positionX(index).toFixed(2)},${positionY(value).toFixed(2)}`).join(" ");
  const pointMarkup = values.map((value, index) => `<circle class="non-wait-distribution-point" cx="${positionX(index).toFixed(2)}" cy="${positionY(value).toFixed(2)}" r="3"><title>操作 #${index + 1} · ${formatDuration(value)}</title></circle>`).join("");
  const yTickValues = Array.from({ length: Math.round(axisMaximum / tickStep) + 1 }, (_, index) => index * tickStep);
  const yGridLines = yTickValues.map(value => {
    const y = positionY(value);
    return `<line class="non-wait-distribution-grid" x1="0" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}"></line>`;
  }).join("");
  const yLabels = yTickValues.map(value => {
    const y = positionY(value);
    return `<text class="non-wait-distribution-label" x="36" y="${(y + 3).toFixed(2)}" text-anchor="end">${value}s</text>`;
  }).join("");
  const xLabels = values.map((value, index) => `<text class="non-wait-distribution-label" x="${positionX(index).toFixed(2)}" y="184" text-anchor="middle">#${index + 1}</text>`).join("");
  return `
    <section class="task-detail-section non-wait-distribution"><div class="task-detail-section-heading"><div><h3>非停顿时间分布</h3><span>${values.length} 个操作样本</span></div><span>按浏览操作顺序</span></div>
      <div class="active-distribution-wrap non-wait-distribution-wrap">
        <div class="non-wait-distribution-frame">
          <svg class="non-wait-distribution-y-axis" viewBox="0 0 42 194" aria-hidden="true">
            ${yLabels}
          </svg>
          <div class="non-wait-distribution-scroll">
            <svg class="active-distribution non-wait-distribution-chart" style="width:${chartWidth}px" viewBox="0 0 ${chartWidth} 194" role="img" aria-label="非停顿时间分布折线图，横轴为浏览操作，纵轴为非停顿时间">
              ${yGridLines}
              <line class="active-distribution-axis" x1="0" y1="${bottom}" x2="${right}" y2="${bottom}"></line>
              <polyline class="non-wait-distribution-line" points="${points}"></polyline>
              ${pointMarkup}
              ${xLabels}
            </svg>
          </div>
        </div>
        <div class="non-wait-distribution-footer">
          <div class="active-distribution-legend"><span><i class="non-wait-sample"></i>非停顿耗时</span><span>平均 ${formatDuration(values.reduce((total, value) => total + value, 0) / values.length)}</span><span>最大 ${formatDuration(maximum)}</span></div>
          <div class="non-wait-distribution-axis-caption">浏览操作</div>
        </div>
      </div>
    </section>`;
}

function renderTaskTimeline(task, operations, waits) {
  const now = Date.now() / 1000;
  const timelineStart = task.enqueued_at;
  if (!timelineStart) return "";
  const timelineEnd = Math.max(
    task.finished_at || 0,
    task.started_at ? task.started_at + (task.execution_seconds || 0) : 0,
    task.finished_at ? 0 : now,
    timelineStart + 1,
  );
  const timelineDuration = timelineEnd - timelineStart;
  const getPosition = timestamp => Math.max(0, Math.min(100, ((timestamp - timelineStart) / timelineDuration) * 100));
  const getWidth = (start, end) => {
    const left = getPosition(start);
    return Math.min(100 - left, Math.max(0.35, ((end - start) / timelineDuration) * 100));
  };
  const renderBar = (start, end, className, label, title) => {
    if (!start || !end || end <= start) return "";
    return `<span class="task-timeline-bar ${className}" style="left:${getPosition(start)}%;width:${getWidth(start, end)}%" title="${escapeHtml(title)}"><span>${escapeHtml(label)}</span></span>`;
  };
  const executionEnd = task.finished_at || now;
  const queueEnd = task.started_at || task.finished_at || now;
  const queueSeconds = task.queue_seconds ?? (queueEnd - task.enqueued_at);
  const executionSeconds = task.finished_at ? (task.execution_seconds ?? (executionEnd - task.started_at)) : executionEnd - task.started_at;
  const queueBar = renderBar(task.enqueued_at, queueEnd, "queue", "排队", `排队 ${formatDuration(queueSeconds)}`);
  const executionBar = task.started_at ? renderBar(task.started_at, executionEnd, "execution", "执行", `执行 ${formatDuration(executionSeconds)}`) : "";
  const operationBars = operations.map(operation => {
    const end = operation.finished_at || now;
    return renderBar(operation.started_at, end, "operation", `#${operation.index + 1}`, `浏览操作 #${operation.index + 1} · ${formatDuration(operation.elapsed_seconds ?? (end - operation.started_at))}`);
  }).join("");
  const waitBars = waits.map(wait => {
    const end = wait.started_at + (wait.actual_seconds || 0);
    const operationLabel = wait.operation_index === null ? "任务级" : `#${wait.operation_index + 1}`;
    return renderBar(wait.started_at, end, "wait", "", `${waitStageLabels[wait.stage] || wait.stage} · ${operationLabel} · ${formatDuration(wait.actual_seconds)}`);
  }).join("");
  const segmentCount = operations.length + waits.length + 2;
  const trackMinWidth = Math.max(760, Math.min(6000, segmentCount * 18));
  const intervalCount = Math.max(4, Math.round(trackMinWidth / 180));
  const ticks = Array.from({ length: intervalCount + 1 }, (_, index) => {
    const timestamp = timelineStart + (timelineDuration * index) / intervalCount;
    return `<span style="left:${getPosition(timestamp)}%">${formatTime(timestamp)}</span>`;
  }).join("");
  return `
    <section class="task-detail-section task-timeline-section"><div class="task-detail-section-heading"><h3>时间占用</h3><span>从入队到${task.finished_at ? "结束" : "当前"} · 共 ${segmentCount} 段</span></div>
      <div class="task-timeline-wrap" style="--timeline-min:${trackMinWidth}px;--grid-step:${(100 / intervalCount).toFixed(4)}%">
        <div class="task-timeline-axis">${ticks}</div>
        <div class="task-timeline-row"><span class="task-timeline-label">任务</span><div class="task-timeline-track">${queueBar}${executionBar}</div></div>
        <div class="task-timeline-row"><span class="task-timeline-label">浏览</span><div class="task-timeline-track">${operationBars || `<span class="task-timeline-empty">暂无操作</span>`}</div></div>
        <div class="task-timeline-row"><span class="task-timeline-label">停顿</span><div class="task-timeline-track">${waitBars || `<span class="task-timeline-empty">暂无停顿</span>`}</div></div>
        <div class="task-timeline-legend"><span><i class="queue"></i>排队</span><span><i class="execution"></i>执行</span><span><i class="operation"></i>浏览操作范围</span><span><i class="wait"></i>主动停顿</span></div>
      </div>
    </section>`;
}

function closeCrawlerActionMenus() {
  elements.crawlerList.querySelectorAll(".action-menu.open").forEach(menu => {
    menu.classList.remove("open");
    menu.querySelector(".action-menu-trigger").setAttribute("aria-expanded", "false");
    menu.querySelector(".action-menu-list").hidden = true;
  });
}

function renderCrawlers() {
  elements.totalCount.textContent = state.crawlers.length;
  elements.runningCount.textContent = state.crawlers.filter(item => item.status === "running").length;
  elements.idleCount.textContent = state.crawlers.filter(item => item.status === "idle").length;
  elements.emptyState.hidden = state.crawlers.length > 0;
  const crawlerMarkup = state.crawlers.map(crawler => {
    const active = ["running", "idle"].includes(crawler.status);
    const lastMessage = crawler.last_log
      ? `${crawler.last_log.message}${crawler.last_log.detail ? ` · ${crawler.last_log.detail}` : ""}`
      : "暂无日志";
    return `
      <article class="crawler-card">
        <div class="crawler-title">
          <span class="status-dot ${crawler.status}"></span>
          <div><strong>${escapeHtml(crawler.crawler_id)}</strong><span>${statusLabels[crawler.status]}</span></div>
        </div>
        <div class="crawler-meta">
          <strong title="${escapeHtml(crawler.user_data_dir)}">${escapeHtml(crawler.user_data_dir)}</strong>
          <span>${escapeHtml(lastMessage)} · ${formatTime(crawler.last_log?.timestamp)}</span>
        </div>
        <div class="crawler-actions">
          <button class="action-button" data-action="edit" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "disabled" : ""}>编辑</button>
          <button class="action-button" data-action="timing" data-id="${escapeHtml(crawler.crawler_id)}">等待设置</button>
          <button class="action-button" data-action="launch" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "disabled" : ""}>启动</button>
          <button class="action-button danger" data-action="terminate" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "" : "disabled"}>停止</button>
          <div class="action-menu">
            <button class="action-button action-menu-trigger" type="button" data-menu-toggle aria-haspopup="menu" aria-expanded="false" ${active ? "" : "disabled"}>操作<span class="action-menu-chevron" aria-hidden="true"></span></button>
            <div class="action-menu-list" role="menu" hidden>
              <button type="button" role="menuitem" data-action="goto" data-id="${escapeHtml(crawler.crawler_id)}">跳转</button>
              <button type="button" role="menuitem" data-action="surface" data-id="${escapeHtml(crawler.crawler_id)}">浏览</button>
              <button type="button" role="menuitem" data-action="scroll" data-id="${escapeHtml(crawler.crawler_id)}">滚动</button>
              <button type="button" role="menuitem" data-action="screenshot" data-id="${escapeHtml(crawler.crawler_id)}">截屏</button>
              <button type="button" role="menuitem" data-action="screenshot-priority" data-id="${escapeHtml(crawler.crawler_id)}">截屏(插队)</button>
            </div>
          </div>
        </div>
      </article>`;
  }).join("");
  if (crawlerMarkup !== state.crawlerMarkup) {
    elements.crawlerList.innerHTML = crawlerMarkup;
    if (state.firstCrawlerRender) {
      elements.crawlerList.querySelectorAll(".crawler-card").forEach((card, index) => {
        card.classList.add("reveal");
        card.style.animationDelay = `${index * 35}ms`;
      });
    }
    state.crawlerMarkup = crawlerMarkup;
  }
  state.firstCrawlerRender = false;

  const selected = elements.logFilter.value;
  const selectedTaskCrawler = elements.taskCrawlerFilter.value;
  const selectedAnalysisCrawler = elements.analysisCrawlerFilter.value;
  const filterMarkup = `<option value="">全部爬虫</option>${state.crawlers.map(crawler => `<option value="${escapeHtml(crawler.crawler_id)}">${escapeHtml(crawler.crawler_id)}</option>`).join("")}`;
  if (filterMarkup !== state.filterMarkup) {
    elements.logFilter.innerHTML = filterMarkup;
    elements.taskCrawlerFilter.innerHTML = filterMarkup;
    elements.analysisCrawlerFilter.innerHTML = filterMarkup;
    state.filterMarkup = filterMarkup;
    if (state.crawlers.some(crawler => crawler.crawler_id === selected)) elements.logFilter.value = selected;
    if (state.crawlers.some(crawler => crawler.crawler_id === selectedTaskCrawler)) elements.taskCrawlerFilter.value = selectedTaskCrawler;
    if (state.crawlers.some(crawler => crawler.crawler_id === selectedAnalysisCrawler)) elements.analysisCrawlerFilter.value = selectedAnalysisCrawler;
    if (!selectedAnalysisCrawler && state.crawlers.length === 1) elements.analysisCrawlerFilter.value = state.crawlers[0].crawler_id;
  }
}

function renderTasks(tasks, summary) {
  elements.taskCount.textContent = summary.task_count.toLocaleString("zh-CN");
  elements.taskSuccessRate.textContent = `${(summary.success_rate * 100).toFixed(1)}%`;
  elements.taskAverageExecution.textContent = formatDuration(summary.average_execution_seconds);
  elements.taskWaitRatio.textContent = `${(summary.wait_ratio * 100).toFixed(1)}%`;
  elements.taskEmptyState.hidden = tasks.length > 0;
  const markup = tasks.map(task => `
    <tr tabindex="0" data-task-id="${escapeHtml(task._id)}">
      <td>${formatDateTime(task.enqueued_at).replace("\n", " ")}</td>
      <td title="${escapeHtml(task.crawler_id)}">${escapeHtml(task.crawler_id)}</td>
      <td><span class="task-status ${task.status}">${taskStatusLabels[task.status] || escapeHtml(task.status)}</span></td>
      <td>${formatDuration(task.queue_seconds)}</td>
      <td>${formatFinalTaskDuration(task, "execution_seconds")}</td>
      <td>${formatDuration(task.wait_seconds)} <small>${task.wait_count || 0} 次</small></td>
      <td>${formatFinalTaskDuration(task, "active_seconds")}</td>
      <td>${task.operation_count || 0}</td>
      <td>${task.result?.inserted_count ?? "--"}</td>
      <td>${["queued", "running"].includes(task.status)
        ? `<button class="task-action-button cancel" type="button" data-cancel-task="${escapeHtml(task._id)}">结束任务</button>`
        : `<button class="task-action-button delete" type="button" data-delete-task="${escapeHtml(task._id)}">删除记录</button>`}</td>
    </tr>`).join("");
  if (markup !== state.taskMarkup) {
    elements.taskList.innerHTML = markup;
    state.taskMarkup = markup;
  }
}

function renderAnalysisHistogram(values, title, color) {
  const valid = values.map(Number).filter(value => Number.isFinite(value) && value >= 0);
  if (!valid.length) return `<section class="analysis-chart"><h3>${title}</h3><p class="analysis-empty">暂无数据</p></section>`;
  const maximum = Math.max(...valid, 1);
  const binSize = Math.max(1, Math.ceil(maximum / 5));
  const bins = Array.from({ length: Math.max(1, Math.ceil(maximum / binSize)) }, () => 0);
  valid.forEach(value => bins[Math.min(bins.length - 1, Math.floor(value / binSize))] += 1);
  const peak = Math.max(...bins, 1);
  const bars = bins.map((count, index) => {
    const height = count / peak * 132;
    const x = 36 + index * (320 / bins.length);
    return `<rect x="${x.toFixed(1)}" y="${156 - height.toFixed(1)}" width="${Math.max(4, 300 / bins.length).toFixed(1)}" height="${height.toFixed(1)}" fill="${color}"><title>${index * binSize}s - ${(index + 1) * binSize}s：${count} 次</title></rect>`;
  }).join("");
  return `<section class="analysis-chart"><h3>${title}</h3><svg viewBox="0 0 360 190" role="img" aria-label="${title}"><line class="analysis-axis" x1="30" y1="156" x2="342" y2="156"></line>${bars}<text x="30" y="178">0s</text><text x="342" y="178" text-anchor="end">${Math.ceil(maximum)}s</text></svg><span class="analysis-chart-note">${valid.length} 个任务样本 · 平均 ${formatDuration(valid.reduce((sum, value) => sum + value, 0) / valid.length)}</span></section>`;
}

function renderAnalysisTrend(tasks) {
  const values = tasks.map(task => [Number(task.execution_seconds) || 0, Number(task.wait_seconds) || 0, Number(task.active_seconds) || 0]);
  if (!values.length) return `<section class="analysis-chart analysis-trend"><h3>任务耗时趋势</h3><p class="analysis-empty">暂无数据</p></section>`;
  const maximum = Math.max(...values.flat(), 1);
  const x = index => 32 + (index / Math.max(1, values.length - 1)) * 306;
  const y = value => 154 - value / maximum * 124;
  const line = (index, color, label) => {
    const points = values.map((entry, pointIndex) => `${x(pointIndex).toFixed(1)},${y(entry[index]).toFixed(1)}`).join(" ");
    const dots = values.map((entry, pointIndex) => `<circle cx="${x(pointIndex).toFixed(1)}" cy="${y(entry[index]).toFixed(1)}" r="3" fill="${color}"><title>${label} #${pointIndex + 1}：${formatDuration(entry[index])}</title></circle>`).join("");
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"></polyline>${dots}`;
  };
  return `<section class="analysis-chart analysis-trend"><h3>任务耗时趋势</h3><svg viewBox="0 0 360 190" role="img" aria-label="任务耗时趋势"><line class="analysis-axis" x1="30" y1="154" x2="342" y2="154"></line>${line(0, "#3d72bd", "执行")}${line(1, "#e14b4b", "停顿")}${line(2, "#14875b", "非停顿")}</svg><div class="analysis-legend"><span><i style="background:#3d72bd"></i>执行</span><span><i style="background:#e14b4b"></i>停顿</span><span><i style="background:#14875b"></i>非停顿</span></div></section>`;
}

function renderCrawlerAnalysis(result) {
  const tasks = result.tasks || [];
  const timelineScrollLeft = elements.analysisContent.querySelector(".analysis-timeline-wrap")?.scrollLeft || 0;
  elements.analysisEmptyState.hidden = tasks.length > 0;
  if (!tasks.length) {
    elements.analysisContent.innerHTML = "";
    return;
  }
  const timing = result.current_timing || {};
  elements.analysisContent.innerHTML = `
    <div class="analysis-meta"><strong>${escapeHtml(result.crawler_id)}</strong><span>显示最近 ${tasks.length} 次任务</span><span>当前基准停顿 ${formatDuration(Number(timing.wait_base_seconds) || 0)} · 泛化率 ${Number(timing.wait_random_rate || 0).toFixed(1)}</span></div>
    <section class="analysis-chart analysis-gantt"><h3>近任务操作甘特图</h3>${renderAnalysisTimeline(tasks)}</section>
    <div class="analysis-chart-grid">${renderAnalysisHistogram(tasks.map(task => task.execution_seconds), "执行时间直方图", "#3d72bd")}${renderAnalysisHistogram(tasks.map(task => task.wait_seconds), "停顿时间直方图", "#e14b4b")}${renderAnalysisTrend(tasks)}</div>`;
  elements.analysisContent.querySelector(".analysis-timeline-wrap").scrollLeft = timelineScrollLeft;
}

function renderAnalysisTimeline(tasks) {
  const segments = tasks.map((task, taskIndex) => {
    const start = Number(task.started_at || task.enqueued_at) || 0;
    const end = Number(task.finished_at) || start + (Number(task.execution_seconds) || 1);
    return { task, taskIndex, start, end, operations: task.operations || [], waits: task.waits || [] };
  });
  const firstTime = Math.min(...segments.map(segment => segment.start));
  const lastTime = Math.max(...segments.map(segment => segment.end));
  const totalDuration = Math.max(lastTime - firstTime, 1);
  const activityCount = segments.reduce((total, segment) => total + segment.operations.length + segment.waits.length, 0);
  const zoom = Number(elements.analysisZoom.value) || 1;
  const trackWidth = Math.max(1100, activityCount * 24, totalDuration * 4) * zoom;
  const position = timestamp => `${((timestamp - firstTime) / totalDuration * trackWidth).toFixed(1)}px`;
  const bar = (start, end, className, title, label = "") => {
    const left = Math.max(0, start - firstTime);
    const width = Math.max(2, end - start);
    return `<span class="analysis-timeline-bar ${className}" style="left:${position(firstTime + left)};width:${(width / totalDuration * trackWidth).toFixed(1)}px" title="${escapeHtml(title)}"><span>${escapeHtml(label)}</span></span>`;
  };
  const taskBars = segments.map(segment => bar(segment.start, segment.end, "execution", `任务 #${segment.taskIndex + 1} · ${formatDuration(segment.end - segment.start)}`, `#${segment.taskIndex + 1}`)).join("");
  const operationBars = segments.flatMap(segment => segment.operations.map(operation => {
    const start = Number(operation.started_at) || segment.start;
    const end = Number(operation.finished_at) || start + (Number(operation.elapsed_seconds) || 0);
    return bar(start, end, "operation", `任务 #${segment.taskIndex + 1} · 操作 #${operation.index + 1} · ${formatDuration(end - start)}`, `#${operation.index + 1}`);
  })).join("");
  const waitBars = segments.flatMap(segment => segment.waits.map(wait => {
    const start = Number(wait.started_at) || segment.start;
    const end = start + (Number(wait.actual_seconds) || 0);
    return bar(start, end, "wait", `任务 #${segment.taskIndex + 1} · ${waitStageLabels[wait.stage] || wait.stage} · ${formatDuration(end - start)}`);
  })).join("");
  const tickCount = Math.max(2, Math.min(10, Math.floor(trackWidth / 150)));
  const gridStep = trackWidth / tickCount;
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const timestamp = firstTime + totalDuration * index / tickCount;
    return `<span class="analysis-timeline-tick" style="left:${(trackWidth * index / tickCount).toFixed(1)}px"><small>${formatTime(timestamp)}</small></span>`;
  }).join("");
  const boundaries = segments.map((segment, index) => `<span class="analysis-timeline-boundary" style="left:${position(segment.start)}" title="任务 #${index + 1} 开始"><b>#${index + 1}</b></span>`).join("");
  const trackStyle = `width:${trackWidth}px;--analysis-grid-step:${gridStep.toFixed(1)}px`;
  return `<div class="analysis-timeline-wrap"><div class="analysis-timeline-axis-row"><span class="analysis-timeline-label"></span><div class="analysis-timeline-axis" style="width:${trackWidth}px">${ticks}${boundaries}</div></div><div class="analysis-timeline-row"><span class="analysis-timeline-label">任务</span><div class="analysis-timeline-track" style="${trackStyle}">${taskBars}</div></div><div class="analysis-timeline-row"><span class="analysis-timeline-label">浏览</span><div class="analysis-timeline-track" style="${trackStyle}">${operationBars || `<small>暂无操作</small>`}</div></div><div class="analysis-timeline-row"><span class="analysis-timeline-label">停顿</span><div class="analysis-timeline-track" style="${trackStyle}">${waitBars || `<small>暂无停顿</small>`}</div></div><div class="analysis-legend"><span><i class="queue"></i>排队 / 空档</span><span><i class="execution"></i>执行</span><span><i class="operation"></i>浏览操作范围</span><span><i class="wait"></i>主动停顿</span></div></div>`;
}

async function loadCrawlerAnalysis(silent = false) {
  const crawlerId = elements.analysisCrawlerFilter.value;
  if (!crawlerId) {
    elements.analysisContent.innerHTML = "";
    elements.analysisEmptyState.hidden = false;
    return;
  }
  try {
    const count = Math.max(1, Math.min(20, Number(elements.analysisCount.value) || 3));
    elements.analysisCount.value = count;
    renderCrawlerAnalysis(await api(`/api/crawlers/${encodeURIComponent(crawlerId)}/analysis?count=${count}`));
  } catch (error) {
    if (!silent) showToast(error.message, true);
    throw error;
  }
}

async function loadTasks(silent = false) {
  try {
    const crawlerId = elements.taskCrawlerFilter.value;
    const taskStatus = elements.taskStatusFilter.value;
    const params = new URLSearchParams({ limit: "50" });
    const summaryParams = new URLSearchParams();
    if (crawlerId) {
      params.set("crawler_id", crawlerId);
      summaryParams.set("crawler_id", crawlerId);
    }
    if (taskStatus) params.set("status", taskStatus);
    const [tasks, summary] = await Promise.all([
      api(`/api/tasks?${params}`),
      api(`/api/tasks/summary?${summaryParams}`),
    ]);
    renderTasks(tasks.items, summary);
  } catch (error) {
    if (!silent) showToast(error.message, true);
    throw error;
  }
}

function renderTaskDetail(task) {
  state.taskDetailTask = task;
  const operations = task.operations || [];
  const waits = task.waits || [];
  const timeDetails = [];
  const operationWaitIndexes = new Set();
  operations.forEach(operation => {
    const operationWaits = waits
      .filter(wait => wait.operation_index === operation.index)
      .sort((left, right) => left.started_at - right.started_at);
    let activeStartedAt = operation.started_at;
    operationWaits.forEach(wait => {
      operationWaitIndexes.add(wait);
      timeDetails.push({
        ...wait,
        active_seconds: Math.max(0, wait.started_at - activeStartedAt),
      });
      activeStartedAt = wait.started_at + (wait.actual_seconds || 0);
    });
    const operationFinishedAt = operation.finished_at || Date.now() / 1000;
    if (operationFinishedAt > activeStartedAt) {
      timeDetails.push({
        stage: "operation_tail",
        operation_index: operation.index,
        started_at: activeStartedAt,
        active_seconds: operationFinishedAt - activeStartedAt,
      });
    }
  });
  waits
    .filter(wait => !operationWaitIndexes.has(wait))
    .forEach(wait => timeDetails.push({ ...wait, active_seconds: null }));
  timeDetails.sort((left, right) => (left.started_at ?? Number.MAX_VALUE) - (right.started_at ?? Number.MAX_VALUE));
  elements.taskDetailTitle.textContent = `${task.crawler_id} · ${taskStatusLabels[task.status] || task.status}`;
  elements.taskDetailContent.innerHTML = `
    <div class="task-detail-metrics">
      <div><span>排队</span><strong>${formatDuration(task.queue_seconds)}</strong></div>
      <div><span>执行</span><strong>${formatFinalTaskDuration(task, "execution_seconds")}</strong></div>
      <div><span>主动停顿</span><strong>${formatDuration(task.wait_seconds)}</strong></div>
      <div><span>非停顿</span><strong>${formatFinalTaskDuration(task, "active_seconds")}</strong></div>
    </div>
    <section class="task-detail-section task-timing-snapshot"><div class="task-detail-section-heading"><h3>停顿参数快照</h3><span>${task.timing_config ? "任务入队时记录" : "历史任务无快照"}</span></div>${task.timing_config ? `<div class="timing-snapshot-grid"><span>基准 ${formatDuration(Number(task.timing_config.wait_base_seconds) || 0)}</span><span>泛化率 ${Number(task.timing_config.wait_random_rate || 0).toFixed(1)}</span><span>首次 ${Number(task.timing_config.wait_initial_multiplier || 0).toFixed(1)}x</span><span>滚动 ${Number(task.timing_config.wait_scroll_multiplier || 0).toFixed(1)}x</span><span>帖子 ${Number(task.timing_config.wait_post_multiplier || 0).toFixed(1)}x</span><span>详情开 ${Number(task.timing_config.wait_detail_open_multiplier || 0).toFixed(1)}x</span><span>详情关 ${Number(task.timing_config.wait_detail_close_multiplier || 0).toFixed(1)}x</span><span>异常 ${Number(task.timing_config.wait_error_multiplier || 0).toFixed(1)}x</span></div>` : ""}</section>
    ${renderTaskTimeline(task, operations, waits)}
    ${renderNonWaitDistribution(operations)}
    ${renderDurationDistributions(operations, waits)}
    ${task.error ? `<p class="task-error">${escapeHtml(task.error)}</p>` : ""}
    <section class="task-detail-section"><h3>浏览操作</h3>
      <div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>#</th><th>帖子</th><th>状态</th><th>总耗时</th><th>停顿</th><th>非停顿</th></tr></thead><tbody>
        ${operations.length ? operations.map(operation => `<tr><td>${operation.index + 1}</td><td title="${escapeHtml(operation.post_id || "")}">${escapeHtml(operation.post_id || `页面项 ${operation.post_index}`)}</td><td>${operationStatusLabels[operation.status] || escapeHtml(operation.status)}</td><td>${formatDuration(operation.elapsed_seconds)}</td><td>${formatDuration(operation.wait_seconds)}</td><td>${formatDuration(operation.active_seconds)}</td></tr>`).join("") : `<tr><td colspan="6">暂无浏览操作</td></tr>`}
      </tbody></table></div>
    </section>
    <section class="task-detail-section"><h3>时间明细</h3>
      <div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>阶段</th><th>浏览操作</th><th>计划停顿</th><th>实际停顿</th><th>非停顿</th></tr></thead><tbody>
        ${timeDetails.length ? timeDetails.map(detail => `<tr><td>${detail.stage === "operation_tail" ? "操作收尾" : waitStageLabels[detail.stage] || escapeHtml(detail.stage)}</td><td>${detail.operation_index === null ? "任务级" : `#${detail.operation_index + 1}`}</td><td>${detail.planned_seconds === undefined ? "--" : formatDuration(detail.planned_seconds)}</td><td>${detail.actual_seconds === undefined ? "--" : formatDuration(detail.actual_seconds)}</td><td>${detail.active_seconds === null ? "--" : formatDuration(detail.active_seconds)}</td></tr>`).join("") : `<tr><td colspan="5">暂无时间明细</td></tr>`}
      </tbody></table></div>
    </section>`;
}

function setView(view, updateHash = true) {
  state.currentView = view;
  elements.fleetView.hidden = view !== "fleet";
  elements.dataView.hidden = view !== "data";
  elements.imagesView.hidden = view !== "images";
  elements.tasksView.hidden = view !== "tasks";
  elements.analysisView.hidden = view !== "analysis";
  document.querySelectorAll(".primary-nav button").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  if (updateHash) history.replaceState(null, "", `#/${view}`);
  if (view === "tasks") loadTasks(true);
  if (view === "data") loadRawdata({ silent: true });
  if (view === "images") loadImageCache({ silent: true });
  if (view === "analysis") loadCrawlerAnalysis(true);
}

function renderLogs(logs) {
  const logMarkup = logs.length ? logs.map(log => `
    <div class="log-entry ${String(log.message).toLowerCase()}">
      <span class="log-time">${formatDateTime(log.timestamp)}</span>
      <span class="log-crawler" title="${escapeHtml(log.crawler_id)}">${escapeHtml(log.crawler_id)}</span>
      <span class="log-message">
        <span><strong>${escapeHtml(log.message)}</strong>${escapeHtml(log.detail || "")}</span>
        ${log.img_str ? `<button class="thumbnail-button" type="button" aria-label="查看截屏大图"><img class="log-thumbnail" src="data:image/jpeg;base64,${escapeHtml(log.img_str)}" alt="${escapeHtml(log.crawler_id)} 截屏" loading="lazy"></button>` : ""}
      </span>
    </div>`).join("") : `<div class="empty-state"><strong>暂无日志</strong></div>`;
  if (logMarkup !== state.logMarkup) {
    elements.logList.innerHTML = logMarkup;
    state.logMarkup = logMarkup;
  }
}

async function loadData(silent = false) {
  if (state.busy) return;
  state.busy = true;
  try {
    const filter = elements.logFilter.value;
    const [crawlers, logs, stats] = await Promise.all([
      api("/api/crawlers"),
      api(`/api/logs?limit=100${filter ? `&crawler_id=${encodeURIComponent(filter)}` : ""}`),
      api("/api/stats"),
    ]);
    state.crawlers = crawlers;
    renderCrawlers();
    renderLogs(logs);
    elements.rawdataCount.textContent = stats.rawdata_count.toLocaleString("zh-CN");
    elements.dataTotalCount.textContent = stats.rawdata_count.toLocaleString("zh-CN");
    elements.lastRefresh.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    elements.refreshState.textContent = state.paused ? "自动刷新已暂停" : "自动刷新已开启";
    elements.refreshState.classList.remove("error");
    if (state.currentView === "tasks") await loadTasks(true);
    if (state.currentView === "data") await loadRawdata({ refresh: true, silent: true });
    if (state.currentView === "images") await loadImageCache({ refresh: true, silent: true });
    if (state.currentView === "analysis") await loadCrawlerAnalysis(true);
  } catch (error) {
    elements.refreshState.textContent = "连接中断";
    elements.refreshState.classList.add("error");
    if (!silent) showToast(error.message, true);
  } finally {
    state.busy = false;
  }
}

elements.crawlerList.addEventListener("click", async event => {
  const menuTrigger = event.target.closest("button[data-menu-toggle]");
  if (menuTrigger) {
    const menu = menuTrigger.closest(".action-menu");
    const shouldOpen = !menu.classList.contains("open");
    closeCrawlerActionMenus();
    if (shouldOpen) {
      menu.classList.add("open");
      menuTrigger.setAttribute("aria-expanded", "true");
      menu.querySelector(".action-menu-list").hidden = false;
    }
    return;
  }
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  closeCrawlerActionMenus();
  const { action, id } = button.dataset;
  if (action === "edit") {
    const crawler = state.crawlers.find(item => item.crawler_id === id);
    if (!crawler) return;
    state.editingCrawlerId = id;
    elements.createForm.reset();
    elements.createForm.elements.crawler_id.value = crawler.crawler_id;
    elements.createForm.elements.crawler_id.disabled = true;
    elements.createForm.elements.user_data_dir.value = crawler.user_data_dir;
    elements.createForm.elements.image_strategy.value = crawler.image_strategy || "none";
    elements.createForm.elements.proxy_url.value = crawler.proxy?.url || "";
    elements.createForm.elements.proxy_user.value = crawler.proxy?.user || "";
    elements.createForm.elements.proxy_password.value = crawler.proxy?.password || "";
    elements.crawlerDialogEyebrow.textContent = "EDIT INSTANCE";
    elements.crawlerDialogTitle.textContent = "编辑爬虫";
    elements.submitCrawler.textContent = "保存修改";
    elements.deleteCrawler.hidden = false;
    elements.createError.textContent = "";
    elements.crawlerDialog.showModal();
    return;
  }
  if (action === "timing") {
    const crawler = state.crawlers.find(item => item.crawler_id === id);
    if (!crawler) return;
    elements.timingForm.elements.crawler_id.value = id;
    elements.timingForm.elements.wait_base_seconds.value = crawler.wait_base_seconds ?? 5;
    elements.timingForm.elements.wait_random_rate.value = crawler.wait_random_rate ?? 0.6;
    elements.timingForm.elements.wait_initial_multiplier.value = crawler.wait_initial_multiplier ?? 1.0;
    elements.timingForm.elements.wait_scroll_multiplier.value = crawler.wait_scroll_multiplier ?? 0.8;
    elements.timingForm.elements.wait_post_multiplier.value = crawler.wait_post_multiplier ?? 0.4;
    elements.timingForm.elements.wait_detail_open_multiplier.value = crawler.wait_detail_open_multiplier ?? 0.6;
    elements.timingForm.elements.wait_detail_close_multiplier.value = crawler.wait_detail_close_multiplier ?? 0.6;
    elements.timingForm.elements.wait_error_multiplier.value = crawler.wait_error_multiplier ?? 0.6;
    elements.timingError.textContent = "";
    renderTimingDistribution();
    elements.timingDialog.showModal();
    return;
  }
  if (action === "goto") {
    elements.gotoForm.elements.crawler_id.value = id;
    elements.gotoError.textContent = "";
    elements.gotoDialog.showModal();
    return;
  }
  button.disabled = true;
  try {
    const actionPath = ["surface", "scroll", "screenshot", "screenshot-priority"].includes(action) ? `actions/${action}` : action;
    const result = await api(`/api/crawlers/${encodeURIComponent(id)}/${actionPath}`, { method: "POST" });
    showToast(result.message);
    await loadData(true);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector(".primary-nav").addEventListener("click", event => {
  const button = event.target.closest("button[data-view]");
  if (button) setView(button.dataset.view);
});
window.addEventListener("hashchange", () => setView(location.hash === "#/tasks" ? "tasks" : location.hash === "#/data" ? "data" : location.hash === "#/images" ? "images" : location.hash === "#/analysis" ? "analysis" : "fleet", false));
elements.loadMoreData.addEventListener("click", async () => {
  elements.loadMoreData.disabled = true;
  try {
    await loadRawdata({ append: true });
  } finally {
    elements.loadMoreData.disabled = false;
  }
});
elements.loadMoreImages.addEventListener("click", async () => {
  elements.loadMoreImages.disabled = true;
  try {
    await loadImageCache({ append: true });
  } finally {
    elements.loadMoreImages.disabled = false;
  }
});
elements.rawdataList.addEventListener("click", event => {
  const row = event.target.closest("tr[data-rawdata-id]");
  if (!row) return;
  const item = state.rawdataItems.find(entry => entry._id === row.dataset.rawdataId);
  if (item) openRawdataDetail(item);
});
elements.rawdataList.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("tr[data-rawdata-id]")) {
    event.preventDefault();
    event.target.click();
  }
});
elements.deleteRawdata.addEventListener("click", async () => {
  const dataId = state.selectedRawdataId;
  if (!dataId || !window.confirm("确定删除这条爬取数据？此操作无法撤销。")) return;
  elements.deleteRawdata.disabled = true;
  try {
    const result = await api(`/api/rawdata/${encodeURIComponent(dataId)}`, { method: "DELETE" });
    state.rawdataItems = state.rawdataItems.filter(item => item._id !== dataId);
    state.rawdataMarkup = null;
    state.selectedRawdataId = null;
    elements.dataDetailDialog.close();
    renderRawdata();
    const nextCount = Math.max(0, Number(elements.dataTotalCount.textContent.replaceAll(",", "")) - 1);
    elements.dataTotalCount.textContent = nextCount.toLocaleString("zh-CN");
    elements.rawdataCount.textContent = nextCount.toLocaleString("zh-CN");
    showToast(result.message);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.deleteRawdata.disabled = false;
  }
});
elements.taskCrawlerFilter.addEventListener("change", () => loadTasks());
elements.taskStatusFilter.addEventListener("change", () => loadTasks());
elements.analysisCrawlerFilter.addEventListener("change", () => loadCrawlerAnalysis());
elements.analysisCount.addEventListener("change", () => loadCrawlerAnalysis());
elements.analysisZoom.addEventListener("input", () => {
  elements.analysisZoomValue.textContent = `${Number(elements.analysisZoom.value).toFixed(1)}×`;
  if (state.currentView === "analysis") loadCrawlerAnalysis(true);
});
elements.taskList.addEventListener("click", async event => {
  const deleteButton = event.target.closest("button[data-delete-task]");
  if (deleteButton) {
    if (!window.confirm("确定删除这个任务？")) return;
    deleteButton.disabled = true;
    try {
      const result = await api(`/api/tasks/${encodeURIComponent(deleteButton.dataset.deleteTask)}`, { method: "DELETE" });
      showToast(result.message);
      await loadTasks(true);
    } catch (error) {
      showToast(error.message, true);
      deleteButton.disabled = false;
    }
    return;
  }
  const cancelButton = event.target.closest("button[data-cancel-task]");
  if (cancelButton) {
    if (!window.confirm("确定结束这个任务？")) return;
    cancelButton.disabled = true;
    try {
      const result = await api(`/api/tasks/${encodeURIComponent(cancelButton.dataset.cancelTask)}/cancel`, { method: "POST" });
      showToast(result.message);
      await loadTasks(true);
    } catch (error) {
      showToast(error.message, true);
      cancelButton.disabled = false;
    }
    return;
  }
  const row = event.target.closest("tr[data-task-id]");
  if (!row) return;
  try {
    renderTaskDetail(await api(`/api/tasks/${encodeURIComponent(row.dataset.taskId)}`));
    elements.taskDetailDialog.showModal();
  } catch (error) {
    showToast(error.message, true);
  }
});
elements.taskList.addEventListener("keydown", event => {
  if (event.target.closest("button")) return;
  if (event.key === "Enter" || event.key === " ") event.target.closest("tr[data-task-id]")?.click();
});

document.querySelector("#createButton").addEventListener("click", () => {
  state.editingCrawlerId = null;
  elements.createForm.reset();
  elements.createForm.elements.crawler_id.disabled = false;
  elements.crawlerDialogEyebrow.textContent = "NEW INSTANCE";
  elements.crawlerDialogTitle.textContent = "新建爬虫";
  elements.submitCrawler.textContent = "创建实例";
  elements.deleteCrawler.hidden = true;
  elements.createError.textContent = "";
  elements.crawlerDialog.showModal();
});

elements.refreshButton.addEventListener("click", async () => {
  await loadData();
  scheduleAutoRefresh();
});
function closeRefreshIntervalMenu({ restoreFocus = false } = {}) {
  elements.refreshIntervalPicker.classList.remove("open");
  elements.refreshIntervalButton.setAttribute("aria-expanded", "false");
  elements.refreshIntervalMenu.hidden = true;
  if (restoreFocus) elements.refreshIntervalButton.focus();
}

function openRefreshIntervalMenu() {
  elements.refreshIntervalPicker.classList.add("open");
  elements.refreshIntervalButton.setAttribute("aria-expanded", "true");
  elements.refreshIntervalMenu.hidden = false;
  elements.refreshIntervalMenu.querySelector('[aria-selected="true"]').focus();
}

elements.refreshIntervalButton.addEventListener("click", () => {
  if (elements.refreshIntervalMenu.hidden) openRefreshIntervalMenu();
  else closeRefreshIntervalMenu();
});
elements.refreshIntervalMenu.addEventListener("click", event => {
  const option = event.target.closest("button[role=option]");
  if (!option) return;
  elements.refreshInterval.value = option.dataset.value;
  elements.refreshIntervalValue.textContent = option.textContent;
  elements.refreshIntervalButton.setAttribute("aria-label", `自动刷新间隔，当前 ${option.textContent.replace("s", " 秒")}`);
  elements.refreshIntervalMenu.querySelectorAll("button").forEach(button => {
    button.setAttribute("aria-selected", String(button === option));
  });
  closeRefreshIntervalMenu({ restoreFocus: true });
  scheduleAutoRefresh();
});
elements.refreshIntervalPicker.addEventListener("keydown", event => {
  if (event.key === "Escape" && !elements.refreshIntervalMenu.hidden) {
    event.preventDefault();
    closeRefreshIntervalMenu({ restoreFocus: true });
    return;
  }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  if (elements.refreshIntervalMenu.hidden) {
    openRefreshIntervalMenu();
    return;
  }
  const options = [...elements.refreshIntervalMenu.querySelectorAll("button")];
  const offset = event.key === "ArrowDown" ? 1 : -1;
  const currentIndex = options.indexOf(document.activeElement);
  options[(currentIndex + offset + options.length) % options.length].focus();
});
document.addEventListener("pointerdown", event => {
  if (!elements.refreshIntervalPicker.contains(event.target)) closeRefreshIntervalMenu();
  if (!event.target.closest(".action-menu")) closeCrawlerActionMenus();
});
elements.pauseButton.addEventListener("click", () => {
  state.paused = !state.paused;
  elements.pauseButton.classList.toggle("active", state.paused);
  elements.pauseButton.querySelector(".pause-icon").classList.toggle("play", state.paused);
  elements.pauseButton.title = state.paused ? "继续自动刷新" : "暂停自动刷新";
  elements.pauseButton.setAttribute("aria-label", elements.pauseButton.title);
  elements.refreshState.textContent = state.paused ? "自动刷新已暂停" : "自动刷新已开启";
  elements.refreshState.classList.remove("error");
  if (state.paused) scheduleAutoRefresh();
  else loadData(true).finally(scheduleAutoRefresh);
});
elements.logFilter.addEventListener("change", () => loadData());
elements.logList.addEventListener("click", event => {
  const thumbnail = event.target.closest(".log-thumbnail");
  if (!thumbnail) return;
  elements.imagePreview.src = thumbnail.src;
  elements.imagePreview.alt = thumbnail.alt;
  elements.imagePreviewDialog.showModal();
});
elements.imagePreviewDialog.addEventListener("click", event => {
  if (event.target === elements.imagePreviewDialog || event.target.closest(".image-preview-close")) {
    elements.imagePreviewDialog.close();
  }
});

elements.createForm.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(elements.createForm));
  const payload = {
    user_data_dir: data.user_data_dir,
    image_strategy: data.image_strategy,
    proxy: {
      url: data.proxy_url,
      user: data.proxy_user,
      password: data.proxy_password,
    },
  };
  try {
    if (state.editingCrawlerId) {
      await api(`/api/crawlers/${encodeURIComponent(state.editingCrawlerId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/crawlers", {
        method: "POST",
        body: JSON.stringify({ crawler_id: data.crawler_id, ...payload }),
      });
    }
    elements.crawlerDialog.close();
    showToast(state.editingCrawlerId ? "爬虫配置已更新" : "爬虫创建成功");
    state.editingCrawlerId = null;
    await loadData(true);
  } catch (error) {
    elements.createError.textContent = error.message;
  }
});

elements.taskDetailContent.addEventListener("input", event => {
  const option = event.target.closest("[data-distribution-option]");
  if (!option || !state.taskDetailTask) return;
  const chart = option.closest("[data-distribution-chart]");
  if (!chart) return;
  const chartKey = chart.dataset.distributionChart;
  state.durationDistributionOptions[chartKey] = {
    ...(state.durationDistributionOptions[chartKey] || {}),
    [option.dataset.distributionOption]: Number(option.value),
  };
  const output = chart.querySelector(`[data-distribution-output="${option.dataset.distributionOption}"]`);
  if (output) output.textContent = `${option.value}s`;
});

elements.taskDetailContent.addEventListener("change", event => {
  const option = event.target.closest("[data-distribution-option]");
  if (!option || !state.taskDetailTask) return;
  const currentChart = option.closest("[data-distribution-chart]");
  if (!currentChart) return;
  const chartKey = currentChart.dataset.distributionChart;
  const isWaitChart = chartKey === "wait";
  const samples = isWaitChart
    ? (state.taskDetailTask.waits || []).map(wait => wait.actual_seconds)
    : (state.taskDetailTask.operations || []).map(operation => operation.active_seconds);
  const config = isWaitChart
    ? { key: "wait", title: "停顿分布", axisName: "停顿时长", sampleName: "停顿" }
    : { key: "active", title: "耗时分布", axisName: "耗时", sampleName: "操作" };
  const temporaryContainer = document.createElement("div");
  temporaryContainer.innerHTML = renderDurationDistribution(samples, config, state.durationDistributionOptions[chartKey]);
  const nextChart = temporaryContainer.querySelector("[data-distribution-chart]");
  if (nextChart) currentChart.replaceWith(nextChart);
});

function renderTimingDistribution() {
  const stage = document.querySelector("#timingPreviewStage").value;
  const fields = ["wait_base_seconds", "wait_random_rate", stage].map(name => elements.timingForm.elements[name]);
  fields.push(document.querySelector("#timingPreviewCount"));
  const valid = fields.every(field => field.value !== "" && field.validity.valid);
  const [base, rate, multiplier, count] = fields.map(field => Number(field.value));
  const minimum = base * multiplier;
  const maximum = minimum * (1 + rate);
  const mean = (minimum + maximum) / 2;
  const deviation = base * multiplier * rate / Math.sqrt(12 * count);
  const axisMax = Math.max(maximum * 1.2, 1);
  const position = value => 24 + value / axisMax * 312;
  const left = position(minimum);
  const right = position(maximum);
  const fixed = minimum === maximum;
  const format = value => value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
  let curve = "";
  let area = "";
  if (valid && !fixed) {
    if (count === 1) {
      curve = `M 24 108 H ${left} V 36 H ${right} V 108 H 336`;
      area = `M ${left} 108 V 36 H ${right} V 108 Z`;
    } else {
      const density = fraction => {
        if (count >= 12) {
          const standardized = (fraction - 0.5) * Math.sqrt(12 * count);
          return Math.exp(-0.5 * standardized ** 2);
        }
        const argument = Math.min(fraction, 1 - fraction) * count;
        let total = 0;
        let combination = 1;
        for (let term = 0; term <= Math.floor(argument); term++) {
          total += (-1) ** term * combination * (argument - term) ** (count - 1);
          combination *= (count - term) / (term + 1);
        }
        return Math.max(0, total);
      };
      const peak = density(0.5);
      const points = Array.from({ length: 201 }, (_, index) => {
        const fraction = index / 200;
        return `${position(minimum + (maximum - minimum) * fraction)} ${108 - 72 * density(fraction) / peak}`;
      });
      curve = `M ${points.join(" L ")}`;
      area = `${curve} L ${right} 108 L ${left} 108 Z`;
    }
  }
  document.querySelector("#timingDistributionArea").setAttribute("d", area);
  document.querySelector("#timingDistributionLine").setAttribute("d", valid && fixed ? `M ${left} 108 V 28` : curve);
  document.querySelector("#timingDistributionMean").setAttribute("d", valid && !fixed ? `M ${position(mean)} 28 V 108` : "");
  document.querySelector("#timingDistributionKind").textContent = !valid ? "参数无效" : fixed ? "固定等待" : count === 1 ? "均匀分布" : count < 12 ? "平均值分布" : "均值正态近似";
  document.querySelector("#timingAxisMax").textContent = valid ? `${format(axisMax)} 秒` : "";
  const summary = valid ? `${count} 次平均：最短 ${format(minimum)} 秒 · 期望 ${format(mean)} 秒 · 最长 ${format(maximum)} 秒 · 标准差 ${format(deviation)} 秒` : "请输入有效的等待参数";
  document.querySelector("#timingDistributionSummary").textContent = summary;
  document.querySelector("#timingDistribution").setAttribute("aria-label", summary);
}

elements.timingForm.addEventListener("input", renderTimingDistribution);
document.querySelector("#timingPreviewStage").addEventListener("change", renderTimingDistribution);

elements.timingForm.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(elements.timingForm));
  try {
    await api(`/api/crawlers/${encodeURIComponent(data.crawler_id)}/timing`, {
      method: "PUT",
      body: JSON.stringify({
        wait_base_seconds: Number(data.wait_base_seconds),
        wait_random_rate: Number(data.wait_random_rate),
        wait_initial_multiplier: Number(data.wait_initial_multiplier),
        wait_scroll_multiplier: Number(data.wait_scroll_multiplier),
        wait_post_multiplier: Number(data.wait_post_multiplier),
        wait_detail_open_multiplier: Number(data.wait_detail_open_multiplier),
        wait_detail_close_multiplier: Number(data.wait_detail_close_multiplier),
        wait_error_multiplier: Number(data.wait_error_multiplier),
      }),
    });
    elements.timingDialog.close();
    showToast("等待时间已立即应用");
    await loadData(true);
  } catch (error) {
    elements.timingError.textContent = error.message;
  }
});

elements.deleteCrawler.addEventListener("click", async () => {
  const crawlerId = state.editingCrawlerId;
  if (!crawlerId || !window.confirm(`确定删除爬虫 ${crawlerId}？关联日志和动作记录也会被删除。`)) return;
  elements.deleteCrawler.disabled = true;
  elements.createError.textContent = "";
  try {
    const result = await api(`/api/crawlers/${encodeURIComponent(crawlerId)}`, { method: "DELETE" });
    elements.crawlerDialog.close();
    state.editingCrawlerId = null;
    showToast(result.message);
    await loadData(true);
  } catch (error) {
    elements.createError.textContent = error.message;
  } finally {
    elements.deleteCrawler.disabled = false;
  }
});

elements.gotoForm.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(elements.gotoForm));
  try {
    const result = await api(`/api/crawlers/${encodeURIComponent(data.crawler_id)}/actions/goto`, { method: "POST", body: JSON.stringify({ url: data.url }) });
    elements.gotoDialog.close();
    showToast(result.message);
  } catch (error) {
    elements.gotoError.textContent = error.message;
  }
});

document.querySelectorAll("dialog .secondary-button, dialog .close-button").forEach(button => {
  button.addEventListener("click", event => {
    event.preventDefault();
    button.closest("dialog").close();
  });
});

function scheduleAutoRefresh() {
  window.clearTimeout(state.refreshTimer);
  if (state.paused) return;
  state.refreshTimer = window.setTimeout(async () => {
    await loadData(true);
    scheduleAutoRefresh();
  }, Number(elements.refreshInterval.value));
}

setView(state.currentView, false);
loadData().finally(scheduleAutoRefresh);