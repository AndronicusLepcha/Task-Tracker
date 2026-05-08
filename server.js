require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

let sheetsConfig = {
  spreadsheetId: null,
  credentials: null,
  sheetName: "Tasks",
};

let localTasks = [];
let nextId = 1;
let projects = [];
let nextProjectId = 1;

const DEFAULT_PROJECT_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#14b8a6", "#e11d48",
];

function nextColor() {
  return DEFAULT_PROJECT_COLORS[(nextProjectId - 1) % DEFAULT_PROJECT_COLORS.length];
}

function isConnected() {
  return !!(sheetsConfig.credentials && sheetsConfig.spreadsheetId);
}

function requireSheet(req, res, next) {
  if (!isConnected()) {
    return res.status(400).json({ error: "No Google Sheet connected. Please connect a sheet first." });
  }
  next();
}

function getSheetsClient() {
  if (!isConnected()) return null;
  const auth = new google.auth.GoogleAuth({
    credentials: sheetsConfig.credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function ensureTab(sheets, tabName) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetsConfig.spreadsheetId,
  });
  const exists = meta.data.sheets.some((s) => s.properties.title === tabName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetsConfig.spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
  }
}

async function ensureSheetHeader(sheets) {
  await ensureTab(sheets, sheetsConfig.sheetName);
  const range = `${sheetsConfig.sheetName}!A1:F1`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsConfig.spreadsheetId,
    range,
  });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsConfig.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: {
        values: [["ID", "Date", "Project", "Task Description", "Category", "Status"]],
      },
    });
  }
}

async function ensureProjectsHeader(sheets) {
  await ensureTab(sheets, "Projects");
  const range = "Projects!A1:C1";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsConfig.spreadsheetId,
    range,
  });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsConfig.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: {
        values: [["ID", "Name", "Color"]],
      },
    });
  }
}

async function syncAllTasksToSheet(sheets) {
  await ensureSheetHeader(sheets);
  const dataRange = `${sheetsConfig.sheetName}!A2:F`;
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetsConfig.spreadsheetId,
      range: dataRange,
    });
  } catch (_) {}
  if (localTasks.length > 0) {
    const rows = localTasks.map((t) => [t.id, t.date, t.project, t.description, t.category, t.status]);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsConfig.spreadsheetId,
      range: `${sheetsConfig.sheetName}!A2:F${rows.length + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
  }
}

async function syncAllProjectsToSheet(sheets) {
  await ensureProjectsHeader(sheets);
  const dataRange = "Projects!A2:C";
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetsConfig.spreadsheetId,
      range: dataRange,
    });
  } catch (_) {}
  if (projects.length > 0) {
    const rows = projects.map((p) => [p.id, p.name, p.color]);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsConfig.spreadsheetId,
      range: `Projects!A2:C${rows.length + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
  }
}

async function loadFromSheet(sheets) {
  await ensureSheetHeader(sheets);
  const range = `${sheetsConfig.sheetName}!A2:F`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsConfig.spreadsheetId,
    range,
  });
  localTasks = [];
  nextId = 1;
  if (res.data.values && res.data.values.length > 0) {
    localTasks = res.data.values
      .filter((row) => row[0])
      .map((row) => ({
        id: parseInt(row[0]) || nextId++,
        date: row[1] || "",
        project: row[2] || "",
        description: row[3] || "",
        category: row[4] || "",
        status: row[5] || "",
      }));
    const maxId = Math.max(0, ...localTasks.map((t) => t.id));
    nextId = maxId + 1;
  }
}

async function loadProjectsFromSheet(sheets) {
  await ensureProjectsHeader(sheets);
  const range = "Projects!A2:C";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsConfig.spreadsheetId,
    range,
  });
  projects = [];
  nextProjectId = 1;
  if (res.data.values && res.data.values.length > 0) {
    projects = res.data.values
      .filter((row) => row[0])
      .map((row) => ({
        id: parseInt(row[0]) || nextProjectId++,
        name: row[1] || "",
        color: row[2] || "#94a3b8",
      }));
    const maxId = Math.max(0, ...projects.map((p) => p.id));
    nextProjectId = maxId + 1;
  }
}

// --- Config Routes ---

app.get("/api/config/status", (req, res) => {
  res.json({
    connected: isConnected(),
    spreadsheetId: sheetsConfig.spreadsheetId || null,
    serviceAccountEmail: sheetsConfig.credentials?.client_email || null,
    sheetName: sheetsConfig.sheetName,
  });
});

app.post("/api/config/connect", async (req, res) => {
  const { spreadsheetId, credentials, sheetName } = req.body;
  if (!spreadsheetId || !credentials) {
    return res.status(400).json({ error: "spreadsheetId and credentials are required" });
  }
  try {
    const parsed = typeof credentials === "string" ? JSON.parse(credentials) : credentials;
    sheetsConfig.credentials = parsed;
    sheetsConfig.spreadsheetId = spreadsheetId;
    if (sheetName) sheetsConfig.sheetName = sheetName;

    const sheets = getSheetsClient();
    await loadProjectsFromSheet(sheets);
    await loadFromSheet(sheets);

    res.json({
      success: true,
      message: "Connected to Google Sheet",
      serviceAccountEmail: parsed.client_email,
      tasksLoaded: localTasks.length,
      projectsLoaded: projects.length,
    });
  } catch (err) {
    sheetsConfig.credentials = null;
    sheetsConfig.spreadsheetId = null;
    localTasks = [];
    projects = [];
    nextId = 1;
    nextProjectId = 1;
    res.status(400).json({ error: `Connection failed: ${err.message}` });
  }
});

app.post("/api/config/refresh", requireSheet, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    await loadProjectsFromSheet(sheets);
    await loadFromSheet(sheets);
    res.json({ success: true, tasksLoaded: localTasks.length, projectsLoaded: projects.length });
  } catch (err) {
    res.status(500).json({ error: `Refresh failed: ${err.message}` });
  }
});

app.post("/api/config/disconnect", (req, res) => {
  sheetsConfig.credentials = null;
  sheetsConfig.spreadsheetId = null;
  localTasks = [];
  projects = [];
  nextId = 1;
  nextProjectId = 1;
  res.json({ success: true });
});

// --- Task Routes (all require sheet) ---

app.get("/api/tasks", (req, res) => {
  if (!isConnected()) return res.json([]);
  res.json(localTasks);
});

app.post("/api/tasks", requireSheet, async (req, res) => {
  const { date, project, description, category, status } = req.body;
  if (!date || !project || !description) {
    return res.status(400).json({ error: "date, project, and description are required" });
  }
  const task = {
    id: nextId++,
    date,
    project,
    description,
    category: category || "To-Do",
    status: status || "Not Started",
  };
  localTasks.push(task);

  const sheets = getSheetsClient();
  try {
    await ensureSheetHeader(sheets);
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetsConfig.spreadsheetId,
      range: `${sheetsConfig.sheetName}!A:F`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[task.id, task.date, task.project, task.description, task.category, task.status]],
      },
    });
  } catch (err) {
    console.error("Sheet sync error on add:", err.message);
  }
  res.status(201).json(task);
});

app.put("/api/tasks/:id", requireSheet, async (req, res) => {
  const id = parseInt(req.params.id);
  const idx = localTasks.findIndex((t) => t.id === id);
  if (idx === -1) return res.status(404).json({ error: "Task not found" });

  const { date, project, description, category, status } = req.body;
  if (date !== undefined) localTasks[idx].date = date;
  if (project !== undefined) localTasks[idx].project = project;
  if (description !== undefined) localTasks[idx].description = description;
  if (category !== undefined) localTasks[idx].category = category;
  if (status !== undefined) localTasks[idx].status = status;

  const sheets = getSheetsClient();
  try {
    await syncAllTasksToSheet(sheets);
  } catch (err) {
    console.error("Sheet sync error on update:", err.message);
  }
  res.json(localTasks[idx]);
});

app.delete("/api/tasks/:id", requireSheet, async (req, res) => {
  const id = parseInt(req.params.id);
  const idx = localTasks.findIndex((t) => t.id === id);
  if (idx === -1) return res.status(404).json({ error: "Task not found" });

  localTasks.splice(idx, 1);

  const sheets = getSheetsClient();
  try {
    await syncAllTasksToSheet(sheets);
  } catch (err) {
    console.error("Sheet sync error on delete:", err.message);
  }
  res.json({ success: true });
});

// --- Project Routes (all require sheet) ---

app.get("/api/projects", (req, res) => {
  if (!isConnected()) return res.json([]);
  res.json(projects);
});

app.post("/api/projects", requireSheet, async (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (projects.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(409).json({ error: "Project already exists" });
  }
  const project = {
    id: nextProjectId++,
    name: name.trim(),
    color: color || nextColor(),
  };
  projects.push(project);

  const sheets = getSheetsClient();
  try {
    await ensureProjectsHeader(sheets);
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetsConfig.spreadsheetId,
      range: "Projects!A:C",
      valueInputOption: "RAW",
      requestBody: {
        values: [[project.id, project.name, project.color]],
      },
    });
  } catch (err) {
    console.error("Sheet sync error on project add:", err.message);
  }
  res.status(201).json(project);
});

app.put("/api/projects/:id", requireSheet, async (req, res) => {
  const id = parseInt(req.params.id);
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Project not found" });

  const { name, color } = req.body;
  const oldName = projects[idx].name;
  if (name !== undefined) {
    const trimmed = name.trim();
    if (!trimmed) return res.status(400).json({ error: "name cannot be empty" });
    const dup = projects.find((p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase());
    if (dup) return res.status(409).json({ error: "Project name already exists" });
    projects[idx].name = trimmed;
    if (trimmed !== oldName) {
      localTasks.forEach((t) => {
        if (t.project === oldName) t.project = trimmed;
      });
    }
  }
  if (color !== undefined) projects[idx].color = color;

  const sheets = getSheetsClient();
  try {
    await syncAllProjectsToSheet(sheets);
    if (name !== undefined && name.trim() !== oldName) {
      await syncAllTasksToSheet(sheets);
    }
  } catch (err) {
    console.error("Sheet sync error on project update:", err.message);
  }
  res.json(projects[idx]);
});

app.delete("/api/projects/:id", requireSheet, async (req, res) => {
  const id = parseInt(req.params.id);
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Project not found" });
  projects.splice(idx, 1);

  const sheets = getSheetsClient();
  try {
    await syncAllProjectsToSheet(sheets);
  } catch (err) {
    console.error("Sheet sync error on project delete:", err.message);
  }
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Task Tracker running at http://localhost:${PORT}`);
});
