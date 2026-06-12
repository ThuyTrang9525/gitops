# GitOps Portfolio — Tài liệu kỹ thuật toàn hệ thống

> **Mục đích tài liệu:** Giải thích toàn bộ kiến trúc, luồng hoạt động, và ý nghĩa từng thông số trong mỗi file của dự án. Không thay đổi bất kỳ dòng code nào.

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
11. [Ứng dụng Flask (app/)](#11-ứng-dụng-flask-app)
12. [CI/CD — GitHub Actions](#12-cicd--github-actions)
13. [Bảng tóm tắt các thông số quan trọng](#13-bảng-tóm-tắt-các-thông-số-quan-trọng)

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
│  └── argocd/apps/  ──────────────────────────────────────────── │
│       ├── web.yaml          → deploy k8s/                       │
│       ├── fe.yaml           → deploy k8s/fe/                    │
│       ├── be.yaml           → deploy k8s/be/                    │
│       ├── api.yaml          → deploy k8s-api/                   │
│       ├── argo-rollouts.yaml → cài Argo Rollouts từ Helm        │
│       └── kube-prometheus-stack.yaml → cài Prometheus từ Helm   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Kubernetes Cluster                             │
│                                                                  │
│  namespace: demo                                                 │
│  ├── frontend Pod  (nginx:1.27 serve index.html)                │
│  ├── backend Pod   (nginx:1.27 mock REST API)                   │
│  ├── web Pod       (nginx:1.27 + configmap env)                 │
│  └── api Pod       (Flask app — Argo Rollouts Canary)           │
│                                                                  │
│  namespace: monitoring                                           │
│  └── kube-prometheus-stack (Prometheus + Grafana + Alertmanager)│
│                                                                  │
│  namespace: argo-rollouts                                        │
│  └── Argo Rollouts Controller                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Công nghệ sử dụng:**

| Công nghệ | Vai trò |
|---|---|
| ArgoCD | GitOps controller — đồng bộ Git → K8s |
| Argo Rollouts | Triển khai Canary với phân tích tự động |
| Prometheus | Thu thập metrics từ ứng dụng |
| Prometheus Operator | Quản lý cấu hình Prometheus qua CRD |
| Flask + prometheus-flask-exporter | Ứng dụng API sinh metrics |
| nginx | Web server cho FE và mock API cho BE |
| GitHub Actions | Validate manifest khi có Pull Request |

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
│   ├── app.py                    # Flask API application
│   └── Dockerfile                # Build image cho Flask app
│
├── argocd/
│   ├── root.yaml                 # App gốc — quản lý toàn bộ argocd/apps/
│   └── apps/
│       ├── web.yaml              # ArgoCD App → k8s/
│       ├── fe.yaml               # ArgoCD App → k8s/fe/
│       ├── be.yaml               # ArgoCD App → k8s/be/
│       ├── api.yaml              # ArgoCD App → k8s-api/
│       ├── argo-rollouts.yaml    # ArgoCD App → cài Argo Rollouts (Helm)
│       └── kube-prometheus-stack.yaml  # ArgoCD App → cài Prometheus (Helm)
│
├── k8s/
│   ├── namespace.yaml            # Tạo namespace demo
│   ├── web.yaml                  # Demo app (ConfigMap + Deployment + Service)
│   ├── fe/
│   │   ├── configmap.yaml        # HTML của trang Portfolio
│   │   ├── deployment.yaml       # Deploy nginx serve HTML
│   │   └── service.yaml          # Expose frontend-service:80
│   └── be/
│       ├── configmap.yaml        # nginx config mock REST API
│       ├── deployment.yaml       # Deploy nginx mock API
│       └── service.yaml          # Expose backend-service:80
│
└── k8s-api/
    ├── api.yaml                  # Argo Rollouts Canary + Service
    ├── analysis.yaml             # AnalysisTemplate — query Prometheus
    ├── servicemonitor.yaml       # Cho Prometheus scrape /metrics
    └── alerts.yaml               # PrometheusRule — cảnh báo lỗi 5xx
```

---

## 3. Luồng hoạt động chi tiết

### 3.1 Luồng GitOps (thay đổi config)

```
Developer sửa file YAML
        │
        ▼
git commit + git push → GitHub
        │
        ▼
GitHub Actions chạy validate.yml
  └── kubeconform kiểm tra schema K8s
  └── Nếu lỗi → block merge
        │
        ▼ (PR được merge vào main)
ArgoCD polling GitHub mỗi 3 phút
  └── Phát hiện diff giữa Git và cluster
        │
        ▼
ArgoCD sync tự động (automated: true)
  └── Apply các resource thay đổi theo đúng sync-wave
        │
        ▼
Cluster được cập nhật, trạng thái = Synced/Healthy
```

### 3.2 Luồng Canary Deployment (khi cập nhật image API)

```
Cập nhật image trong k8s-api/api.yaml
        │
        ▼
ArgoCD sync → Argo Rollouts nhận Rollout mới
        │
        ▼
Bước 1: setWeight: 25
  └── 25% traffic → Pod mới (v2), 75% → Pod cũ (v1)
        │
        ▼
Bước 2: analysis (AnalysisTemplate: success-rate-check)
  └── Prometheus query: tỷ lệ lỗi 5xx trong 10 giây
  └── Nếu có lỗi → failureLimit = 1 → Rollback tự động
  └── Nếu OK → tiếp tục
        │
        ▼
Bước 3: setWeight: 50
  └── 50% traffic → Pod mới
        │
        ▼
Bước 4: pause 30s
  └── Chờ 30 giây quan sát
        │
        ▼
Bước 5: setWeight: 100
  └── 100% traffic → Pod mới
  └── Canary hoàn thành
```

### 3.3 Luồng request từ trình duyệt

```
Browser → http://localhost:8080 (port-forward frontend-service)
        │
        ▼
nginx (frontend Pod) serve index.html
        │
        ▼
JavaScript trong trang gọi http://localhost:8081/api/profile (port-forward backend-service)
        │
        ▼
nginx (backend Pod) đọc api.conf từ ConfigMap
  └── GET /api/profile → trả JSON thông tin cá nhân
  └── POST /api/contact → trả JSON xác nhận gửi thành công
        │
        ▼
Trang Portfolio hiển thị tên, role, bio, skills
```

### 3.4 Luồng Monitoring

```
Flask API (api Pod) expose /metrics (prometheus-flask-exporter)
        │
        ▼
ServiceMonitor (servicemonitor.yaml)
  └── Khai báo: "Hãy scrape /metrics của Service có label app: api mỗi 15s"
        │
        ▼
Prometheus Operator đọc ServiceMonitor → cấu hình Prometheus tự động
        │
        ▼
Prometheus thu thập metric: flask_http_request_total
        │
        ├──▶ PrometheusRule (alerts.yaml)
        │       └── Alert: nếu 5xx > 0 trong 10s → gửi cảnh báo critical
        │
        └──▶ AnalysisTemplate (analysis.yaml)
                └── Argo Rollouts query mỗi 10s trong lúc Canary
                └── Nếu 5xx > 0 → Rollback ngay
```

---

## 4. ArgoCD — App of Apps Pattern

### `argocd/root.yaml`

```yaml
apiVersion: argoproj.io/v1alpha1   # API của ArgoCD
kind: Application                   # Loại resource: một Application ArgoCD
metadata:
  name: root                        # Tên app này trên ArgoCD UI
  namespace: argocd                 # PHẢI nằm trong namespace argocd
spec:
  project: default                  # Project ArgoCD (mặc định là default)
  source:
    repoURL: https://github.com/ThuyTrang9525/gitops.git
    # URL của Git repo chứa toàn bộ manifest
    path: argocd/apps
    # Thư mục trong repo — root app chỉ nhìn vào argocd/apps/
    # → Mọi file .yaml trong đó được coi là ArgoCD Application
  destination:
    server: https://kubernetes.default.svc
    # Kubernetes API server — "kubernetes.default.svc" = cluster hiện tại
    namespace: argocd
    # Namespace đích để tạo các Application object
  syncPolicy:
    automated:
      prune: true
      # Nếu file bị xóa khỏi Git → xóa resource tương ứng trên cluster
      selfHeal: true
      # Nếu ai đó sửa trực tiếp trên cluster → ArgoCD tự phục hồi về trạng thái Git
```

**Tại sao dùng App of Apps?** Root app quản lý toàn bộ các Application con. Chỉ cần `kubectl apply -f argocd/root.yaml` một lần duy nhất, sau đó mọi thứ tự động. Thêm app mới chỉ cần tạo thêm file trong `argocd/apps/`.

---

### `argocd/apps/fe.yaml`

```yaml
metadata:
  name: frontend-app     # Tên hiển thị trên ArgoCD dashboard
  namespace: argocd      # Application object luôn nằm trong namespace argocd
spec:
  source:
    path: k8s/fe         # Trỏ vào thư mục chứa manifest của frontend
  destination:
    namespace: demo      # Deploy các resource vào namespace demo
  syncPolicy:
    automated:
      prune: true        # Xóa resource cũ nếu bị xóa khỏi Git
      selfHeal: true     # Tự phục hồi nếu cluster bị chỉnh tay
```

Tương tự cho `be.yaml` (path: k8s/be), `web.yaml` (path: k8s), `api.yaml` (path: k8s-api).

---

### `argocd/apps/argo-rollouts.yaml`

```yaml
spec:
  source:
    repoURL: 'https://argoproj.github.io/argo-helm'
    # Đây KHÔNG phải Git repo thông thường — đây là Helm Chart repository
    chart: argo-rollouts
    # Tên chart trong Helm repo
    targetRevision: 2.41.0
    # Phiên bản cụ thể của chart — ghim version để tránh tự động upgrade
    helm:
      values: |
        prometheus:
          prometheusSpec:
            serviceMonitorSelectorNilUsesHelmValues: false
            # Khi = false: Prometheus sẽ scrape TẤT CẢ ServiceMonitor trong cluster
            # (không chỉ những cái được tạo bởi Helm chart này)
            # Cần thiết để ServiceMonitor của app api hoạt động
        defaultRules:
          rules:
            kubelet: false
            # Tắt alerting rule mặc định cho kubelet để giảm nhiễu cảnh báo
  destination:
    namespace: argo-rollouts
    # Cài Argo Rollouts vào namespace riêng
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
      # Tự tạo namespace argo-rollouts nếu chưa có
      - ServerSideApply=true
      # Dùng Server-Side Apply thay vì Client-Side Apply
      # Cần thiết với Helm chart lớn để tránh lỗi "annotation too long"
```

---

### `argocd/apps/kube-prometheus-stack.yaml`

```yaml
spec:
  source:
    repoURL: 'https://prometheus-community.github.io/helm-charts'
    chart: kube-prometheus-stack
    targetRevision: 58.2.2
    # Chart này bao gồm: Prometheus, Grafana, Alertmanager, node-exporter,
    # kube-state-metrics, Prometheus Operator — tất cả trong một lần cài
    helm:
      values: |
        prometheus:
          prometheusSpec:
            serviceMonitorSelectorNilUsesHelmValues: false
            # QUAN TRỌNG: Cho phép Prometheus tự động nhận diện ServiceMonitor
            # từ bất kỳ namespace nào, không chỉ namespace monitoring
        defaultRules:
          rules:
            kubelet: false
  destination:
    namespace: monitoring  # Stack monitoring nằm tách biệt, không lẫn với app
  syncPolicy:
    syncOptions:
      - ServerSideApply=true
      # Bắt buộc với kube-prometheus-stack vì chart có CRD rất lớn
```

---

## 5. Namespace & Sync Wave

### `k8s/namespace.yaml`

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: demo
  # Tên namespace — toàn bộ ứng dụng (fe, be, web, api) đều chạy trong đây
  annotations:
    argocd.argoproj.io/sync-wave: "-1"
    # Wave -1: Namespace được tạo TRƯỚC TẤT CẢ các resource khác
    # Nếu không tạo namespace trước, các Deployment sẽ bị lỗi "namespace not found"
```

**Sync Wave** là cơ chế của ArgoCD để kiểm soát thứ tự deploy:

| Wave | Resource | Lý do |
|------|----------|-------|
| -1 | Namespace | Phải tồn tại trước tất cả |
| 0 | ConfigMap | Config phải có trước Pod đọc nó |
| 1 | Deployment | Tạo Pod sau khi có config |
| 2 | Service | Expose sau khi Pod đã Running |

ArgoCD đợi tất cả resource ở wave N đạt trạng thái healthy trước khi chuyển sang wave N+1.

---

## 6. Ứng dụng Web (`k8s/web.yaml`)

File này định nghĩa 3 resource trong một file duy nhất, phân cách bằng `---`.

### ConfigMap `web-config` (wave 0)

```yaml
data:
  MESSAGE: "hello from gitops"
  # Biến môi trường được inject vào container qua envFrom
  # Mục đích: demo cách truyền config vào Pod không hardcode trong image
```

### Deployment `web` (wave 1)

```yaml
spec:
  replicas: 2
  # Chạy 2 Pod — đảm bảo high availability, nếu 1 Pod chết vẫn còn 1 Pod phục vụ
  selector:
    matchLabels:
      app: web
  # Selector dùng để Deployment biết nó quản lý Pod nào
  # PHẢI khớp với labels trong template.metadata.labels
  template:
    spec:
      containers:
        - image: nginx:1.27
          # Dùng image nginx version cụ thể (1.27) thay vì latest
          # Tránh tình trạng image thay đổi ngoài ý muốn
          envFrom:
            - configMapRef:
                name: web-config
          # Inject TOÀN BỘ key-value trong ConfigMap thành biến môi trường
          # Container sẽ có biến môi trường MESSAGE="hello from gitops"
```

### Service `web` (wave 2)

```yaml
spec:
  selector:
    app: web
  # Service tìm Pod có label app: web để forward traffic đến
  ports:
    - port: 80        # Port mà Service lắng nghe (bên ngoài Pod)
      targetPort: 80  # Port trong container nginx đang lắng nghe
```

**Loại Service mặc định là ClusterIP** — chỉ accessible trong cluster, không expose ra ngoài. Để truy cập từ máy local cần `kubectl port-forward`.

---

## 7. Frontend (`k8s/fe/`)

### `k8s/fe/configmap.yaml`

```yaml
metadata:
  name: fe-config1
  # Tên ConfigMap — deployment.yaml phải tham chiếu đúng tên này
  annotations:
    argocd.argoproj.io/sync-wave: "0"  # Tạo trước Deployment
data:
  index.html: |
    # Key "index.html" là tên file
    # Value là toàn bộ nội dung HTML của trang Portfolio
    # Kỹ thuật này dùng ConfigMap như một "file server" đơn giản
```

**Nội dung trang HTML bao gồm:**
- **Profile card**: Hiển thị avatar (chữ "TT"), tên, role, bio, danh sách skills — tất cả lấy từ Backend API
- **Contact form**: Form gửi lời nhắn với 3 trường (tên, email, message) — POST đến Backend
- **JavaScript fetch**: Gọi `http://localhost:8081/api/profile` (GET) và `http://localhost:8081/api/contact` (POST)

> **Lưu ý quan trọng**: URL `localhost:8081` trong JavaScript nghĩa là trang này được thiết kế để dùng với `kubectl port-forward svc/backend-service 8081:80`. Trong môi trường production cần đổi thành DNS nội bộ.

### `k8s/fe/deployment.yaml`

```yaml
spec:
  replicas: 1         # 1 Pod — demo đơn giản, chưa cần HA
  template:
    metadata:
      annotations:
        checksum/config: "v1"
        # Annotation thủ công dùng để force restart Pod khi ConfigMap thay đổi
        # K8s không tự restart Pod khi ConfigMap thay đổi
        # Khi muốn reload: đổi "v1" → "v2" → commit → ArgoCD sync → Pod mới được tạo
    spec:
      containers:
        - image: nginx:1.27
          volumeMounts:
            - name: html-volume
              mountPath: /usr/share/nginx/html/index.html
              # Mount file index.html vào đúng vị trí nginx serve file tĩnh
              subPath: index.html
              # subPath: CHỈ mount key "index.html" từ ConfigMap
              # Không dùng subPath → toàn bộ ConfigMap được mount thành thư mục
      volumes:
        - name: html-volume
          configMap:
            name: fe-config1
            # Lấy data từ ConfigMap tên fe-config1
```

### `k8s/fe/service.yaml`

```yaml
metadata:
  name: frontend-service   # Tên để port-forward: kubectl port-forward svc/frontend-service 8080:80
spec:
  selector:
    app: frontend          # Tìm Pod có label app: frontend
  ports:
    - port: 80             # Service port
      targetPort: 80       # Container port nginx
# Type mặc định = ClusterIP (không expose ra ngoài cluster)
```

---

## 8. Backend (`k8s/be/`)

### `k8s/be/configmap.yaml`

```yaml
metadata:
  name: be-config1

data:
  api.conf: |
    # Key "api.conf" — sẽ được mount thành file nginx config
    server {
        listen 80;

        # CORS Headers — cho phép FE từ origin khác gọi API
        add_header 'Access-Control-Allow-Origin' '*' always;
        # '*' = chấp nhận mọi origin (phù hợp dev, production nên giới hạn domain)
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' '...' always;
        # Liệt kê headers mà browser được phép gửi trong cross-origin request

        if ($request_method = 'OPTIONS') {
            return 204;
            # Xử lý Preflight request: browser tự động gửi OPTIONS trước POST
            # 204 = No Content, không có body — đây là response đúng chuẩn cho preflight
        }

        location /api/profile {
            default_type application/json;
            # Khai báo Content-Type của response là JSON
            return 200 '{...json...}';
            # Mock API: nginx trả thẳng JSON hardcoded, không cần server thật
            # Kỹ thuật này đủ để demo FE↔BE communication mà không cần code backend
        }

        location /api/contact {
            default_type application/json;
            return 200 '{"status": "success", "message": "..."}';
            # Giả lập "nhận form thành công" — không lưu dữ liệu thật
        }

        location / {
            return 200 'Backend API đang chạy mượt mà!';
            # Catchall — bất kỳ path nào không match đều trả thông báo này
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
        checksum/config: "v1"
        # Cùng kỹ thuật với FE — đổi giá trị để force Pod restart
    spec:
      containers:
        - image: nginx:1.27
          ports:
            - containerPort: 80
          volumeMounts:
            - name: config-volume
              mountPath: /etc/nginx/conf.d/default.conf
              # Mount đè lên file config mặc định của nginx
              # nginx tự động đọc tất cả file .conf trong /etc/nginx/conf.d/
              subPath: api.conf
              # Chỉ lấy key "api.conf" từ ConfigMap
      volumes:
        - name: config-volume
          configMap:
            name: be-config1
```

### `k8s/be/service.yaml`

```yaml
metadata:
  name: backend-service
  # FE JavaScript gọi localhost:8081 sau khi port-forward service này:
  # kubectl port-forward svc/backend-service 8081:80 -n demo
spec:
  selector:
    app: backend
  ports:
    - port: 80        # Service port
      targetPort: 80  # Container port nginx
```

---

## 9. API Service với Argo Rollouts (`k8s-api/`)

### `k8s-api/api.yaml` — Rollout (Canary)

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
# Thay thế cho Deployment thông thường — được quản lý bởi Argo Rollouts controller
metadata:
  name: api
  namespace: demo

spec:
  replicas: 4
  # Tổng số Pod (cả stable + canary) trong quá trình deploy
  selector:
    matchLabels:
      app: api
  template:
    spec:
      containers:
        - name: api
          image: w9-api:1
          # Image Flask app build từ app/Dockerfile
          # "w9-api:1" là tên image local (imagePullPolicy: IfNotPresent)
          imagePullPolicy: IfNotPresent
          # Không pull từ registry nếu image đã có sẵn trên node
          # Phù hợp cho môi trường dev/lab không có registry
          ports:
            - name: http
              containerPort: 8080
              # Đặt tên "http" — ServiceMonitor sẽ tham chiếu tên này
          env:
            - name: ERROR_RATE
              value: "0"
              # Tỷ lệ lỗi giả lập (0 = không lỗi, 0.5 = 50% request lỗi 500)
              # Đổi giá trị này để test canary rollback
            - name: VERSION
              value: "v2"
              # Phiên bản app — trả về trong JSON response để phân biệt stable/canary
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            # Kubernetes kiểm tra /healthz trước khi đưa Pod vào rotation nhận traffic
            # Nếu probe fail → Pod không nhận traffic → tránh downtime

  strategy:
    canary:
      steps:
        - setWeight: 25
          # Bước 1: Chuyển 25% traffic sang Pod mới (canary)
          # 1 trong 4 Pod = 25% là Pod version mới
        - analysis:
            templates:
              - templateName: success-rate-check
              # Tham chiếu AnalysisTemplate đã khai báo trong analysis.yaml
            args:
              - name: service-name
                value: api
                # Truyền tham số vào template (hiện tại template không dùng arg này
                # nhưng khai báo sẵn để mở rộng sau)
        - setWeight: 50
          # Bước 3: Nếu analysis pass → tăng lên 50% traffic
        - pause:
            duration: 30s
          # Bước 4: Dừng 30 giây, quan sát metric trước khi promote 100%
        - setWeight: 100
          # Bước 5: Promote hoàn toàn — 100% traffic đến version mới
```

**Service đi kèm trong cùng file:**

```yaml
kind: Service
metadata:
  name: api
spec:
  ports:
    - name: http     # Tên port — ServiceMonitor tham chiếu tên này
      port: 8080
      targetPort: 8080
  selector:
    app: api
  type: ClusterIP
```

---

### `k8s-api/analysis.yaml` — AnalysisTemplate

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
# CRD do Argo Rollouts cung cấp — định nghĩa cách "chấm điểm" một canary deployment
metadata:
  name: success-rate-check
  # Tên này PHẢI khớp với templateName trong api.yaml

spec:
  metrics:
  - name: success-rate
    interval: 10s
    # Chạy query Prometheus mỗi 10 giây trong suốt thời gian analysis
    successCondition: result[0] == 0
    # Điều kiện THÀNH CÔNG: kết quả query bằng 0 (không có lỗi 5xx)
    # result[0] = phần tử đầu tiên của vector kết quả Prometheus
    failureLimit: 1
    # Chỉ cần 1 lần kết quả vi phạm successCondition → Analysis FAILED
    # → Argo Rollouts tự động Rollback về version cũ ngay lập tức
    provider:
      prometheus:
        address: http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090
        # DNS nội bộ K8s:
        #   kube-prometheus-stack-prometheus = tên Service của Prometheus
        #   monitoring                       = namespace
        #   svc.cluster.local                = suffix DNS nội bộ K8s
        query: |
          sum(rate(flask_http_request_total{namespace="demo", status=~"5.*"}[1m])) or vector(0)
          # Giải thích query:
          #   flask_http_request_total  = metric tự động sinh bởi prometheus-flask-exporter
          #   namespace="demo"          = lọc chỉ lấy metric từ namespace demo
          #   status=~"5.*"             = regex: chỉ đếm HTTP status 5xx (500, 502, 503...)
          #   rate(...[1m])             = tốc độ tăng trung bình trong 1 phút gần nhất
          #   sum(...)                  = cộng tổng từ tất cả Pod
          #   or vector(0)             = nếu không có metric nào → trả về 0 (tránh "no data" lỗi)
```

---

### `k8s-api/servicemonitor.yaml` — ServiceMonitor

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
# CRD do Prometheus Operator cung cấp — cách khai báo "Prometheus hãy scrape service này"
metadata:
  name: api
  namespace: demo
  # PHẢI cùng namespace với Service cần scrape
  labels:
    app: api
    # Label này dùng để Prometheus Operator nhận diện ServiceMonitor
    # Tuy nhiên: trong kube-prometheus-stack với serviceMonitorSelectorNilUsesHelmValues: false
    # thì Prometheus scrape TẤT CẢ ServiceMonitor → không cần label đặc biệt

spec:
  selector:
    matchLabels:
      app: api
    # Tìm Service có label app: api trong cùng namespace
    # → Tìm thấy Service "api" trong api.yaml
  endpoints:
    - port: http
      # Tên port (phải khớp với name: http trong Service spec.ports)
      path: /metrics
      # Đường dẫn Prometheus sẽ GET để lấy metrics
      # Flask app expose metrics tại /metrics nhờ prometheus-flask-exporter
      interval: 15s
      # Prometheus scrape /metrics mỗi 15 giây
```

---

### `k8s-api/alerts.yaml` — PrometheusRule

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
# CRD do Prometheus Operator — định nghĩa alerting rules
metadata:
  name: api-alerts
  namespace: monitoring
  # Đặt trong namespace monitoring (nơi Prometheus chạy)
  labels:
    release: kube-prometheus-stack
    # QUAN TRỌNG: Label này để Prometheus Operator biết rule này thuộc về stack nào
    # Phải khớp với label selector của PrometheusRule trong Helm chart

spec:
  groups:
  - name: api-health
    # Tên nhóm rule — hiển thị trong Prometheus UI
    rules:
    - alert: ApiHighErrorRate
      # Tên alert — hiển thị trong Alertmanager
      expr: sum(rate(flask_http_request_total{namespace="demo", status=~"5.*"}[1m])) > 0
      # Điều kiện kích hoạt alert: tỷ lệ lỗi 5xx > 0
      # Cùng query với AnalysisTemplate nhưng threshold khác nhau
      for: 10s
      # Alert chỉ firing nếu điều kiện đúng LIÊN TỤC trong 10 giây
      # Tránh false alarm do spike ngắn hạn
      labels:
        severity: critical
        # Label phân loại độ nghiêm trọng — Alertmanager dùng để route alert
      annotations:
        summary: "Ứng dụng API tại namespace demo đang bị lỗi nghiêm trọng!"
        description: "Tỷ lệ lỗi 5xx vượt ngưỡng an toàn trong quá trình thả Canary."
        # Thông tin chi tiết hiển thị trong notification (Slack, email...)
```

**Sự khác nhau giữa Alert và AnalysisTemplate:**

| | AnalysisTemplate | PrometheusRule |
|---|---|---|
| Mục đích | Quyết định rollback/promote | Thông báo cho team |
| Kích hoạt | Trong lúc Canary deploy | Bất kỳ lúc nào |
| Hành động | Rollback tự động | Gửi notification |
| Quản lý bởi | Argo Rollouts | Prometheus/Alertmanager |

---

## 10. Monitoring Stack — Prometheus & Alerting

### Mối quan hệ giữa các component

```
prometheus-flask-exporter (trong Flask app)
        │ expose /metrics
        ▼
ServiceMonitor (servicemonitor.yaml)
        │ hướng dẫn Prometheus Operator
        ▼
Prometheus Operator (trong kube-prometheus-stack)
        │ tự động cấu hình Prometheus
        ▼
Prometheus Server
        ├── scrape /metrics mỗi 15s
        ├── evaluate PrometheusRule (alerts.yaml) → Alertmanager
        └── serve PromQL queries → AnalysisTemplate (analysis.yaml)
```

### Metric chính được dùng

`flask_http_request_total` — Counter tự động sinh bởi `prometheus-flask-exporter`:
- **Labels**: `method`, `status`, `path`, `namespace` (thêm bởi K8s)
- **Ý nghĩa**: Tổng số HTTP request đã xử lý, phân loại theo status code

**Cách query lỗi 5xx:**
```promql
sum(rate(flask_http_request_total{namespace="demo", status=~"5.*"}[1m])) or vector(0)
```
- `rate()[1m]` → tốc độ request/giây trung bình trong 1 phút
- `status=~"5.*"` → chỉ đếm lỗi server
- `or vector(0)` → trả 0 nếu app chưa nhận request nào (tránh "no data")

---

## 11. Ứng dụng Flask (`app/`)

### `app/app.py`

```python
app = Flask(__name__)
PrometheusMetrics(app)
# Một dòng này tự động:
# - Tạo endpoint GET /metrics
# - Đếm tất cả request theo method, status, path
# - Đo latency của mỗi request

ERR = float(os.getenv("ERROR_RATE", "0"))
# Đọc từ biến môi trường ERROR_RATE trong Deployment
# Mặc định = 0 (không lỗi)
# Đổi thành "0.5" → 50% request trả 500

VER = os.getenv("VERSION", "v1")
# Phiên bản app — trả về trong JSON để phân biệt stable vs canary Pod

@app.get("/")
def index():
    if random.random() < ERR:
        return jsonify(error="injected", version=VER), 500
        # Giả lập lỗi ngẫu nhiên theo tỷ lệ ERR
        # Dùng để test canary analysis và alert
    return jsonify(ok=True, version=VER)
    # Response bình thường kèm version để biết Pod nào đang phục vụ

@app.get("/healthz")
def healthz():
    return "ok", 200
    # Endpoint cho readinessProbe của Kubernetes
    # LUÔN trả 200 dù ERROR_RATE cao — Pod vẫn được đưa vào rotation
    # (lỗi là intentional, không phải Pod bị unhealthy)
```

### `app/Dockerfile`

```dockerfile
FROM python:3.12-slim
# Base image nhỏ gọn — không có các tool debug thừa

RUN pip install flask prometheus-flask-exporter
# Cài 2 package cần thiết
# flask: web framework
# prometheus-flask-exporter: tự động expose /metrics

COPY app.py /app/app.py
WORKDIR /app
ENV FLASK_APP=app.py    # Chỉ định file app cho lệnh flask run
EXPOSE 8080             # Khai báo port (documentation, không tự mở port)
CMD ["flask", "run", "--host=0.0.0.0", "--port=8080"]
# --host=0.0.0.0: lắng nghe trên tất cả network interface (cần thiết trong container)
# Nếu chỉ dùng 127.0.0.1 (default) → không thể truy cập từ ngoài container
```

**Build image:**
```bash
docker build -t w9-api:1 app/
# Tag "w9-api:1" phải khớp với image: w9-api:1 trong api.yaml
```

---

## 12. CI/CD — GitHub Actions

### `.github/workflows/validate.yml`

```yaml
name: validate
on:
  pull_request:
    paths:
      - "k8s/**"
      # Chỉ chạy workflow khi có file thay đổi trong thư mục k8s/
      # Tránh chạy khi chỉ sửa README hay file khác không liên quan

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        # Checkout code về runner để có thể đọc file

      - run: |
          curl -sSLO https://github.com/yannh/kubeconform/releases/download/v0.6.7/kubeconform-linux-amd64.tar.gz
          # Download kubeconform v0.6.7 — version được ghim cụ thể để CI ổn định
          tar -xzf kubeconform-linux-amd64.tar.gz && sudo mv kubeconform /usr/local/bin/
          # Giải nén và cài vào PATH

          kubeconform -strict -summary k8s/
          # -strict: validate nghiêm ngặt — không cho phép field không biết trong schema
          # -summary: in tóm tắt (số file pass/fail) thay vì log từng file
          # k8s/: chỉ validate thư mục này (không validate k8s-api/ vì có CRD custom)
```

**Tại sao KHÔNG validate `k8s-api/`?** Các file trong `k8s-api/` dùng CRD (Rollout, AnalysisTemplate, ServiceMonitor, PrometheusRule) — kubeconform không biết schema của những resource này nên sẽ báo lỗi sai. Cần thêm flag `--schema-location` nếu muốn validate CRD.

---

## 13. Bảng tóm tắt các thông số quan trọng

### Sync Wave — thứ tự deploy

| Wave | File | Resource | Lý do |
|------|------|----------|-------|
| -1 | namespace.yaml | Namespace demo | Namespace phải tồn tại trước tiên |
| 0 | fe/configmap.yaml | ConfigMap fe-config1 | Config có trước Pod |
| 0 | be/configmap.yaml | ConfigMap be-config1 | Config có trước Pod |
| 0 | web.yaml (CM) | ConfigMap web-config | Config có trước Pod |
| 1 | fe/deployment.yaml | Deployment frontend | Pod sau khi có config |
| 1 | be/deployment.yaml | Deployment backend | Pod sau khi có config |
| 1 | web.yaml (Deploy) | Deployment web | Pod sau khi có config |
| 2 | fe/service.yaml | Service frontend-service | Expose sau khi Pod Running |
| 2 | be/service.yaml | Service backend-service | Expose sau khi Pod Running |
| 2 | web.yaml (Svc) | Service web | Expose sau khi Pod Running |

### Port mapping — cách truy cập local

| Service | Lệnh port-forward | URL local |
|---------|------------------|-----------|
| Frontend | `kubectl port-forward svc/frontend-service 8080:80 -n demo` | http://localhost:8080 |
| Backend | `kubectl port-forward svc/backend-service 8081:80 -n demo` | http://localhost:8081/api/profile |
| API (Flask) | `kubectl port-forward svc/api 8082:8080 -n demo` | http://localhost:8082 |
| Prometheus | `kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 -n monitoring` | http://localhost:9090 |
| Grafana | `kubectl port-forward svc/kube-prometheus-stack-grafana 3000:80 -n monitoring` | http://localhost:3000 |

### Namespace summary

| Namespace | Chứa gì |
|-----------|--------|
| `argocd` | ArgoCD controller + tất cả Application object |
| `demo` | frontend, backend, web, api (Flask) |
| `monitoring` | Prometheus, Grafana, Alertmanager, node-exporter |
| `argo-rollouts` | Argo Rollouts controller |

### Canary steps summary

| Bước | Action | Ý nghĩa |
|------|--------|--------|
| 1 | setWeight: 25 | 1/4 Pod mới nhận traffic |
| 2 | analysis | Query Prometheus, rollback nếu có lỗi 5xx |
| 3 | setWeight: 50 | 2/4 Pod mới nhận traffic |
| 4 | pause 30s | Quan sát thêm 30 giây |
| 5 | setWeight: 100 | Promote hoàn toàn version mới |

---

*Tài liệu này được tạo tự động từ source code — không chỉnh sửa bất kỳ file YAML hoặc Python nào.*
