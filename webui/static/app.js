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
  pauseButton: document.querySelector("#pauseButton"),
  refreshButton: document.querySelector("#refreshButton"),
  crawlerDialog: document.querySelector("#crawlerDialog"),
  createForm: document.querySelector("#createForm"),
  createError: document.querySelector("#createError"),
  crawlerDialogEyebrow: document.querySelector("#crawlerDialogEyebrow"),
  crawlerDialogTitle: document.querySelector("#crawlerDialogTitle"),
  submitCrawler: document.querySelector("#submitCrawler"),
  gotoDialog: document.querySelector("#gotoDialog"),
  gotoForm: document.querySelector("#gotoForm"),
  gotoError: document.querySelector("#gotoError"),
  imagePreviewDialog: document.querySelector("#imagePreviewDialog"),
  imagePreview: document.querySelector("#imagePreview"),
  toast: document.querySelector("#toast"),
};

const statusLabels = { running: "运行中", idle: "空闲", stopped: "已停止", error: "状态异常" };

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
          <button class="action-button" data-action="launch" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "disabled" : ""}>启动</button>
          <button class="action-button danger" data-action="terminate" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "" : "disabled"}>停止</button>
          <button class="action-button" data-action="goto" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "" : "disabled"}>跳转</button>
          <button class="action-button" data-action="surface" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "" : "disabled"}>抓取首页</button>
          <button class="action-button" data-action="screenshot" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "" : "disabled"}>截屏</button>
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
  const filterMarkup = `<option value="">全部爬虫</option>${state.crawlers.map(crawler => `<option value="${escapeHtml(crawler.crawler_id)}">${escapeHtml(crawler.crawler_id)}</option>`).join("")}`;
  if (filterMarkup !== state.filterMarkup) {
    elements.logFilter.innerHTML = filterMarkup;
    state.filterMarkup = filterMarkup;
    if (state.crawlers.some(crawler => crawler.crawler_id === selected)) elements.logFilter.value = selected;
  }
}

function renderLogs(logs) {
  const logMarkup = logs.length ? logs.map(log => `
    <div class="log-entry ${String(log.message).toLowerCase()}">
      <span class="log-time">${formatTime(log.timestamp)}</span>
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
  } catch (error) {
    elements.refreshState.textContent = "连接中断";
    elements.refreshState.classList.add("error");
    if (!silent) showToast(error.message, true);
  } finally {
    state.busy = false;
  }
}

elements.crawlerList.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "edit") {
    const crawler = state.crawlers.find(item => item.crawler_id === id);
    if (!crawler) return;
    state.editingCrawlerId = id;
    elements.createForm.reset();
    elements.createForm.elements.crawler_id.value = crawler.crawler_id;
    elements.createForm.elements.crawler_id.disabled = true;
    elements.createForm.elements.user_data_dir.value = crawler.user_data_dir;
    elements.createForm.elements.image_strategy.value = crawler.image_strategy || "None";
    elements.createForm.elements.proxy_url.value = crawler.proxy?.url || "";
    elements.createForm.elements.proxy_user.value = crawler.proxy?.user || "";
    elements.createForm.elements.proxy_password.value = crawler.proxy?.password || "";
    elements.crawlerDialogEyebrow.textContent = "EDIT INSTANCE";
    elements.crawlerDialogTitle.textContent = "编辑爬虫";
    elements.submitCrawler.textContent = "保存修改";
    elements.createError.textContent = "";
    elements.crawlerDialog.showModal();
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
    const actionPath = ["surface", "screenshot"].includes(action) ? `actions/${action}` : action;
    const result = await api(`/api/crawlers/${encodeURIComponent(id)}/${actionPath}`, { method: "POST" });
    showToast(result.message);
    await loadData(true);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#createButton").addEventListener("click", () => {
  state.editingCrawlerId = null;
  elements.createForm.reset();
  elements.createForm.elements.crawler_id.disabled = false;
  elements.crawlerDialogEyebrow.textContent = "NEW INSTANCE";
  elements.crawlerDialogTitle.textContent = "新建爬虫";
  elements.submitCrawler.textContent = "创建实例";
  elements.createError.textContent = "";
  elements.crawlerDialog.showModal();
});

elements.refreshButton.addEventListener("click", async () => {
  await loadData();
  scheduleAutoRefresh();
});
elements.refreshInterval.addEventListener("change", scheduleAutoRefresh);
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

loadData().finally(scheduleAutoRefresh);