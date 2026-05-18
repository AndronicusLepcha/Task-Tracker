const API = "";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let tasks = [];
let projects = [];
let chartRange = 7;
let charts = {};
let chartsInitialized = false;
let currentView = "list";
let currentTab = "tasks";
let sheetConnected = false;
let sortOrder = "desc";

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  checkConnection().then(async () => {
    if (sheetConnected) {
      await loadProjects();
      await loadTasks();
    } else {
      const savedCreds = localStorage.getItem("tt_credentials");
      const savedSheet = localStorage.getItem("tt_spreadsheetId");
      if (savedCreds && savedSheet) {
        try {
          const res = await fetch(`${API}/api/config/connect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              spreadsheetId: savedSheet,
              credentials: savedCreds,
              sheetName: localStorage.getItem("tt_sheetName") || undefined,
            }),
          });
          if (res.ok) {
            await checkConnection();
            await loadProjects();
            await loadTasks();
          } else {
            localStorage.removeItem("tt_spreadsheetId");
            localStorage.removeItem("tt_credentials");
            localStorage.removeItem("tt_sheetName");
          }
        } catch (e) {
          console.error("Auto-connect from saved credentials failed:", e);
        }
      }
    }
  });
  bindEvents();
});

function bindEvents() {
  $("#btn-settings").addEventListener("click", toggleSettings);
  $("#btn-close-settings").addEventListener("click", toggleSettings);
  $("#btn-refresh").addEventListener("click", refreshFromSheet);
  $("#btn-projects").addEventListener("click", toggleProjects);
  $("#btn-close-projects").addEventListener("click", toggleProjects);
  $("#project-form").addEventListener("submit", addProject);
  $("#config-form").addEventListener("submit", connectSheet);
  $("#btn-disconnect").addEventListener("click", disconnectSheet);
  $("#btn-add-task").addEventListener("click", openAddTask);
  $("#btn-close-add").addEventListener("click", closeAddTask);
  $("#btn-close-preview").addEventListener("click", closePreview);
  $("#btn-preview-edit").addEventListener("click", () => {
    const id = previewTaskId;
    closePreview();
    openEdit(id);
  });
  $("#btn-preview-delete").addEventListener("click", () => {
    const id = previewTaskId;
    closePreview();
    deleteTask(id);
  });
  $("#task-form").addEventListener("submit", addTask);
  $("#filter-search").addEventListener("input", renderAll);
  $("#filter-project").addEventListener("change", renderAll);
  $("#filter-category").addEventListener("change", renderAll);
  $("#filter-status").addEventListener("change", renderAll);
  $("#filter-date-from").addEventListener("change", renderAll);
  $("#filter-date-to").addEventListener("change", renderAll);
  $("#btn-clear-dates").addEventListener("click", clearDateFilters);
  $("#btn-sort").addEventListener("click", toggleSort);
  $("#edit-form").addEventListener("submit", saveEdit);
  $("#btn-close-modal").addEventListener("click", closeEditModal);
  $("#btn-cancel-edit").addEventListener("click", closeEditModal);
  $$(".modal-overlay").forEach((el) => el.addEventListener("click", closeAllModals));
  $("#btn-open-settings").addEventListener("click", () => {
    $("#settings-panel").classList.remove("hidden");
  });

  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTab = btn.dataset.tab;
      $$(".tab-content").forEach((el) => el.classList.add("hidden"));
      $(`#tab-${currentTab}`).classList.remove("hidden");
      if (currentTab === "dashboard") {
        if (!chartsInitialized) {
          initCharts();
          chartsInitialized = true;
        }
        updateDashboard();
      }
    });
  });

  $$(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".view-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentView = btn.dataset.view;
      if (currentView === "list") {
        $("#list-view").classList.remove("hidden");
        $("#project-view").classList.add("hidden");
      } else {
        $("#list-view").classList.add("hidden");
        $("#project-view").classList.remove("hidden");
        renderProjectBoard();
      }
    });
  });

  $$(".range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      chartRange = parseInt(btn.dataset.range);
      updateCharts();
    });
  });

  $("#credentials-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => ($("#credentials-json").value = reader.result);
    reader.readAsText(file);
  });
}

// --- API calls ---
async function loadTasks() {
  try {
    const res = await fetch(`${API}/api/tasks`);
    tasks = await res.json();
    renderAll();
    renderProjectList();
  } catch (e) {
    console.error("Failed to load tasks:", e);
  }
}

async function checkConnection() {
  try {
    const res = await fetch(`${API}/api/config/status`);
    const data = await res.json();
    sheetConnected = data.connected;
    updateConnectionUI(data);
    toggleAppState();
  } catch (e) {
    console.error("Failed to check connection:", e);
  }
}

function toggleAppState() {
  const banner = $("#connect-banner");
  const tabNav = $(".tab-nav");
  const tabTasks = $("#tab-tasks");
  const tabDash = $("#tab-dashboard");
  const refreshBtn = $("#btn-refresh");

  if (sheetConnected) {
    banner.classList.add("hidden");
    tabNav.classList.remove("hidden");
    refreshBtn.classList.remove("hidden");
    if (currentTab === "tasks") {
      tabTasks.classList.remove("hidden");
      tabDash.classList.add("hidden");
    } else {
      tabTasks.classList.add("hidden");
      tabDash.classList.remove("hidden");
    }
  } else {
    banner.classList.remove("hidden");
    tabNav.classList.add("hidden");
    refreshBtn.classList.add("hidden");
    tabTasks.classList.add("hidden");
    tabDash.classList.add("hidden");
    tasks = [];
    projects = [];
    renderAll();
    populateProjectDropdowns();
    renderProjectList();
  }
}

// --- Projects ---
async function loadProjects() {
  try {
    const res = await fetch(`${API}/api/projects`);
    projects = await res.json();
    populateProjectDropdowns();
    renderProjectList();
  } catch (e) {
    console.error("Failed to load projects:", e);
  }
}

async function addProject(e) {
  e.preventDefault();
  if (!sheetConnected) {
    alert("Please connect a Google Sheet first.");
    return;
  }
  const name = $("#project-name-input").value.trim();
  const color = $("#project-color-input").value;
  if (!name) return;

  try {
    const res = await fetch(`${API}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    const proj = await res.json();
    projects.push(proj);
    populateProjectDropdowns();
    renderProjectList();
    $("#project-name-input").value = "";
  } catch (err) {
    alert(err.message);
  }
}

async function deleteProject(id) {
  const proj = projects.find((p) => p.id === id);
  const taskCount = tasks.filter((t) => t.project === proj?.name).length;
  const msg = taskCount > 0
    ? `Delete "${proj.name}"? ${taskCount} task(s) are tagged with this project. They won't be deleted but will become unlinked.`
    : `Delete "${proj.name}"?`;
  if (!confirm(msg)) return;

  try {
    await fetch(`${API}/api/projects/${id}`, { method: "DELETE" });
    projects = projects.filter((p) => p.id !== id);
    populateProjectDropdowns();
    renderProjectList();
    renderAll();
  } catch (e) {
    alert("Error deleting project: " + e.message);
  }
}

function populateProjectDropdowns() {
  const selectors = ["#task-project", "#edit-project", "#filter-project"];
  selectors.forEach((sel) => {
    const el = $(sel);
    const current = el.value;
    const isFilter = sel === "#filter-project";
    const placeholder = isFilter ? "All Projects" : "Select a project...";
    el.innerHTML = `<option value="">${placeholder}</option>` +
      projects.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
    if (current) el.value = current;
  });
}

function renderProjectList() {
  const container = $("#project-list-manage");
  if (projects.length === 0) {
    container.innerHTML = '<p class="empty-state-sm">No projects yet. Add one above.</p>';
    return;
  }
  container.innerHTML = projects
    .map((p) => {
      const count = tasks.filter((t) => t.project === p.name).length;
      return `
      <div class="project-manage-item" style="border-left-color: ${p.color}">
        <span class="project-color-dot" style="background: ${p.color}"></span>
        <span class="project-manage-name">${esc(p.name)}</span>
        <span class="project-task-count">${count} task${count !== 1 ? "s" : ""}</span>
        <button class="btn btn-sm btn-danger" onclick="deleteProject(${p.id})">Del</button>
      </div>`;
    })
    .join("");
}

function toggleProjects() {
  $("#projects-panel").classList.toggle("hidden");
}

function getProjectColor(name) {
  const p = projects.find((pr) => pr.name === name);
  return p ? p.color : "#94a3b8";
}

async function connectSheet(e) {
  e.preventDefault();
  const btn = $("#btn-connect");
  btn.classList.add("loading");
  btn.textContent = "Connecting...";

  const spreadsheetId = $("#spreadsheet-id").value.trim();
  const credentials = $("#credentials-json").value.trim();
  const sheetName = $("#sheet-name").value.trim() || undefined;

  try {
    const res = await fetch(`${API}/api/config/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spreadsheetId, credentials, sheetName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    localStorage.setItem("tt_spreadsheetId", spreadsheetId);
    localStorage.setItem("tt_credentials", credentials);
    if (sheetName) localStorage.setItem("tt_sheetName", sheetName);

    showMessage("config-message", `Connected! ${data.tasksLoaded} tasks, ${data.projectsLoaded || 0} projects loaded.`, "success");
    await checkConnection();
    await loadProjects();
    await loadTasks();
  } catch (err) {
    showMessage("config-message", err.message, "error");
  } finally {
    btn.classList.remove("loading");
    btn.textContent = "Connect Sheet";
  }
}

async function refreshFromSheet() {
  const btn = $("#btn-refresh");
  btn.classList.add("loading");
  try {
    const res = await fetch(`${API}/api/config/refresh`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadProjects();
    await loadTasks();
  } catch (err) {
    alert("Refresh failed: " + err.message);
  } finally {
    btn.classList.remove("loading");
  }
}

async function disconnectSheet() {
  try {
    localStorage.removeItem("tt_spreadsheetId");
    localStorage.removeItem("tt_credentials");
    localStorage.removeItem("tt_sheetName");
    await fetch(`${API}/api/config/disconnect`, { method: "POST" });
    await checkConnection();
    showMessage("config-message", "Disconnected. All data cleared from local view.", "success");
  } catch (e) {
    console.error(e);
  }
}

async function addTask(e) {
  e.preventDefault();
  if (!sheetConnected) {
    alert("Please connect a Google Sheet first.");
    return;
  }
  const task = {
    date: $("#task-date").value,
    project: $("#task-project").value,
    description: $("#task-description").value.trim(),
    category: $("#task-category").value,
    status: $("#task-status").value,
  };

  try {
    const res = await fetch(`${API}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task),
    });
    if (!res.ok) throw new Error("Failed to add task");
    const newTask = await res.json();
    tasks.push(newTask);
    renderAll();
    renderProjectList();
    $("#task-form").reset();
    closeAddTask();
  } catch (e) {
    alert("Error adding task: " + e.message);
  }
}

async function deleteTask(id) {
  if (!confirm("Delete this task?")) return;
  try {
    await fetch(`${API}/api/tasks/${id}`, { method: "DELETE" });
    tasks = tasks.filter((t) => t.id !== id);
    renderAll();
    renderProjectList();
  } catch (e) {
    alert("Error deleting task: " + e.message);
  }
}

async function saveEdit(e) {
  e.preventDefault();
  const id = parseInt($("#edit-id").value);
  const updated = {
    date: $("#edit-date").value,
    project: $("#edit-project").value,
    description: $("#edit-description").value.trim(),
    category: $("#edit-category").value,
    status: $("#edit-status").value,
  };

  try {
    const res = await fetch(`${API}/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    if (!res.ok) throw new Error("Failed to update task");
    const updatedTask = await res.json();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx !== -1) tasks[idx] = updatedTask;
    renderAll();
    renderProjectList();
    closeEditModal();
  } catch (e) {
    alert("Error updating task: " + e.message);
  }
}

// --- Rendering ---
function renderAll() {
  renderTasks();
  updateStats();
  if (currentView === "project") renderProjectBoard();
  if (currentTab === "dashboard" && chartsInitialized) updateDashboard();
}

function updateDashboard() {
  updateDashboardStats();
  updateCharts();
  renderProjectSummaryTable();
}

function updateDashboardStats() {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.category === "Completed" || t.status === "Done").length;
  const inProgress = tasks.filter((t) => t.category === "In Progress" || t.status === "In Progress").length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

  $("#dash-total").textContent = total;
  $("#dash-completed").textContent = completed;
  $("#dash-in-progress").textContent = inProgress;
  $("#dash-completion-rate").textContent = rate + "%";
}

function renderProjectSummaryTable() {
  const container = $("#project-summary-table");
  if (projects.length === 0) {
    container.innerHTML = '<p class="empty-state-sm">Add projects to see a breakdown here.</p>';
    return;
  }

  const rows = projects.map((p) => {
    const pTasks = tasks.filter((t) => t.project === p.name);
    const total = pTasks.length;
    const done = pTasks.filter((t) => t.status === "Done" || t.category === "Completed").length;
    const inProg = pTasks.filter((t) => t.status === "In Progress" || t.category === "In Progress").length;
    const blocked = pTasks.filter((t) => t.status === "Blocked").length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return `<tr>
      <td><span class="proj-name-cell"><span class="color-dot" style="background:${p.color};width:10px;height:10px;border-radius:50%;display:inline-block;"></span>${esc(p.name)}</span></td>
      <td>${total}</td>
      <td>${done}</td>
      <td>${inProg}</td>
      <td>${blocked}</td>
      <td>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${p.color}"></div></div>
      </td>
      <td>${pct}%</td>
    </tr>`;
  }).join("");

  container.innerHTML = `<table class="project-summary">
    <thead><tr><th>Project</th><th>Total</th><th>Done</th><th>Active</th><th>Blocked</th><th>Progress</th><th>%</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function getFilteredTasks() {
  const search = $("#filter-search").value.toLowerCase();
  const projFilter = $("#filter-project").value;
  const catFilter = $("#filter-category").value;
  const statusFilter = $("#filter-status").value;
  const dateFrom = $("#filter-date-from").value;
  const dateTo = $("#filter-date-to").value;

  return tasks.filter((t) => {
    if (projFilter && t.project !== projFilter) return false;
    if (catFilter && t.category !== catFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
    if (search) {
      const haystack = `${t.project} ${t.description} ${t.date}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function renderTasks() {
  const filtered = getFilteredTasks();
  const countLabel = $("#task-count-label");
  countLabel.textContent = filtered.length === tasks.length
    ? `${tasks.length} task${tasks.length !== 1 ? "s" : ""}`
    : `${filtered.length} of ${tasks.length} tasks`;

  const container = $("#task-list");
  if (filtered.length === 0) {
    container.innerHTML = '<p class="empty-state">No tasks match your filters.</p>';
    return;
  }

  const sorted = [...filtered].sort((a, b) => {
    const cmp = (a.date || "").localeCompare(b.date || "");
    return sortOrder === "desc" ? -cmp : cmp;
  });

  container.innerHTML = sorted
    .map(
      (t) => `
    <div class="task-item" data-id="${t.id}" onclick="openPreview(${t.id})">
      <div class="task-date">${formatDate(t.date)}</div>
      <div class="task-body">
        <div class="project-tag">
          <span class="color-dot" style="background:${getProjectColor(t.project)}"></span>
          ${esc(t.project)}
        </div>
        <div class="task-desc">${esc(t.description)}</div>
      </div>
      <div class="task-meta">
        <span class="badge ${badgeClass(t.category)}">${esc(t.category)}</span>
        <span class="badge ${statusBadgeClass(t.status)}">${esc(t.status)}</span>
        <div class="task-actions">
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); openEdit(${t.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteTask(${t.id})">Del</button>
        </div>
      </div>
    </div>
  `
    )
    .join("");
}

function renderProjectBoard() {
  const filtered = getFilteredTasks();
  const board = $("#project-board");

  const grouped = {};
  filtered.forEach((t) => {
    const key = t.project || "Unassigned";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(t);
  });

  const projectOrder = projects.map((p) => p.name);
  Object.keys(grouped).forEach((k) => {
    if (!projectOrder.includes(k)) projectOrder.push(k);
  });

  const columns = projectOrder
    .filter((name) => grouped[name])
    .map((name) => {
      const items = grouped[name].sort((a, b) => {
        const cmp = (a.date || "").localeCompare(b.date || "");
        return sortOrder === "desc" ? -cmp : cmp;
      });
      const color = getProjectColor(name);
      const done = items.filter((t) => t.status === "Done" || t.category === "Completed").length;
      const inProg = items.filter((t) => t.status === "In Progress" || t.category === "In Progress").length;

      const rows = items
        .map(
          (t) => `
        <div class="project-task-row" onclick="openPreview(${t.id})">
          <span class="pt-date">${formatDate(t.date)}</span>
          <span class="pt-desc">${esc(t.description)}</span>
          <span class="badge ${badgeClass(t.category)}">${esc(t.category)}</span>
          <span class="badge ${statusBadgeClass(t.status)}">${esc(t.status)}</span>
        </div>`
        )
        .join("");

      return `
      <div class="project-column">
        <div class="project-column-header" style="border-left-color:${color}">
          <h3>
            <span class="color-dot" style="background:${color}; width:12px; height:12px; border-radius:50%; display:inline-block;"></span>
            ${esc(name)}
            <span class="col-count">${items.length}</span>
          </h3>
          <div class="col-stats">
            <span>${done} done</span>
            <span>${inProg} active</span>
          </div>
        </div>
        <div class="project-column-body">${rows}</div>
      </div>`;
    })
    .join("");

  board.innerHTML = columns || '<p class="empty-state">No tasks to display. Try adjusting your filters.</p>';
}

function updateStats() {
  $("#stat-total").textContent = tasks.length;
  $("#stat-completed").textContent = tasks.filter(
    (t) => t.category === "Completed" || t.status === "Done"
  ).length;
  $("#stat-in-progress").textContent = tasks.filter(
    (t) => t.category === "In Progress" || t.status === "In Progress"
  ).length;
  $("#stat-todo").textContent = tasks.filter(
    (t) => t.category === "To-Do" && t.status !== "Done"
  ).length;
}

function updateConnectionUI(data) {
  const badge = $("#sync-status");
  const detail = $("#connection-status-detail");
  const disconnectBtn = $("#btn-disconnect");

  if (data.connected) {
    badge.className = "sync-badge connected";
    badge.textContent = "Sheet Connected";
    detail.className = "connection-detail active";
    detail.innerHTML = `Connected to sheet <strong>${data.spreadsheetId}</strong><br/>Service account: <strong>${data.serviceAccountEmail}</strong><br/>Tab: <strong>${data.sheetName}</strong>`;
    disconnectBtn.classList.remove("hidden");
  } else {
    badge.className = "sync-badge disconnected";
    badge.textContent = "Not Connected";
    detail.className = "connection-detail inactive";
    detail.textContent = "No Google Sheet connected. Connect a sheet to start tracking tasks.";
    disconnectBtn.classList.add("hidden");
  }
}

// --- UI Helpers ---
function toggleSettings() {
  $("#settings-panel").classList.toggle("hidden");
}

function openAddTask() {
  $("#task-date").value = new Date().toISOString().split("T")[0];
  $("#add-task-modal").classList.remove("hidden");
}

function closeAddTask() {
  $("#add-task-modal").classList.add("hidden");
}

let previewTaskId = null;

function openPreview(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  previewTaskId = id;
  const color = getProjectColor(task.project);
  $("#preview-project").innerHTML = `<span class="color-dot" style="background:${color}"></span> ${esc(task.project)}`;
  $("#preview-date").textContent = formatDate(task.date);
  $("#preview-description").textContent = task.description;
  const catEl = $("#preview-category");
  catEl.textContent = task.category;
  catEl.className = `badge ${badgeClass(task.category)}`;
  const statusEl = $("#preview-status");
  statusEl.textContent = task.status;
  statusEl.className = `badge ${statusBadgeClass(task.status)}`;
  $("#preview-modal").classList.remove("hidden");
}

function closePreview() {
  $("#preview-modal").classList.add("hidden");
  previewTaskId = null;
}

function openEdit(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  $("#edit-id").value = task.id;
  $("#edit-date").value = task.date;
  $("#edit-project").value = task.project;
  $("#edit-description").value = task.description;
  $("#edit-category").value = task.category;
  $("#edit-status").value = task.status;
  $("#edit-modal").classList.remove("hidden");
}

function closeEditModal() {
  $("#edit-modal").classList.add("hidden");
}

function closeAllModals() {
  $("#edit-modal").classList.add("hidden");
  $("#add-task-modal").classList.add("hidden");
  $("#preview-modal").classList.add("hidden");
  previewTaskId = null;
}

function toggleSort() {
  sortOrder = sortOrder === "desc" ? "asc" : "desc";
  const btn = $("#btn-sort");
  btn.textContent = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p1.setAttribute("d", "M12 5v14");
  const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p2.setAttribute("d", "M19 12l-7 7-7-7");
  svg.appendChild(p1);
  svg.appendChild(p2);
  btn.appendChild(svg);
  btn.appendChild(document.createTextNode(sortOrder === "desc" ? " Newest First" : " Oldest First"));
  if (sortOrder === "asc") {
    btn.classList.add("sort-asc");
  } else {
    btn.classList.remove("sort-asc");
  }
  renderAll();
}

function clearDateFilters() {
  $("#filter-date-from").value = "";
  $("#filter-date-to").value = "";
  renderAll();
}

function showMessage(id, text, type) {
  const el = $(`#${id}`);
  el.textContent = text;
  el.className = `message ${type}`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 5000);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function badgeClass(category) {
  const map = {
    "To-Do": "badge-todo",
    "In Progress": "badge-in-progress",
    Completed: "badge-completed",
    "On Hold": "badge-on-hold",
    Review: "badge-review",
  };
  return map[category] || "badge-todo";
}

function statusBadgeClass(status) {
  const map = {
    "Not Started": "badge-status-not-started",
    "In Progress": "badge-status-in-progress",
    Done: "badge-status-done",
    Blocked: "badge-status-blocked",
  };
  return map[status] || "badge-status-not-started";
}

function esc(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

// --- Charts ---
function initCharts() {
  const fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  Chart.defaults.font.family = fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = "#64748b";
  const titleFont = { size: 14, weight: "600" };
  const titleColor = "#1e293b";

  charts.daily = new Chart($("#chart-daily"), {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: "Tasks Per Day", font: titleFont, color: titleColor },
        legend: { display: true, position: "bottom", labels: { boxWidth: 12, padding: 12 } },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });

  charts.trend = new Chart($("#chart-trend"), {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: "Cumulative Completion Trend", font: titleFont, color: titleColor },
        legend: { display: true, position: "bottom", labels: { boxWidth: 12, padding: 12 } },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });

  charts.category = new Chart($("#chart-category"), {
    type: "doughnut",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: "By Category", font: titleFont, color: titleColor },
        legend: { position: "bottom", labels: { boxWidth: 12, padding: 10 } },
      },
      cutout: "55%",
    },
  });

  charts.status = new Chart($("#chart-status"), {
    type: "doughnut",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: "By Status", font: titleFont, color: titleColor },
        legend: { position: "bottom", labels: { boxWidth: 12, padding: 10 } },
      },
      cutout: "55%",
    },
  });

  charts.projects = new Chart($("#chart-projects"), {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        title: { display: true, text: "Tasks Per Project", font: titleFont, color: titleColor },
        legend: { display: false },
      },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { display: false } },
        y: { grid: { display: false } },
      },
    },
  });

  charts.projectStatus = new Chart($("#chart-project-status"), {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: "Project Status Breakdown", font: titleFont, color: titleColor },
        legend: { display: true, position: "bottom", labels: { boxWidth: 12, padding: 12 } },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });
}

function getFilteredByRange() {
  if (chartRange === 0) return tasks;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - chartRange);
  return tasks.filter((t) => {
    const d = new Date(t.date + "T00:00:00");
    return d >= cutoff;
  });
}

function updateCharts() {
  if (!charts.daily) return;
  const filtered = getFilteredByRange();

  updateDailyChart(filtered);
  updateTrendChart(filtered);
  updateCategoryChart(filtered);
  updateStatusChart(filtered);
  updateProjectsChart(filtered);
  updateProjectStatusChart(filtered);
}

function updateDailyChart(filtered) {
  const dateMap = {};
  filtered.forEach((t) => {
    if (!t.date) return;
    if (!dateMap[t.date]) dateMap[t.date] = { completed: 0, active: 0 };
    if (t.status === "Done" || t.category === "Completed") {
      dateMap[t.date].completed++;
    } else {
      dateMap[t.date].active++;
    }
  });

  const dates = Object.keys(dateMap).sort();
  const labels = dates.map((d) => {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  charts.daily.data.labels = labels;
  charts.daily.data.datasets = [
    {
      label: "Completed",
      data: dates.map((d) => dateMap[d].completed),
      backgroundColor: "#22c55e",
      borderRadius: 4,
    },
    {
      label: "Active",
      data: dates.map((d) => dateMap[d].active),
      backgroundColor: "#6366f1",
      borderRadius: 4,
    },
  ];
  charts.daily.update();
}

function updateTrendChart(filtered) {
  const dateMap = {};
  filtered.forEach((t) => {
    if (!t.date) return;
    if (!dateMap[t.date]) dateMap[t.date] = { added: 0, completed: 0 };
    dateMap[t.date].added++;
    if (t.status === "Done" || t.category === "Completed") {
      dateMap[t.date].completed++;
    }
  });

  const dates = Object.keys(dateMap).sort();
  let cumAdded = 0;
  let cumCompleted = 0;
  const addedData = [];
  const completedData = [];
  const labels = dates.map((d) => {
    cumAdded += dateMap[d].added;
    cumCompleted += dateMap[d].completed;
    addedData.push(cumAdded);
    completedData.push(cumCompleted);
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  charts.trend.data.labels = labels;
  charts.trend.data.datasets = [
    {
      label: "Total Tasks",
      data: addedData,
      borderColor: "#6366f1",
      backgroundColor: "rgba(99,102,241,0.1)",
      fill: true,
      tension: 0.3,
      pointRadius: 3,
    },
    {
      label: "Completed",
      data: completedData,
      borderColor: "#22c55e",
      backgroundColor: "rgba(34,197,94,0.1)",
      fill: true,
      tension: 0.3,
      pointRadius: 3,
    },
  ];
  charts.trend.update();
}

function updateCategoryChart(filtered) {
  const catColors = {
    "To-Do": "#6366f1",
    "In Progress": "#f59e0b",
    Completed: "#22c55e",
    "On Hold": "#94a3b8",
    Review: "#a855f7",
  };
  const counts = {};
  filtered.forEach((t) => {
    counts[t.category] = (counts[t.category] || 0) + 1;
  });
  const labels = Object.keys(counts);

  charts.category.data.labels = labels;
  charts.category.data.datasets = [
    {
      data: labels.map((l) => counts[l]),
      backgroundColor: labels.map((l) => catColors[l] || "#94a3b8"),
      borderWidth: 0,
    },
  ];
  charts.category.update();
}

function updateStatusChart(filtered) {
  const statusColors = {
    "Not Started": "#94a3b8",
    "In Progress": "#f97316",
    Done: "#22c55e",
    Blocked: "#ef4444",
  };
  const counts = {};
  filtered.forEach((t) => {
    counts[t.status] = (counts[t.status] || 0) + 1;
  });
  const labels = Object.keys(counts);

  charts.status.data.labels = labels;
  charts.status.data.datasets = [
    {
      data: labels.map((l) => counts[l]),
      backgroundColor: labels.map((l) => statusColors[l] || "#94a3b8"),
      borderWidth: 0,
    },
  ];
  charts.status.update();
}

function updateProjectsChart(filtered) {
  const counts = {};
  filtered.forEach((t) => {
    counts[t.project] = (counts[t.project] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const labels = sorted.map((s) => s[0]);
  const data = sorted.map((s) => s[1]);

  charts.projects.data.labels = labels;
  charts.projects.data.datasets = [
    {
      data,
      backgroundColor: labels.map((l) => getProjectColor(l)),
      borderRadius: 4,
    },
  ];
  charts.projects.update();
}

function updateProjectStatusChart(filtered) {
  const projNames = projects.map((p) => p.name);
  const statusKeys = ["Done", "In Progress", "Not Started", "Blocked"];
  const statusColors = { "Done": "#22c55e", "In Progress": "#f97316", "Not Started": "#94a3b8", "Blocked": "#ef4444" };

  const data = {};
  projNames.forEach((name) => {
    data[name] = {};
    statusKeys.forEach((s) => (data[name][s] = 0));
  });

  filtered.forEach((t) => {
    if (data[t.project] && statusKeys.includes(t.status)) {
      data[t.project][t.status]++;
    }
  });

  charts.projectStatus.data.labels = projNames;
  charts.projectStatus.data.datasets = statusKeys.map((s) => ({
    label: s,
    data: projNames.map((name) => data[name][s]),
    backgroundColor: statusColors[s],
    borderRadius: 4,
  }));
  charts.projectStatus.update();
}
