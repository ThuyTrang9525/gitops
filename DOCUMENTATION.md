# GitOps Portfolio — Tài liệu kỹ thuật toàn hệ thống

> **Mục đích tài liệu:** Giải thích toàn bộ kiến trúc, luồng hoạt động, và ý nghĩa từng thông số trong mỗi file của dự án. Không thay đổi bất kỳ dòng code nào.
> **Cập nhật lần cuối:** Phản ánh đúng cấu hình canary background analysis, AnalysisTemplate success-rate ≥ 95%, và chi tiết alert timeline.

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Cấu trúc thư mục](#2-cấu-trúc-thư-mục)
3. [Luồng hoạt động chi tiết](#3-luồng-hoạt-động-chi-tiết)
4. [ArgoCD — App of Apps Pattern](#4-argocd--app-of-apps-pattern)
5. [Namespace & Sync Wave](#5-namespace--sync-wave)
6. [Ứng dụng Web (k8s/)](#6-ứng-dụng-web-k8s)
7. [Frontend (k8s/fe/)](#7-frontend-k8sfe)
8. [Backend (k8s/be/)](#8-backend-k8sbe)
9. [API Service với Argo Rollouts (k8s-api/)](#9-api-service-với-argo-rollouts-k8s-api)
10. [Monitoring Stack — Prometheus & Alerting](#10-monitoring-stack--prometheus--alerting)
11. [Alert Timeline — Khi nào, bao lâu, điều gì xảy ra](#11-alert-timeline--khi-nào-bao-lâu-điều-gì-xảy-ra)
12. [Ứng dụng Flask (app/)](#12-ứng-dụng-flask-app)
13. [CI/CD — GitHub Actions](#13-cicd--github-actions)
14. [Bảng tóm tắt các thông số quan trọng](#14-bảng-tóm-tắt-các-thông-số-quan-trọng)

---

## 1. Tổng quan kiến trúc

Dự án này là một hệ thống **GitOps hoàn chỉnh** chạy trên Kubernetes, sử dụng Git repository làm nguồn sự thật duy nhất (source of truth). Bất kỳ thay đổi nào trên cluster đều phải đi qua Git.

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Repository                         │
│   (ThuyTrang9525/gitops)                                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Poll / Webhook (mỗi 3 phút)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ArgoCD (namespace: argocd)                    │
│                                                                  │
│  root (App of Apps)                                             │
│  └── argocd/apps/                                               │
│       ├── web.yaml              → deploy k8s/                   │
│       ├── fe.yaml               → deploy k8s/fe/                │
│       ├── be.yaml               → deploy k8s/be/                │
│       ├── api.yaml              → deploy k8s-api/               │
│       ├── argo-rollouts.yaml    → cài Argo Rollouts từ Helm     │
│       └── kube-prometheus-stack.yaml → cài Prometheus từ Helm  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Kubernetes Cluster                             │
│                                                                  │
│  namespace: demo                                                 │
│  ├── frontend Pod  (nginx:1.27 — serve index.html)              │
│  ├── backend Pod   (nginx:1.27 — mock REST API)                 │
│  ├── web Pod       (nginx:1.27 — configmap env demo)            │
│  └── api Rollout   (Flask — Argo Rollouts Canary + Analysis)    │
│                                                                  │
│  namespace: monitoring                                           │
│  └── kube-prometheus-stack                                      │
│      ├── Prometheus Server                                      │
│      ├── Prometheus Operator                                    │
│      ├── Alertmanager                                           │
│      ├── Grafana                                                │
│      └── node-exporter / kube-state-metrics                    │
│                                                                  │
│  namespace: argo-rollouts                                        │
│  └── Argo Rollouts Controller                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Công nghệ sử dụng:**

| Công nghệ | Vai trò |
|---|---|
| ArgoCD | GitOps controller — đồng bộ Git → K8s tự động |
| Argo Rollouts | Triển khai Canary với background analysis tự động |
| Prometheus | Thu thập và lưu trữ metrics từ ứng dụng |
| Prometheus Operator | Quản lý cấu hình Prometheus qua CRD (ServiceMonitor, PrometheusRule) |
| Alertmanager | Nhận alert từ Prometheus, route đến Slack/email |
| Flask + prometheus-flask-exporter | Ứng dụng API sinh metrics tự động |
| nginx | Web server cho FE và mock API cho BE |
| GitHub Actions | Validate K8s manifest schema khi có Pull Request |

---

## 2. Cấu trúc thư mục

```
gitops/
│
├── .github/
│   └── workflows/
│       └── validate.yml          # CI: validate K8s manifest khi PR
│
├── app/
│   ├── app.py                    # Flask API — expose /metrics, inject lỗi
│   └── Dockerfile                # Build image w9-api
│
├── argocd/
│   ├── root.yaml                 # App gốc — quản lý toàn bộ argocd/apps/
│   └── apps/
│       ├── web.yaml              # ArgoCD App → k8s/
│       ├── fe.yaml               # ArgoCD App → k8s/fe/
│       ├── be.yaml               # ArgoCD App → k8s/be/
│       ├── api.yaml              # ArgoCD App → k8s-api/
│       ├── argo-rollouts.yaml    # Helm chart: Argo Rollouts v2.41.0
│       └── kube-prometheus-stack.yaml  # Helm chart: kube-prometheus-stack v58.2.2
│
├── k8s/
│   ├── namespace.yaml            # Tạo namespace demo (wave -1)
│   ├── web.yaml                  # Demo app: ConfigMap + Deployment + Service
│   ├── fe/
│   │   ├── configmap.yaml        # HTML Portfolio (wave 0)
│   │   ├── deployment.yaml       # nginx serve HTML (wave 1)
│   │   └── service.yaml          # frontend-service:80 (wave 2)
│   └── be/
│       ├── configmap.yaml        # nginx mock REST API config (wave 0)
│       ├── deployment.yaml       # nginx mock API server (wave 1)
│       └── service.yaml          # backend-service:80 (wave 2)
│
└── k8s-api/
    ├── api.yaml                  # Argo Rollouts Canary + Service ClusterIP
    ├── analysis.yaml             # AnalysisTemplate — success rate ≥ 95%
    ├── servicemonitor.yaml       # Hướng dẫn Prometheus scrape /metrics
    └── alerts.yaml               # PrometheusRule — alert khi có lỗi 5xx
```

---

## 3. Luồng hoạt động chi tiết

### 3.1 Luồng GitOps (thay đổi config)

```
Developer sửa file YAML trên máy local
        │
        ▼
git add + git commit + git push → GitHub (branch main)
        │
        ├─── Nếu push qua Pull Request:
        │         GitHub Actions chạy validate.yml
        │         └── kubeconform -strict kiểm tra schema k8s/
        │         └── Nếu lỗi → CI fail, block merge
        │
        ▼ (code trên main)
ArgoCD polling GitHub mỗi ~3 phút
  └── So sánh Git state vs Cluster state
  └── Phát hiện diff
        │
        ▼
ArgoCD tự động sync (automated: true)
  └── Apply các resource theo đúng thứ tự sync-wave
  └── Đợi từng wave healthy trước khi sang wave tiếp theo
        │
        ▼
Cluster state = Git state → Trạng thái: Synced / Healthy
```

---

### 3.2 Luồng Canary Deployment với Background Analysis

Đây là luồng quan trọng nhất — phản ánh đúng cấu hình hiện tại trong `api.yaml`.

```
Developer đổi image trong k8s-api/api.yaml, git push
        │
        ▼
ArgoCD sync → Argo Rollouts Controller nhận Rollout spec mới
        │
        ▼
Argo Rollouts bắt đầu Canary, khởi động Analysis ngầm (background)
Analysis chạy SONG SONG với tất cả steps bên dưới:
  └── Query Prometheus mỗi 10 giây
  └── Kiểm tra: success_rate = request_không_lỗi / total_request ≥ 95%?
  └── failureLimit = 3: cho phép tối đa 3 lần check fail trước khi rollback
        │
        ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — setWeight: 25                  [t = 0s]
  └── 1 trong 4 Pod chạy version mới (canary)
  └── 25% traffic → canary, 75% → stable
        │
        ▼
STEP 2 — pause: 30s                     [t = 0s → 30s]
  └── Giữ nguyên 25%, chờ 30 giây
  └── Analysis vẫn chạy ngầm kiểm tra health
  └── Nếu Analysis fail trong 30s → ROLLBACK ngay
        │
        ▼
STEP 3 — setWeight: 50                  [t = 30s]
  └── 2 trong 4 Pod chạy version mới
  └── 50% traffic → canary, 50% → stable
        │
        ▼
STEP 4 — pause: 30s                     [t = 30s → 60s]
  └── Giữ nguyên 50%, chờ thêm 30 giây
  └── Analysis vẫn chạy ngầm kiểm tra health
  └── Nếu Analysis fail → ROLLBACK ngay
        │
        ▼
STEP 5 — setWeight: 100                 [t = 60s]
  └── 100% traffic → version mới
  └── Analysis tự động dừng khi Rollout hoàn thành
        │
        ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Canary hoàn thành — stable = version mới
```

**Điểm khác biệt quan trọng với docs cũ:**
- Analysis KHÔNG phải là một bước tuần tự giữa các steps
- Analysis chạy **song song ngầm (background)** từ lúc bắt đầu đến lúc kết thúc canary
- Bất kỳ lúc nào analysis fail quá `failureLimit` → rollback, không chờ hết steps

---

### 3.3 Luồng Rollback tự động khi Analysis fail

```
Analysis đang chạy ngầm, query mỗi 10 giây
        │
        ▼
Một lần query trả về success_rate < 0.95 → count failure = 1
        │
        ▼ (10 giây sau)
Query lần 2 trả về success_rate < 0.95 → count failure = 2
        │
        ▼ (10 giây sau)
Query lần 3 trả về success_rate < 0.95 → count failure = 3
  └── failureLimit = 3 đã đạt → Analysis = FAILED
        │
        ▼
Argo Rollouts tự động:
  ├── Đặt Rollout status = Degraded
  ├── Scale down tất cả canary Pod
  ├── Chuyển 100% traffic về stable (version cũ)
  └── Ghi event: "AnalysisRun failed, rolling back"
        │
        ▼
Tổng thời gian từ lỗi đầu tiên đến rollback hoàn tất:
  ≈ 10s × 3 lần = 30 giây (trong điều kiện lý tưởng)
  + thời gian Prometheus scrape metrics (scrape interval: 15s)
  → Thực tế: rollback trong khoảng 30–60 giây sau khi lỗi xuất hiện
```

---

### 3.4 Luồng Contact Form (FE → BE)

```
User điền form: Họ tên + Email + Lời nhắn
        │
        ▼
JavaScript: fetch POST http://localhost:8081/api/contact
  Body: { name, email, message } (JSON)
  Headers: { Content-Type: application/json }
        │
        ▼
Browser tự gửi OPTIONS preflight (do cross-origin)
  └── BE nginx trả 204 No Content (CORS OK)
        │
        ▼
Browser gửi POST thật sự
        │
        ▼
nginx (backend Pod) nhận request tại location /api/contact
  └── Trả ngay: 200 { status: "success", message: "Backend đã nhận được..." }
  └── (Mock — không thật sự lưu hay gửi email)
        │
        ▼
JavaScript nhận response:
  ├── Hiển thị status-box màu xanh lá với message từ BE
  └── Reset form (xóa sạch các trường)
```

> **Lưu ý:** Backend hiện tại là **mock nginx** — chỉ trả JSON tĩnh, không lưu database, không gửi email. Đây là thiết kế phù hợp cho mục đích demo FE↔BE communication trong Kubernetes.

---

### 3.5 Luồng request GET Profile (FE → BE)

```
Trang load xong → JavaScript tự động gọi ngay
        │
        ▼
fetch GET http://localhost:8081/api/profile
        │
        ▼
nginx (backend Pod) tại location /api/profile
  └── Trả JSON hardcoded: { name, role, skills[], bio }
        │
        ▼
JavaScript render lên DOM:
  ├── document.getElementById('name').innerText = data.name
  ├── document.getElementById('role').innerText = data.role
  ├── document.getElementById('bio').innerText = data.bio
  └── skills → render từng <span class="badge">
        │
        ▼
Nếu fetch thất bại (BE chưa port-forward):
  └── Hiển thị thông báo lỗi màu đỏ trong #bio
```

---

### 3.6 Luồng Monitoring (Prometheus scrape → Alert)

```
Flask API Pod đang chạy, nhận request
        │
        ▼
prometheus-flask-exporter tự động đếm:
  flask_http_request_total{status="200"} += 1  (request thành công)
  flask_http_request_total{status="500"} += 1  (request lỗi)
        │
        ▼
Prometheus scrape GET http://api:8080/metrics  [mỗi 15 giây]
  └── ServiceMonitor hướng dẫn: port=http, path=/metrics, interval=15s
        │
        ▼
Prometheus lưu time-series data
        │
        ├─────────────────────────────────────────────────────────┐
        │                                                         │
        ▼                                                         ▼
PrometheusRule evaluate [mỗi ~30s]              AnalysisTemplate query [mỗi 10s]
  expr: sum(rate(5xx[1m])) > 0                    query: success_rate [2m]
  for: 10s liên tục                               successCondition: ≥ 0.95
        │                                                         │
        ▼                                                         ▼
Alert PENDING (chờ 10s)                         fail count tăng dần
        │                                         (failureLimit = 3)
        ▼                                                         │
Alert FIRING → Alertmanager                       ▼
  └── Route theo severity: critical          Rollback tự động
  └── Gửi notification (Slack/email)
```

---

## 4. ArgoCD — App of Apps Pattern

### `argocd/root.yaml`

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root
  namespace: argocd          # Application object PHẢI nằm trong namespace argocd
spec:
  project: default           # Project ArgoCD — phân quyền và giới hạn resource
  source:
    repoURL: https://github.com/ThuyTrang9525/gitops.git
    path: argocd/apps        # Root app chỉ nhìn vào thư mục này
                             # → Mọi file .yaml trong đó = một ArgoCD Application
  destination:
    server: https://kubernetes.default.svc   # Cluster hiện tại
    namespace: argocd        # Tạo Application object trong namespace argocd
  syncPolicy:
    automated:
      prune: true            # File xóa khỏi Git → resource xóa trên cluster
      selfHeal: true         # Cluster bị chỉnh tay → ArgoCD tự phục hồi về Git
```

**Tại sao dùng App of Apps?** Chỉ cần `kubectl apply -f argocd/root.yaml` một lần. Sau đó mọi Application con trong `argocd/apps/` được tạo và quản lý tự động. Thêm app mới = thêm 1 file YAML vào `argocd/apps/`.

---

### `argocd/apps/fe.yaml` / `be.yaml` / `web.yaml` / `api.yaml`

```yaml
metadata:
  name: frontend-app         # Tên hiển thị trên ArgoCD dashboard
  namespace: argocd
spec:
  source:
    path: k8s/fe             # Thư mục chứa manifest — ArgoCD apply toàn bộ file trong đó
  destination:
    namespace: demo          # Namespace đích trên cluster
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

---

### `argocd/apps/argo-rollouts.yaml`

```yaml
spec:
  source:
    repoURL: 'https://argoproj.github.io/argo-helm'  # Helm repository, không phải Git
    chart: argo-rollouts
    targetRevision: 2.41.0   # Ghim version — tránh tự động upgrade khi chart mới ra
    helm:
      values: |
        prometheus:
          prometheusSpec:
            serviceMonitorSelectorNilUsesHelmValues: false
            # false = Prometheus scrape TẤT CẢ ServiceMonitor trong cluster
            # (không chỉ những cái thuộc Helm release này)
            # Bắt buộc để servicemonitor.yaml của app api được nhận diện
        defaultRules:
          rules:
            kubelet: false   # Tắt alert kubelet mặc định — giảm noise
  destination:
    namespace: argo-rollouts
  syncPolicy:
    syncOptions:
      - CreateNamespace=true   # Tự tạo namespace nếu chưa có
      - ServerSideApply=true   # Dùng SSA thay CSA — tránh lỗi "annotation too long" với Helm chart lớn
```

---

### `argocd/apps/kube-prometheus-stack.yaml`

```yaml
spec:
  source:
    repoURL: 'https://prometheus-community.github.io/helm-charts'
    chart: kube-prometheus-stack
    targetRevision: 58.2.2   # Bao gồm: Prometheus, Grafana, Alertmanager,
                              # Prometheus Operator, node-exporter, kube-state-metrics
    helm:
      values: |
        prometheus:
          prometheusSpec:
            serviceMonitorSelectorNilUsesHelmValues: false
            # QUAN TRỌNG: Cho phép Prometheus nhận diện ServiceMonitor
            # từ bất kỳ namespace nào (kể cả namespace demo)
        defaultRules:
          rules:
            kubelet: false
  destination:
    namespace: monitoring    # Tách biệt hoàn toàn với app namespace
  syncPolicy:
    syncOptions:
      - ServerSideApply=true # Bắt buộc — chart có CRD rất lớn, CSA sẽ bị lỗi
```

---

## 5. Namespace & Sync Wave

### `k8s/namespace.yaml`

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: demo
  annotations:
    argocd.argoproj.io/sync-wave: "-1"
    # Wave -1: Tạo TRƯỚC TẤT CẢ resource khác
    # Nếu thiếu → Deployment, Service bị lỗi "namespace not found"
```

**Sync Wave — thứ tự tạo resource trong ArgoCD:**

ArgoCD đợi tất cả resource ở wave N đạt **Healthy** trước khi bắt đầu wave N+1.

| Wave | Resource được tạo | Lý do thứ tự |
|------|-------------------|--------------|
| -1 | Namespace `demo` | Container cho tất cả resource |
| 0 | ConfigMap fe-config1, be-config1, web-config | Config phải có trước Pod cần đọc nó |
| 1 | Deployment frontend, backend, web | Pod sau khi có config |
| 2 | Service frontend-service, backend-service, web | Expose sau khi Pod Running |

---

## 6. Ứng dụng Web (`k8s/web.yaml`)

File gộp 3 resource trong một file, phân cách bằng `---`.

### ConfigMap `web-config` — wave 0

```yaml
data:
  MESSAGE: "hello from gitops"
  # Biến môi trường inject vào container qua envFrom
  # Demo kỹ thuật: truyền config vào Pod qua ConfigMap thay vì hardcode
```

### Deployment `web` — wave 1

```yaml
spec:
  replicas: 2              # 2 Pod — high availability cơ bản
  selector:
    matchLabels:
      app: web             # Deployment quản lý Pod có label này
  template:
    spec:
      containers:
        - image: nginx:1.27  # Version cụ thể, không dùng latest
          envFrom:
            - configMapRef:
                name: web-config
                # Inject TOÀN BỘ key=value trong ConfigMap thành env vars
                # Pod sẽ có: env MESSAGE="hello from gitops"
```

### Service `web` — wave 2

```yaml
spec:
  selector:
    app: web             # Forward traffic đến Pod có label này
  ports:
    - port: 80           # Port Service lắng nghe
      targetPort: 80     # Port container nginx
  # type mặc định = ClusterIP — chỉ accessible trong cluster
```

---

## 7. Frontend (`k8s/fe/`)

### `k8s/fe/configmap.yaml`

```yaml
metadata:
  name: fe-config1             # deployment.yaml phải tham chiếu đúng tên này
  annotations:
    argocd.argoproj.io/sync-wave: "0"
data:
  index.html: |                # Key = tên file, Value = toàn bộ nội dung HTML
```

**Nội dung trang HTML:**
- **Profile card**: Avatar chữ "TT", tên/role/bio/skills — fetch từ BE `GET /api/profile`
- **Contact form**: 3 trường (tên, email, message) — submit `POST /api/contact`
- **Kết nối BE**: `const beBaseUrl = 'http://localhost:8081'` — dùng với port-forward

**Trạng thái UI:**
- `status-loading` (xám): đang chờ response
- `status-success` (xanh lá): BE trả thành công
- `status-error` (đỏ): fetch thất bại hoặc BE lỗi

### `k8s/fe/deployment.yaml`

```yaml
spec:
  replicas: 1
  template:
    metadata:
      annotations:
        checksum/config: "v1"
        # Trick force Pod restart khi ConfigMap thay đổi
        # K8s không tự restart Pod khi ConfigMap thay đổi
        # Cách dùng: đổi "v1" → "v2" → git commit → ArgoCD sync → Pod mới
    spec:
      containers:
        - image: nginx:1.27
          volumeMounts:
            - mountPath: /usr/share/nginx/html/index.html
              subPath: index.html
              # subPath = chỉ mount đúng 1 key "index.html" từ ConfigMap
              # Không có subPath = mount cả ConfigMap thành thư mục
      volumes:
        - name: html-volume
          configMap:
            name: fe-config1
```

### `k8s/fe/service.yaml`

```yaml
metadata:
  name: frontend-service   # kubectl port-forward svc/frontend-service 8080:80 -n demo
spec:
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
  # ClusterIP — không expose ra ngoài cluster
```

---

## 8. Backend (`k8s/be/`)

### `k8s/be/configmap.yaml`

```yaml
metadata:
  name: be-config1

data:
  api.conf: |              # Mount thành file nginx config
    server {
        listen 80;

        # CORS — cho phép browser từ origin khác gọi API
        add_header 'Access-Control-Allow-Origin' '*' always;
        # '*' = mọi origin — phù hợp dev, production nên giới hạn domain cụ thể
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' '...' always;

        if ($request_method = 'OPTIONS') {
            return 204;
            # Preflight: browser gửi OPTIONS trước POST cross-origin
            # 204 No Content = response đúng chuẩn, không cần body
        }

        location /api/profile {
            default_type application/json;
            return 200 '{...JSON hardcoded...}';
            # Mock API — không cần server thật, đủ để demo FE↔BE
        }

        location /api/contact {
            default_type application/json;
            return 200 '{"status": "success", "message": "..."}';
            # Giả lập nhận form — không lưu data, không gửi email
        }

        location / {
            return 200 'Backend API đang chạy mượt mà!';
            # Health check thủ công — bất kỳ path nào không match
        }
    }
```

### `k8s/be/deployment.yaml`

```yaml
spec:
  replicas: 1
  template:
    metadata:
      annotations:
        checksum/config: "v1"   # Force restart khi đổi giá trị này
    spec:
      containers:
        - image: nginx:1.27
          volumeMounts:
            - mountPath: /etc/nginx/conf.d/default.conf
              # Đè lên nginx config mặc định
              subPath: api.conf
              # Chỉ lấy key "api.conf" từ ConfigMap
      volumes:
        - configMap:
            name: be-config1
```

### `k8s/be/service.yaml`

```yaml
metadata:
  name: backend-service
  # Port-forward: kubectl port-forward svc/backend-service 8081:80 -n demo
spec:
  selector:
    app: backend
  ports:
    - port: 80
      targetPort: 80
```

---

## 9. API Service với Argo Rollouts (`k8s-api/`)

### `k8s-api/api.yaml` — Rollout + Service

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout              # Thay thế Deployment — quản lý bởi Argo Rollouts controller

spec:
  replicas: 4              # Tổng 4 Pod (stable + canary) trong suốt quá trình deploy

  template:
    spec:
      containers:
        - name: api
          image: w9-api:1
          imagePullPolicy: IfNotPresent
          # Không pull từ registry — image phải có sẵn trên node
          # Phù hợp lab/dev, không có registry riêng
          ports:
            - name: http
              containerPort: 8080
              # Tên "http" — ServiceMonitor và Service đều tham chiếu tên này

          env:
            - name: ERROR_RATE
              value: "0"
              # 0   = không lỗi (bình thường)
              # 0.3 = 30% request trả 500 (test rollback)
              # 1.0 = 100% request lỗi (rollback ngay)

            - name: VERSION
              value: "v2"
              # Hiển thị trong JSON response → phân biệt Pod stable vs canary

          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            # K8s kiểm tra trước khi đưa Pod vào Service selector
            # /healthz luôn trả 200 dù ERROR_RATE cao
            # → Pod vẫn nhận traffic (lỗi là cố ý để test)

  strategy:
    canary:
      analysis:
        templates:
          - templateName: success-rate-check
            # Chạy AnalysisTemplate này SONG SONG với tất cả steps (background)
        args:
          - name: service-name
            value: api

      steps:
        - setWeight: 25
          # t=0s: 1/4 Pod = canary, 3/4 Pod = stable
        - pause:
            duration: 30s
          # t=0→30s: giữ 25%, analysis vẫn chạy ngầm
        - setWeight: 50
          # t=30s: 2/4 Pod = canary
        - pause:
            duration: 30s
          # t=30→60s: giữ 50%, analysis vẫn chạy ngầm
        - setWeight: 100
          # t=60s: 100% traffic → canary → hoàn thành
```

**Service đi kèm:**

```yaml
kind: Service
metadata:
  name: api
spec:
  ports:
    - name: http       # ServiceMonitor tham chiếu tên này để biết scrape port nào
      port: 8080
      targetPort: 8080
  selector:
    app: api           # Tự động route đến cả stable lẫn canary Pod
  type: ClusterIP
```

---

### `k8s-api/analysis.yaml` — AnalysisTemplate

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate-check
  # Tên PHẢI khớp với templateName trong api.yaml strategy.canary.analysis

spec:
  metrics:
  - name: success-rate
    interval: 10s
    # Query Prometheus mỗi 10 giây trong suốt thời gian canary

    successCondition: result[0] >= 0.95
    # ĐIỀU KIỆN PASS: success rate ≥ 95%
    # result[0] = phần tử đầu tiên của vector kết quả Prometheus
    # Nếu < 0.95 (tức < 95% request thành công) → tính là 1 lần fail

    failureLimit: 3
    # Cho phép tối đa 3 lần fail TRƯỚC KHI rollback
    # (khác với docs cũ là 1 — hiện tại khoan dung hơn)
    # Lần fail thứ 4 → Analysis = FAILED → Rollback tự động

    provider:
      prometheus:
        address: http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090
        # DNS nội bộ K8s:
        # kube-prometheus-stack-prometheus  = tên Service Prometheus
        # monitoring                        = namespace
        # svc.cluster.local                 = suffix DNS K8s

        query: |
          sum(rate(flask_http_request_total{namespace="demo", status!~"5.*"}[2m]))
          /
          (sum(rate(flask_http_request_total{namespace="demo"}[2m])) or vector(1))
```

**Giải thích query chi tiết:**

```
Tử số:
  flask_http_request_total{status!~"5.*"}   → request KHÔNG lỗi (2xx, 3xx, 4xx)
  rate(...[2m])                             → tốc độ/giây trong 2 phút gần nhất
  sum(...)                                  → cộng tổng từ tất cả Pod

Mẫu số:
  flask_http_request_total                  → TẤT CẢ request (mọi status code)
  rate(...[2m])                             → tốc độ/giây trong 2 phút
  or vector(1)                              → nếu chưa có request nào → trả 1
                                              (tránh chia cho 0, kết quả = 1.0 = 100% → pass)

Kết quả:
  0.0  → 0% success (toàn lỗi)    → fail
  0.94 → 94% success               → fail (< 0.95)
  0.95 → 95% success               → pass (đúng ngưỡng)
  1.0  → 100% success              → pass
```

**So sánh với cấu hình cũ:**

| Thông số | Cũ | Hiện tại |
|----------|-----|---------|
| `successCondition` | `result[0] == 0` (đếm lỗi = 0) | `result[0] >= 0.95` (success rate ≥ 95%) |
| `failureLimit` | 1 | 3 |
| Query window | `[1m]` | `[2m]` (mượt mà hơn) |
| Query loại | Đếm lỗi tuyệt đối | Tỷ lệ phần trăm thành công |

---

### `k8s-api/servicemonitor.yaml` — ServiceMonitor

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api
  namespace: demo           # PHẢI cùng namespace với Service cần scrape
  labels:
    app: api
    # Với serviceMonitorSelectorNilUsesHelmValues: false,
    # Prometheus scrape TẤT CẢ ServiceMonitor → label chỉ để dễ filter

spec:
  selector:
    matchLabels:
      app: api              # Tìm Service có label app: api trong namespace demo
  endpoints:
    - port: http            # Tên port (khớp với name: http trong Service)
      path: /metrics        # Flask app expose metrics tại đây
      interval: 15s         # Prometheus GET /metrics mỗi 15 giây
```

---

## 10. Monitoring Stack — Prometheus & Alerting

### Mối quan hệ các component

```
Flask App (api Pod)
  │ expose GET /metrics
  │ metric: flask_http_request_total{status, method, path}
  ▼
ServiceMonitor (namespace: demo)
  │ khai báo: scrape Service "api" port "http" path "/metrics" mỗi 15s
  ▼
Prometheus Operator (namespace: monitoring)
  │ đọc ServiceMonitor → tự động cấu hình Prometheus scrape job
  ▼
Prometheus Server (namespace: monitoring)
  │
  ├──▶ Lưu time-series data
  │
  ├──▶ Evaluate PrometheusRule mỗi ~30s
  │       └── alerts.yaml: ApiHighErrorRate
  │               condition: 5xx rate > 0 liên tục 10s → FIRING
  │               → Alertmanager → route → Slack/email/PagerDuty
  │
  └──▶ Serve PromQL API (port 9090)
          └── AnalysisTemplate query mỗi 10s
                  └── success_rate < 0.95 × 3 lần → Rollback
```

---

## 11. Alert Timeline — Khi nào, bao lâu, điều gì xảy ra

### `k8s-api/alerts.yaml` — PrometheusRule chi tiết

```yaml
spec:
  groups:
  - name: api-health
    rules:
    - alert: ApiHighErrorRate
      expr: sum(rate(flask_http_request_total{namespace="demo", status=~"5.*"}[1m])) > 0
      # Biểu thức: tổng tốc độ lỗi 5xx trong 1 phút > 0
      # Tức là: chỉ cần có BẤT KỲ lỗi 5xx nào → expr = true
      for: 10s
      # Alert phải đúng LIÊN TỤC 10 giây → mới chuyển sang FIRING
      # Trong 10s này: trạng thái là PENDING
      labels:
        severity: critical
      annotations:
        summary: "Ứng dụng API tại namespace demo đang bị lỗi nghiêm trọng!"
        description: "Tỷ lệ lỗi 5xx vượt ngưỡng an toàn trong quá trình thả Canary."
```

### Timeline chi tiết của Alert

```
Thời điểm 0s:
  Flask app bắt đầu trả HTTP 500
  flask_http_request_total{status="500"} bắt đầu tăng
        │
        ▼
Thời điểm 0s → 15s:
  Prometheus CHƯA biết — chưa scrape lần nào kể từ khi lỗi
  (scrape interval = 15s)
        │
        ▼
Thời điểm ~15s:
  Prometheus scrape /metrics lần đầu sau khi lỗi xảy ra
  rate(5xx[1m]) > 0 → expression = TRUE lần đầu
  Alert chuyển sang trạng thái: PENDING
        │
        ▼
Thời điểm ~15s → ~25s:
  Alert ở trạng thái PENDING
  Prometheus tiếp tục evaluate (mỗi 30s theo default)
  Điều kiện vẫn đúng
        │
        ▼
Thời điểm ~25s (= ~15s + 10s for):
  "for: 10s" đã thỏa mãn liên tục
  Alert chuyển sang: FIRING
        │
        ▼
Thời điểm ~25s:
  Alertmanager nhận alert ApiHighErrorRate{severity="critical"}
  Route alert theo cấu hình:
    └── Gửi notification (Slack / email / PagerDuty)
        │
        ▼
Tổng thời gian từ lỗi đầu tiên → team nhận notification:
  ≈ 15s (scrape) + 10s (for) = ~25 giây
  (có thể lên đến 45s nếu scrape vừa xong ngay trước khi lỗi)
```

### Trạng thái vòng đời của Alert

```
INACTIVE ──(expr true)──▶ PENDING ──(for: 10s)──▶ FIRING
                                                      │
                          ◀────(expr false)───────────┘
                          (alert tự resolve khi hết lỗi)
```

| Trạng thái | Ý nghĩa | Hiển thị trên Prometheus UI |
|-----------|---------|---------------------------|
| INACTIVE | Không có lỗi | Không hiển thị |
| PENDING | Có lỗi nhưng chưa đủ 10s liên tục | Màu vàng |
| FIRING | Có lỗi liên tục ≥ 10s → Alertmanager gửi notification | Màu đỏ |

### So sánh Alert vs AnalysisTemplate — hai cơ chế bảo vệ độc lập

| Tiêu chí | PrometheusRule (Alert) | AnalysisTemplate |
|----------|----------------------|-----------------|
| Mục đích | Thông báo team có vấn đề | Tự động rollback deployment |
| Kích hoạt khi | `5xx rate > 0` liên tục 10s | `success_rate < 95%` × 3 lần |
| Thời gian phản ứng | ~25 giây (scrape + for) | ~30 giây (10s × 3 lần) |
| Hành động | Gửi Slack/email/PagerDuty | Scale down canary, restore traffic |
| Hoạt động khi | Bất kỳ lúc nào (production, staging) | Chỉ trong lúc Canary deployment |
| Quản lý bởi | Prometheus + Alertmanager | Argo Rollouts Controller |
| Cần Canary đang chạy? | Không | Có |

### Kịch bản: Canary bị lỗi — timeline kết hợp

```
t=0s    Canary deploy bắt đầu, 25% traffic → v2
t=0s    Analysis bắt đầu chạy ngầm (query mỗi 10s)
t=0s    Flask v2 trả 500 (ERROR_RATE > 0)

t=10s   Analysis query lần 1: success_rate < 0.95 → fail count = 1
t=15s   Prometheus scrape: phát hiện 5xx, Alert → PENDING

t=20s   Analysis query lần 2: success_rate < 0.95 → fail count = 2
t=25s   Alert → FIRING, Alertmanager gửi notification đến team

t=25s   Alert "for: 10s" hoàn thành → team nhận Slack/email

t=30s   Analysis query lần 3: success_rate < 0.95 → fail count = 3
        failureLimit = 3 đã đạt → Analysis = FAILED
        Argo Rollouts: scale down canary, 100% traffic → stable (v1)

t=35s   Rollback hoàn tất, không còn Pod v2
        flask 500 rate = 0 → Alert chuyển về INACTIVE
        Team nhận notification "resolved"
```

---

## 12. Ứng dụng Flask (`app/`)

### `app/app.py`

```python
from prometheus_flask_exporter import PrometheusMetrics
PrometheusMetrics(app)
# Một dòng — tự động:
# • Tạo endpoint GET /metrics (Prometheus format)
# • Đếm tất cả request: flask_http_request_total{method, status, path}
# • Đo latency: flask_http_request_duration_seconds

ERR = float(os.getenv("ERROR_RATE", "0"))
# Giá trị từ env var ERROR_RATE trong Deployment
# 0   → không bao giờ lỗi
# 0.5 → 50% request trả 500
# 1.0 → 100% request trả 500 → analysis fail ngay

VER = os.getenv("VERSION", "v1")
# Trả về trong response JSON → phân biệt stable/canary Pod khi test

@app.get("/")
def index():
    if random.random() < ERR:
        return jsonify(error="injected", version=VER), 500
    return jsonify(ok=True, version=VER)

@app.get("/healthz")
def healthz():
    return "ok", 200
    # LUÔN trả 200 — readinessProbe pass dù ERROR_RATE = 1
    # Pod vẫn nhận traffic (lỗi là cố ý để test canary)
```

### `app/Dockerfile`

```dockerfile
FROM python:3.12-slim          # Image nhỏ gọn

RUN pip install flask prometheus-flask-exporter

COPY app.py /app/app.py
WORKDIR /app
ENV FLASK_APP=app.py
EXPOSE 8080
CMD ["flask", "run", "--host=0.0.0.0", "--port=8080"]
# --host=0.0.0.0 BẮT BUỘC trong container
# Nếu dùng 127.0.0.1 (default) → chỉ accessible từ trong container
```

**Build và tag:**
```bash
docker build -t w9-api:1 app/
# Tag "w9-api:1" phải khớp với image: w9-api:1 trong k8s-api/api.yaml
# imagePullPolicy: IfNotPresent → K8s dùng image local, không pull registry
```

---

## 13. CI/CD — GitHub Actions

### `.github/workflows/validate.yml`

```yaml
name: validate
on:
  pull_request:
    paths:
      - "k8s/**"
      # Chỉ trigger khi thay đổi file trong k8s/
      # Sửa README, argocd/, k8s-api/ → không trigger

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - run: |
          curl -sSLO https://github.com/yannh/kubeconform/releases/download/v0.6.7/...
          # v0.6.7 — ghim version để CI ổn định
          kubeconform -strict -summary k8s/
          # -strict: reject field không có trong schema → catch typo
          # -summary: chỉ in tóm tắt, không log từng resource
          # k8s/ only: không validate k8s-api/ vì có CRD custom
```

**Tại sao KHÔNG validate `k8s-api/`:**
- `k8s-api/` chứa CRD: `Rollout`, `AnalysisTemplate`, `ServiceMonitor`, `PrometheusRule`
- kubeconform không biết schema của những CRD này → báo lỗi sai
- Cần thêm `--schema-location` với CRD schema nếu muốn validate

---

## 14. Bảng tóm tắt các thông số quan trọng

### Timing toàn hệ thống

| Sự kiện | Thời gian |
|---------|----------|
| ArgoCD polling Git | Mỗi ~3 phút |
| Prometheus scrape /metrics | Mỗi 15 giây |
| AnalysisTemplate query | Mỗi 10 giây |
| Alert PENDING → FIRING | Sau 10 giây liên tục có lỗi |
| Thời gian từ lỗi → alert notification | ~25 giây |
| Thời gian từ lỗi → rollback hoàn tất | ~30–60 giây |
| Canary 25% pause | 30 giây |
| Canary 50% pause | 30 giây |
| Tổng thời gian canary (không lỗi) | ~60 giây |

### Thông số Analysis

| Thông số | Giá trị | Ý nghĩa |
|----------|---------|--------|
| `interval` | 10s | Query Prometheus mỗi 10 giây |
| `successCondition` | `result[0] >= 0.95` | Success rate phải ≥ 95% |
| `failureLimit` | 3 | Cho phép tối đa 3 lần fail |
| Query window | `[2m]` | Tính rate trong 2 phút gần nhất |
| Rollback trigger | Lần fail thứ 4 | Sau ~30 giây lỗi liên tục |

### Port-forward để truy cập local

| Service | Lệnh | URL |
|---------|------|-----|
| Frontend | `kubectl port-forward svc/frontend-service 8080:80 -n demo` | http://localhost:8080 |
| Backend | `kubectl port-forward svc/backend-service 8081:80 -n demo` | http://localhost:8081/api/profile |
| Flask API | `kubectl port-forward svc/api 8082:8080 -n demo` | http://localhost:8082 |
| Prometheus | `kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 -n monitoring` | http://localhost:9090 |
| Grafana | `kubectl port-forward svc/kube-prometheus-stack-grafana 3000:80 -n monitoring` | http://localhost:3000 |

### Namespace summary

| Namespace | Chứa gì |
|-----------|--------|
| `argocd` | ArgoCD controller + tất cả Application object |
| `demo` | frontend, backend, web, api (Flask Rollout) |
| `monitoring` | Prometheus, Grafana, Alertmanager, Operator, exporters |
| `argo-rollouts` | Argo Rollouts Controller |

### Canary steps summary

| Step | Thời điểm | Traffic canary | Analysis |
|------|-----------|---------------|---------|
| setWeight: 25 | t=0s | 25% | Bắt đầu chạy ngầm |
| pause: 30s | t=0→30s | 25% | Đang chạy ngầm |
| setWeight: 50 | t=30s | 50% | Đang chạy ngầm |
| pause: 30s | t=30→60s | 50% | Đang chạy ngầm |
| setWeight: 100 | t=60s | 100% | Tự dừng |

### Cách test Canary Rollback

```bash
# 1. Sửa ERROR_RATE trong k8s-api/api.yaml
env:
  - name: ERROR_RATE
    value: "0.5"    # 50% request lỗi

# 2. Push lên Git
git add k8s-api/api.yaml
git commit -m "test: inject 50% error rate for canary"
git push

# 3. Theo dõi
kubectl argo rollouts get rollout api -n demo --watch
# Sau ~30-60 giây sẽ thấy status: Degraded và rollback tự động

# 4. Check Alert trên Prometheus
# http://localhost:9090/alerts → ApiHighErrorRate = FIRING
```

---

*Tài liệu này phản ánh đúng trạng thái source code hiện tại. Không có dòng code nào bị chỉnh sửa.*
