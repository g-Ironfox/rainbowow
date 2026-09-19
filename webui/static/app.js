const state = { crawlers: [], busy: false };

const elements = {
  crawlerList: document.querySelector("#crawlerList"),
  emptyState: document.querySelector("#emptyState"),
  logList: document.querySelector("#logList"),
  logFilter: document.querySelector("#logFilter"),
  totalCount: document.querySelector("#totalCount"),
  runningCount: document.querySelector("#runningCount"),
  idleCount: document.querySelector("#idleCount"),
  healthDot: document.querySelector("#healthDot"),
  healthText: document.querySelector("#healthText"),
  createDialog: document.querySelector("#createDialog"),
  createForm: document.querySelector("#createForm"),
  createError: document.querySelector("#createError"),
  gotoDialog: document.querySelector("#gotoDialog"),
  gotoForm: document.querySelector("#gotoForm"),
  gotoError: document.querySelector("#gotoError"),
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
  elements.crawlerList.innerHTML = state.crawlers.map((crawler, index) => {
    const active = ["running", "idle"].includes(crawler.status);
    const lastMessage = crawler.last_log
      ? `${crawler.last_log.message}${crawler.last_log.detail ? ` · ${crawler.last_log.detail}` : ""}`
      : "暂无日志";
    return `
      <article class="crawler-card" style="animation-delay:${index * 35}ms">
        <div class="crawler-title">
          <span class="status-dot ${crawler.status}"></span>
          <div><strong>${escapeHtml(crawler.crawler_id)}</strong><span>${statusLabels[crawler.status]}</span></div>
        </div>
        <div class="crawler-meta">
          <strong title="${escapeHtml(crawler.user_data_dir)}">${escapeHtml(crawler.user_data_dir)}</strong>
          <span>${escapeHtml(lastMessage)} · ${formatTime(crawler.last_log?.timestamp)}</span>
        </div>
        <div class="crawler-actions">
          <button class="action-button" data-action="launch" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "disabled" : ""}>启动</button>
          <button class="action-button danger" data-action="terminate" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "" : "disabled"}>停止</button>
          <button class="action-button" data-action="goto" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "" : "disabled"}>跳转</button>
          <button class="action-button" data-action="surface" data-id="${escapeHtml(crawler.crawler_id)}" ${active ? "" : "disabled"}>抓取首页</button>
        </div>
      </article>`;
  }).join("");

  const selected = elements.logFilter.value;
  elements.logFilter.innerHTML = `<option value="">全部爬虫</option>${state.crawlers.map(crawler => `<option value="${escapeHtml(crawler.crawler_id)}">${escapeHtml(crawler.crawler_id)}</option>`).join("")}`;
  if (state.crawlers.some(crawler => crawler.crawler_id === selected)) elements.logFilter.value = selected;
}

function renderLogs(logs) {
  elements.logList.innerHTML = logs.length ? logs.map(log => `
    <div class="log-entry ${String(log.message).toLowerCase()}">
      <span class="log-time">${formatTime(log.timestamp)}</span>
      <span class="log-crawler" title="${escapeHtml(log.crawler_id)}">${escapeHtml(log.crawler_id)}</span>
      <span class="log-message"><strong>${escapeHtml(log.message)}</strong>${escapeHtml(log.detail || "")}</span>
    </div>`).join("") : `<div class="empty-state"><strong>暂无日志</strong></div>`;
}

async function loadData(silent = false) {
  if (state.busy) return;
  state.busy = true;
  try {
    const filter = elements.logFilter.value;
    const [crawlers, logs] = await Promise.all([
      api("/api/crawlers"),
      api(`/api/logs?limit=100${filter ? `&crawler_id=${encodeURIComponent(filter)}` : ""}`),
    ]);
    state.crawlers = crawlers;
    renderCrawlers();
    renderLogs(logs);
    elements.healthDot.className = "health-dot online";
    elements.healthText.textContent = "服务正常";
  } catch (error) {
    elements.healthDot.className = "health-dot offline";
    elements.healthText.textContent = "连接中断";
    if (!silent) showToast(error.message, true);
  } finally {
    state.busy = false;
  }
}

elements.crawlerList.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "goto") {
    elements.gotoForm.elements.crawler_id.value = id;
    elements.gotoError.textContent = "";
    elements.gotoDialog.showModal();
    return;
  }
  button.disabled = true;
  try {
    const result = await api(`/api/crawlers/${encodeURIComponent(id)}/${action === "surface" ? "actions/surface" : action}`, { method: "POST" });
    showToast(result.message);
    await loadData(true);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#createButton").addEventListener("click", () => {
  elements.createForm.reset();
  elements.createError.textContent = "";
  elements.createDialog.showModal();
});

document.querySelector("#refreshButton").addEventListener("click", () => loadData());
elements.logFilter.addEventListener("change", () => loadData());

elements.createForm.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(elements.createForm));
  try {
    await api("/api/crawlers", { method: "POST", body: JSON.stringify(data) });
    elements.createDialog.close();
    showToast("爬虫创建成功");
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

loadData();
setInterval(() => loadData(true), 5000);