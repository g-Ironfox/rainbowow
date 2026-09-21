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
  currentView: location.hash === "#/tasks" ? "tasks" : "fleet",
  taskMarkup: null,
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
  tasksView: document.querySelector("#tasksView"),
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
};

const statusLabels = { running: "运行中", idle: "空闲", stopped: "已停止", error: "状态异常" };
const taskStatusLabels = { queued: "排队中", running: "执行中", completed: "已完成", failed: "失败" };
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

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "--";
  if (seconds < 60) return `${seconds.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
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
  const filterMarkup = `<option value="">全部爬虫</option>${state.crawlers.map(crawler => `<option value="${escapeHtml(crawler.crawler_id)}">${escapeHtml(crawler.crawler_id)}</option>`).join("")}`;
  if (filterMarkup !== state.filterMarkup) {
    elements.logFilter.innerHTML = filterMarkup;
    elements.taskCrawlerFilter.innerHTML = filterMarkup;
    state.filterMarkup = filterMarkup;
    if (state.crawlers.some(crawler => crawler.crawler_id === selected)) elements.logFilter.value = selected;
    if (state.crawlers.some(crawler => crawler.crawler_id === selectedTaskCrawler)) elements.taskCrawlerFilter.value = selectedTaskCrawler;
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
      <td>${formatDuration(task.execution_seconds)}</td>
      <td>${formatDuration(task.wait_seconds)} <small>${task.wait_count || 0} 次</small></td>
      <td>${formatDuration(task.active_seconds)}</td>
      <td>${task.operation_count || 0}</td>
      <td>${task.result?.inserted_count ?? "--"}</td>
    </tr>`).join("");
  if (markup !== state.taskMarkup) {
    elements.taskList.innerHTML = markup;
    state.taskMarkup = markup;
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
  const operations = task.operations || [];
  const waits = task.waits || [];
  elements.taskDetailTitle.textContent = `${task.crawler_id} · ${taskStatusLabels[task.status] || task.status}`;
  elements.taskDetailContent.innerHTML = `
    <div class="task-detail-metrics">
      <div><span>排队</span><strong>${formatDuration(task.queue_seconds)}</strong></div>
      <div><span>执行</span><strong>${formatDuration(task.execution_seconds)}</strong></div>
      <div><span>主动停顿</span><strong>${formatDuration(task.wait_seconds)}</strong></div>
      <div><span>非停顿</span><strong>${formatDuration(task.active_seconds)}</strong></div>
    </div>
    ${task.error ? `<p class="task-error">${escapeHtml(task.error)}</p>` : ""}
    <section class="task-detail-section"><h3>浏览操作</h3>
      <div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>#</th><th>帖子</th><th>状态</th><th>总耗时</th><th>停顿</th><th>非停顿</th></tr></thead><tbody>
        ${operations.length ? operations.map(operation => `<tr><td>${operation.index + 1}</td><td title="${escapeHtml(operation.post_id || "")}">${escapeHtml(operation.post_id || `页面项 ${operation.post_index}`)}</td><td>${operationStatusLabels[operation.status] || escapeHtml(operation.status)}</td><td>${formatDuration(operation.elapsed_seconds)}</td><td>${formatDuration(operation.wait_seconds)}</td><td>${formatDuration(operation.active_seconds)}</td></tr>`).join("") : `<tr><td colspan="6">暂无浏览操作</td></tr>`}
      </tbody></table></div>
    </section>
    <section class="task-detail-section"><h3>停顿明细</h3>
      <div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>阶段</th><th>浏览操作</th><th>计划</th><th>实际</th></tr></thead><tbody>
        ${waits.length ? waits.map(wait => `<tr><td>${waitStageLabels[wait.stage] || escapeHtml(wait.stage)}</td><td>${wait.operation_index === null ? "任务级" : `#${wait.operation_index + 1}`}</td><td>${formatDuration(wait.planned_seconds)}</td><td>${formatDuration(wait.actual_seconds)}</td></tr>`).join("") : `<tr><td colspan="4">暂无停顿</td></tr>`}
      </tbody></table></div>
    </section>`;
}

function setView(view, updateHash = true) {
  state.currentView = view;
  elements.fleetView.hidden = view !== "fleet";
  elements.tasksView.hidden = view !== "tasks";
  document.querySelectorAll(".primary-nav button").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  if (updateHash) history.replaceState(null, "", view === "tasks" ? "#/tasks" : "#/fleet");
  if (view === "tasks") loadTasks(true);
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
    elements.lastRefresh.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    elements.refreshState.textContent = state.paused ? "自动刷新已暂停" : "自动刷新已开启";
    elements.refreshState.classList.remove("error");
    if (state.currentView === "tasks") await loadTasks(true);
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
window.addEventListener("hashchange", () => setView(location.hash === "#/tasks" ? "tasks" : "fleet", false));
elements.taskCrawlerFilter.addEventListener("change", () => loadTasks());
elements.taskStatusFilter.addEventListener("change", () => loadTasks());
elements.taskList.addEventListener("click", async event => {
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