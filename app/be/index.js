const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 8080;

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── Multer: lưu file upload vào /uploads ───────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Chỉ chấp nhận file ảnh (jpg, png, gif, webp)"));
  },
});

// ── State: lưu avatar URL hiện tại (in-memory, đủ cho demo) ─
let currentAvatar = null;

// ── Routes ──────────────────────────────────────────────────

// GET /api/profile — trả thông tin profile
app.get("/api/profile", (req, res) => {
  res.json({
    name: "Trần Thị Thúy Trang",
    title: "DevOps / Cloud Engineer",
    bio: "Passionate about GitOps, Kubernetes, and building automated delivery pipelines. I turn infrastructure into code and deployments into pipelines.",
    avatar: currentAvatar,
    skills: [
      { name: "Kubernetes", level: 85 },
      { name: "ArgoCD / GitOps", level: 80 },
      { name: "Docker", level: 90 },
      { name: "CI/CD (GitHub Actions)", level: 85 },
      { name: "Linux / Shell", level: 80 },
      { name: "Python / Node.js", level: 70 },
    ],
    projects: [
      {
        title: "GitOps Portfolio",
        desc: "App of Apps pattern with ArgoCD, auto-sync, sync-waves & GitHub Actions CI/CD.",
        tags: ["ArgoCD", "K8s", "GitHub Actions"],
      },
      {
        title: "K8s Cluster Setup",
        desc: "Bootstrapped a multi-node Kubernetes cluster with kubeadm and deployed monitoring stack.",
        tags: ["Kubernetes", "Prometheus", "Grafana"],
      },
      {
        title: "Container Pipeline",
        desc: "Automated Docker build, security scan, and push to registry on every PR merge.",
        tags: ["Docker", "Trivy", "CI/CD"],
      },
    ],
    contact: {
      email: "thuytrang@example.com",
      github: "https://github.com/ThuyTrang9525",
      linkedin: "https://linkedin.com/in/thuytrang",
    },
  });
});

// POST /api/upload-avatar — nhận file ảnh, trả về URL
app.post("/api/upload-avatar", upload.single("avatar"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Không có file được gửi lên" });
  }
  const host = req.get("host");
  const protocol = req.protocol;
  const avatarUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
  currentAvatar = avatarUrl;
  res.json({ success: true, avatarUrl });
});

// GET /api/health — health check cho K8s liveness probe
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Error handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
