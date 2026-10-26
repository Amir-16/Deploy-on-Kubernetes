# Assignment Guideline: Dockerize → Docker Hub → Kubernetes (kubeadm on EC2)

Lead-engineer runbook. Follow the phases in order. Each phase ends with a **✅ Checkpoint** and an **📸 Evidence** item for the submission.

> Replace `<DOCKERHUB_USER>` with your Docker Hub username and `<EC2_PUBLIC_IP>` with your instance IP everywhere below.

## 0. What you are shipping

| Item | Value |
|---|---|
| App | Node.js + Express (`src/server.js`), listens on `process.env.PORT` (default **5000**) |
| Routes | `/` (HTML page), `/api` (JSON) |
| Image | `<DOCKERHUB_USER>/node-express-app:v1` (+ `latest`) |
| Namespace | `production` |
| Exposure | NodePort `30080` → container `5000` |

**Deliverables:** (1) GitHub repo link with `Dockerfile` + `k8s/` manifests, (2) Docker Hub link, (3) screenshots: EC2 running, image pushed, pods running in `production`.

**Repo notes found during review:**
- A `Dockerfile` already exists, and `Jenkinsfile` hardcodes the image name `roy35/node-express-app`. For *your* submission, use **your own** Docker Hub user and update/ignore the Jenkinsfile accordingly.
- `.dockerignore` is missing, so `node_modules` and `.git` get copied into the image. Add one (step 2).
- `README.md` says port 3000, but the code defaults to 5000. Fix it so graders aren't confused.
- `src/server.js` has an unused `const fileURLToPath = require('url')` line. It's harmless, so leave it or tidy it.

---

## 1. Clone / fork the repository

You need your own GitHub repo for the submission link. If you cloned the original and removed `.git` (so the old history and remote are gone), start a fresh repo:

1. On GitHub, create an **empty** repo named `Module-3-deployment` (no README, no .gitignore).
2. In the project folder:

```bash
cd /home/amir/devops/Module-3-deployment
git init -b main
git remote add origin https://github.com/<YOUR_GH_USER>/Module-3-deployment.git
git add .
git commit -m "Initial commit: original app source"
git push -u origin main
git checkout -b dockerize-k8s
```

`node_modules` is already in `.gitignore`, so it won't be committed.

If you'd rather keep the original history, fork the repo on GitHub and clone your fork instead of removing `.git`.

✅ `git remote -v` shows **your** repo, and the code is visible on GitHub.

---

## 2. Dockerize

### 2.1 `.dockerignore`

```
node_modules
.git
.github
*.log
Dockerfile
.dockerignore
k8s
```

### 2.2 Dockerfile (production-grade)

Improvements over the existing one: pinned Node version matching the README, `npm ci`, non-root user, and a healthcheck.

```dockerfile
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=5000

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:5000/api || exit 1

CMD ["node", "src/server.js"]
```

> The app only needs `src/` at runtime (`src/public` is served statically). `npm start` is replaced with `node` directly so signals (SIGTERM) reach the process, giving clean shutdowns in Kubernetes.

### 2.3 Build and test locally

```bash
docker build -t <DOCKERHUB_USER>/node-express-app:v1 .
docker run -d --name app-test -p 5000:5000 <DOCKERHUB_USER>/node-express-app:v1

curl -i http://localhost:5000/        # HTML
curl -i http://localhost:5000/api     # {"message":"Hello World changes"}
docker ps                             # STATUS should become "healthy"
docker logs app-test

docker rm -f app-test
```

✅ Both routes respond with `200`.
📸 Screenshot: `docker images` + the `curl` output.

---

## 3. Push to Docker Hub

1. Create an account at <https://hub.docker.com>.
2. Create a **public** repository named `node-express-app`, so the cluster can pull without credentials.
3. Create an access token: *Account Settings → Personal access tokens*. Use it instead of your password.

```bash
docker login -u <DOCKERHUB_USER>        # paste the token

docker tag <DOCKERHUB_USER>/node-express-app:v1 <DOCKERHUB_USER>/node-express-app:latest
docker push <DOCKERHUB_USER>/node-express-app:v1
docker push <DOCKERHUB_USER>/node-express-app:latest
```

Verify from a clean state (proves the push really worked):

```bash
docker rmi <DOCKERHUB_USER>/node-express-app:v1 <DOCKERHUB_USER>/node-express-app:latest
docker pull <DOCKERHUB_USER>/node-express-app:v1
```

✅ Image visible at `https://hub.docker.com/r/<DOCKERHUB_USER>/node-express-app`.
📸 Screenshot: terminal showing the push + the Docker Hub tags page.

> **Never commit your token.** Revoke it after grading if you like.

---

## 4. Provision the AWS EC2 instance

**Console → EC2 → Launch instance**

| Setting | Value |
|---|---|
| Name | `k8s-single-node` |
| AMI | Ubuntu Server 22.04 LTS (x86_64) |
| Type | **t3.medium** (2 vCPU / 4 GB, the kubeadm minimum is 2 vCPU / 2 GB) |
| Key pair | Create new → `k8s-key.pem` (RSA, `.pem`) |
| Storage | 20 GiB gp3 |
| Public IP | Enabled |

**Security group** (name it `k8s-sg`):

| Port | Protocol | Source | Why |
|---|---|---|---|
| 22 | TCP | **My IP** (not 0.0.0.0/0) | SSH |
| 6443 | TCP | My IP | Kubernetes API (kubectl from your laptop) |
| 30000-32767 | TCP | 0.0.0.0/0 | NodePort services (so graders can open the app) |

Optional: allow all traffic from the security group itself (needed only for multi-node clusters).

Connect:

```bash
chmod 400 k8s-key.pem
ssh -i k8s-key.pem ubuntu@<EC2_PUBLIC_IP>
```

✅ You get an Ubuntu shell.
📸 Screenshot: EC2 console with the instance **running** (type `t3.medium`, public IP visible, 2/2 status checks passed) and the security group inbound rules.

> **Cost control:** stop or terminate the instance after you've captured your evidence. Don't leave it running.

---

## 5. Install the Kubernetes toolchain (run on the EC2)

Run everything as the `ubuntu` user with `sudo` where shown.

### 5.1 System prep

```bash
sudo apt-get update && sudo apt-get upgrade -y

# Disable swap (kubelet requirement)
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab

# Kernel modules + sysctl
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
sudo modprobe overlay
sudo modprobe br_netfilter

cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sudo sysctl --system
```

### 5.2 Docker + containerd

The assignment asks for Docker. Installing Docker also installs `containerd`, which is the runtime kubeadm actually uses.

```bash
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io
sudo usermod -aG docker ubuntu

# IMPORTANT: configure containerd for Kubernetes (systemd cgroups)
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml >/dev/null
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl restart containerd
sudo systemctl enable docker containerd
```

> Skipping the `SystemdCgroup = true` change is the #1 cause of `kubeadm init` hanging or pods crash-looping.

### 5.3 kubeadm, kubelet, kubectl

Check the current stable minor version at <https://kubernetes.io/releases/> and set `K8S_VER` (v1.30 shown):

```bash
K8S_VER=v1.30
curl -fsSL https://pkgs.k8s.io/core:/stable:/${K8S_VER}/deb/Release.key \
  | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${K8S_VER}/deb/ /" \
  | sudo tee /etc/apt/sources.list.d/kubernetes.list

sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
sudo systemctl enable --now kubelet
```

✅ `kubeadm version`, `kubectl version --client` and `docker --version` all print versions.
📸 Screenshot: these three outputs.

---

## 6. Initialise the single-node cluster

```bash
sudo kubeadm init --pod-network-cidr=10.244.0.0/16
```

Configure `kubectl` for your user (the init output prints this):

```bash
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

Install a CNI (Flannel matches the CIDR above):

```bash
kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml
```

**Single node means no workers, so remove the control-plane taint** or your pods will stay `Pending`:

```bash
kubectl taint nodes --all node-role.kubernetes.io/control-plane-
```

Verify:

```bash
kubectl get nodes                 # STATUS Ready (give it ~1-2 min)
kubectl get pods -A               # all Running
```

✅ Node is `Ready`.
📸 Screenshot: `kubectl get nodes` and `kubectl get pods -A`.

**Troubleshooting**

| Symptom | Fix |
|---|---|
| `kubeadm init` preflight fails on swap | Re-run `swapoff -a` |
| Node stays `NotReady` | CNI not up yet: `kubectl get pods -n kube-flannel` |
| `kubectl` connection refused | Check `~/.kube/config` was copied; `sudo systemctl status kubelet` |
| CoreDNS `Pending` | Taint not removed / CNI missing |
| Need to start over | `sudo kubeadm reset -f && sudo rm -rf /etc/cni/net.d ~/.kube` |

---

## 7. Namespace and manifests

Create a `k8s/` folder in your repo (locally, then commit and push). Keep the manifests in Git so graders see them.

### 7.1 `k8s/namespace.yaml`

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
```

### 7.2 `k8s/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: node-express-app
  namespace: production
  labels:
    app: node-express-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: node-express-app
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app: node-express-app
    spec:
      containers:
        - name: node-express-app
          image: <DOCKERHUB_USER>/node-express-app:v1
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 5000
          env:
            - name: PORT
              value: "5000"
          readinessProbe:
            httpGet:
              path: /api
              port: 5000
            initialDelaySeconds: 3
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /api
              port: 5000
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 250m
              memory: 128Mi
```

### 7.3 `k8s/service.yaml`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: node-express-app
  namespace: production
spec:
  type: NodePort
  selector:
    app: node-express-app
  ports:
    - port: 80
      targetPort: 5000
      nodePort: 30080
```

> Use a specific tag (`v1`), not `latest`, in the Deployment. It makes the rollout reproducible and shows you understand image versioning.

---

## 8. Deploy

Get the manifests onto the EC2 (clone your repo there):

```bash
git clone https://github.com/<YOUR_GH_USER>/Module-3-deployment.git
cd Module-3-deployment

kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/deployment.yaml -f k8s/service.yaml
kubectl rollout status deployment/node-express-app -n production
```

---

## 9. Verification

```bash
kubectl get ns production
kubectl get pods -n production -o wide      # 2/2 Running
kubectl get deploy,svc -n production
kubectl describe pod -n production -l app=node-express-app | grep -i "image"

# From the EC2
curl http://localhost:30080/api

# From your laptop / browser
curl http://<EC2_PUBLIC_IP>:30080/
curl http://<EC2_PUBLIC_IP>:30080/api
```

✅ Pods `Running` and `READY 1/1`; the browser shows the app at `http://<EC2_PUBLIC_IP>:30080`.
📸 Screenshot: `kubectl get pods -n production` + `kubectl get svc -n production` + the browser page with the IP in the address bar.

**Debug cheatsheet**

| Symptom | Command / likely cause |
|---|---|
| `ImagePullBackOff` | `kubectl describe pod ...`: typo in image name, tag not pushed, or repo is private |
| `CrashLoopBackOff` | `kubectl logs -n production <pod>`: app error / wrong port |
| `Pending` | Control-plane taint not removed or CNI missing |
| Not reachable from browser | Security group missing `30080` (range 30000-32767), or the wrong public IP (it changes after stop/start unless you use an Elastic IP) |
| Pods Running but not ready | Probe path/port mismatch |

---

## 10. Commit and submit

```bash
git add Dockerfile .dockerignore k8s/ README.md guideline.md
git commit -m "Dockerize app and add Kubernetes manifests for production namespace"
git push -u origin dockerize-k8s
```

Merge to `main` (or submit the branch link, but `main` is safer):

```bash
git checkout main && git merge dockerize-k8s && git push origin main
```

### Submission checklist

- [ ] **GitHub link**: `https://github.com/<YOUR_GH_USER>/Module-3-deployment` (contains `Dockerfile`, `.dockerignore`, `k8s/*.yaml`)
- [ ] **Docker Hub link**: `https://hub.docker.com/r/<DOCKERHUB_USER>/node-express-app`
- [ ] 📸 EC2 instance **running** (console)
- [ ] 📸 Security group inbound rules
- [ ] 📸 Image **pushed** (terminal and/or Docker Hub tags page)
- [ ] 📸 `kubectl get nodes` (Ready)
- [ ] 📸 `kubectl get pods,svc -n production` (Running, NodePort)
- [ ] 📸 App open in the browser via `http://<EC2_PUBLIC_IP>:30080`
- [ ] No secrets (Docker token, `.pem` key) committed. Check with `git log -p | grep -i -E "token|password|BEGIN RSA"`
- [ ] The EC2 instance is **stopped or terminated** after capturing evidence (the screenshots remain valid)

## Bonus (if time allows)

- Add `kubectl get all -n production` and `kubectl describe deploy` output to the README.
- Rolling update demo: push `v2`, then `kubectl set image deployment/node-express-app node-express-app=<DOCKERHUB_USER>/node-express-app:v2 -n production` and watch `kubectl rollout status`.
- Attach an Elastic IP so the URL survives a stop/start.
- Reuse the existing `Jenkinsfile` by changing `DOCKER_IMAGE_NAME` to your repo, to automate the build and push.
