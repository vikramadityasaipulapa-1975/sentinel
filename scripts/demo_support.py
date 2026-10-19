"""Shared foreground demo lifecycle. Own exact native handles; retain Docker data."""

from contextlib import ExitStack
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import sysconfig
import time
from urllib.parse import urlsplit
from urllib.request import urlopen

from local_support import KEYS, ROOT, docker_executable

PORTS = (3000, 3001, 3002, 8001, 9090, 9093, 3100, 3200, 4418)
CONFIGS = (".env", ".env.api", ".env.evidence", ".env.knowledge")
OS_KEYS = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "HOME"}


def command(args, timeout=600):
    subprocess.run(args, cwd=ROOT, check=True, timeout=timeout)


def values(name):
    path = ROOT / name
    if path.is_symlink():
        raise RuntimeError("Configuration symlinks are not supported")
    return dict(line.split("=", 1) for line in path.read_text(encoding="utf-8").splitlines()
                if line and not line.startswith("#") and "=" in line) if path.is_file() else {}


def validate_configs():
    """Do not let local setup scripts target hosted or alternate databases."""
    databases = [(".env", "DATABASE_URL", "sentinel", 55432, "sentinel"),
                 (".env.api", "SENTINEL_DATABASE_URL", "sentinel_api", 55434, "sentinel_api"),
                 (".env.knowledge", "SENTINEL_KNOWLEDGE_OWNER_URL", "sentinel_knowledge", 55436, "knowledge_owner"),
                 (".env.knowledge", "SENTINEL_KNOWLEDGE_READ_URL", "sentinel_knowledge", 55436, "knowledge_reader"),
                 (".env.evidence", "SENTINEL_DEPLOYMENT_READ_URL", "sentinel", 55432, "sentinel_evidence_reader")]
    for filename, key, database, port, role in databases:
        settings = values(filename)
        if not (ROOT / filename).exists():
            continue
        url = urlsplit(settings.get(key, ""))
        if (url.scheme != "postgresql" or url.hostname != "127.0.0.1" or url.port != port
                or url.path != "/" + database or url.username != role or not url.password
                or url.query or url.fragment):
            raise RuntimeError(f"{filename} requires the documented dedicated loopback database; values omitted")
    api = values(".env.api")
    if api:
        redis = urlsplit(api.get("SENTINEL_REDIS_URL", ""))
        if (api.get("SENTINEL_API_PORT") != "3000" or api.get("SENTINEL_DB_PORT") != "55434"
                or api.get("SENTINEL_DATABASE_TLS") != "disable" or redis.scheme != "redis"
                or redis.hostname != "127.0.0.1" or redis.port != 56379 or redis.path != "/0"
                or not redis.password or redis.query or redis.fragment):
            raise RuntimeError("Existing API/Redis configuration is incomplete or uses unsupported local ports")
    evidence = values(".env.evidence")
    for key, port in [("SENTINEL_PROMETHEUS_URL", 9090), ("SENTINEL_LOKI_URL", 3100)]:
        if key in evidence and evidence[key] != f"http://127.0.0.1:{port}":
            raise RuntimeError("The demo requires its dedicated loopback collector URLs; values omitted")


def free_ports(ports=PORTS):
    for port in ports:
        try:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
        except OSError:
            raise RuntimeError(f"Port {port} is occupied; stop its owning demo terminal or use doctor. Nothing was stopped.") from None


def capture(args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=True, timeout=20).stdout.strip()


def preflight():
    """Read-only checks before dependency installs, seeding or Compose changes."""
    free_ports()
    validate_configs()
    if any(key.startswith(("SENTINEL_", "PAYMENT_")) or key in KEYS
           for key in os.environ):
        raise RuntimeError("Use a clean terminal without hosted/Sentinel environment overrides; values omitted")
    if sys.version_info[:2] != (3, 11):
        raise RuntimeError("Use Python 3.11 for the pinned demo dependencies")
    node, npm = shutil.which("node"), shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not node or not npm or not shutil.which("git"):
        raise RuntimeError("Git, Node 24 and npm 11 must be on PATH")
    if not capture([node, "--version"]).startswith("v24.") or not capture([npm, "--version"]).startswith("11."):
        raise RuntimeError("Use Node 24 and npm 11")
    docker = docker_executable()
    if capture([docker, "info", "--format", "{{.OSType}}"]) != "linux":
        raise RuntimeError("Docker must be running Linux containers")
    capture([docker, "compose", "version"])
    resources = capture([docker, "volume", "ls", "--format", "{{.Name}}"]).splitlines()
    resources += capture([docker, "ps", "-a", "--format", "{{.Names}}"]).splitlines()
    for filename, prefix in [(".env", "sentinel-demo"), (".env.api", "sentinel-api"), (".env.knowledge", "sentinel-knowledge")]:
        if not (ROOT / filename).exists() and any(name.startswith(prefix) for name in resources):
            raise RuntimeError(f"Existing {prefix} resources lack matching local configuration; restore the original file, never reset volumes")
    print("Preflight passed: ports free, dedicated configuration, tools and Linux Docker available", flush=True)


def prepare():
    """Reuse the existing bounded setup/migration/seed paths, without human accounts."""
    command([sys.executable, "scripts/init-local.py"])
    command([sys.executable, "scripts/knowledge-local.py"], timeout=900)
    command([sys.executable, "scripts/api-local.py", "--prepare-only"])
    command([shutil.which("npm.cmd" if os.name == "nt" else "npm"), "run", "build"])


def collector_command():
    args = [docker_executable(), "compose", "-f", str(ROOT / "infrastructure/compose.observability.yaml")]
    if sys.platform == "linux":
        # Native services bind loopback; host-network collectors must also bind loopback.
        directory = ROOT / ".artifacts/demo"
        directory.mkdir(parents=True, exist_ok=True)
        prometheus = directory / "prometheus.yaml"
        alertmanager = directory / "alertmanager.yaml"
        prometheus.write_text((ROOT / "infrastructure/observability/prometheus.yaml").read_text(encoding="utf-8")
                              .replace("host.docker.internal", "127.0.0.1").replace("alertmanager:9093", "127.0.0.1:9093"), encoding="utf-8")
        alertmanager.write_text((ROOT / "infrastructure/observability/alertmanager.yaml").read_text(encoding="utf-8")
                               .replace("host.docker.internal", "127.0.0.1"), encoding="utf-8")
        override = directory / "compose.json"
        override.write_text(json.dumps({"services": {
            "prometheus": {"network_mode": "host", "ports": [], "command": ["--config.file=/etc/prometheus/prometheus.yaml", "--storage.tsdb.path=/prometheus", "--storage.tsdb.retention.time=24h", "--storage.tsdb.retention.size=256MB", "--web.listen-address=127.0.0.1:9090"],
                           "volumes": [f"{prometheus.as_posix()}:/etc/prometheus/prometheus.yaml:ro"]},
            "alertmanager": {"network_mode": "host", "ports": [], "command": ["--config.file=/etc/alertmanager/config.yaml", "--storage.path=/alertmanager", "--data.retention=24h", "--cluster.listen-address=", "--web.listen-address=127.0.0.1:9093"],
                             "volumes": [f"{alertmanager.as_posix()}:/etc/alertmanager/config.yaml:ro"]}}}), encoding="utf-8")
        # Compose merge needs !reset for inherited ports; keep this small YAML separate.
        reset = directory / "ports.yaml"
        reset.write_text("services:\n  prometheus:\n    ports: !reset []\n  alertmanager:\n    ports: !reset []\n", encoding="utf-8")
        args += ["-f", str(override), "-f", str(reset)]
    return args


def ready(port, path, child=None, seconds=90):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if child is not None and child.poll() is not None:
            raise RuntimeError("Owned service exited; inspect ignored local logs")
        try:
            with urlopen(f"http://127.0.0.1:{port}{path}", timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.5)
    raise TimeoutError(f"Readiness timed out on port {port}")


def stop(child):
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)


class DemoStack:
    """No wrapper children/process matching. ExitStack unwinds partial starts too."""

    def __init__(self):
        self.stack = ExitStack()
        self.children = []

    def launch(self, name, args, env):
        directory = ROOT / ".artifacts/demo"
        directory.mkdir(parents=True, exist_ok=True)
        log = self.stack.enter_context((directory / f"{name}.log").open("w", encoding="utf-8"))
        child = subprocess.Popen(args, cwd=ROOT, env=env, stdout=log, stderr=log)
        self.children.append(child)
        self.stack.callback(stop, child)
        return child

    def __enter__(self):
        from observability_support import Demo, webhook_secret

        try:
            free_ports()
            validate_configs()
            spec = importlib.util.spec_from_file_location("api_local_demo", ROOT / "scripts/api-local.py")
            api = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(api)
            env = api.local_environment(ROOT / ".env.api")
            evidence = values(".env.evidence")
            engine_env = {key: value for key, value in os.environ.items() if key.upper() in OS_KEYS}
            engine_env.update(evidence)
            engine_env.update({key: value for key, value in values(".env.knowledge").items() if key == "SENTINEL_KNOWLEDGE_READ_URL"})
            engine_env["PYTHONPATH"] = os.pathsep.join([sysconfig.get_path("purelib"), str(ROOT / "apps/ai-engine")])
            engine = self.launch("engine", [sys._base_executable, str(ROOT / "apps/ai-engine/engine_main.py")], engine_env)
            ready(8001, "/health", engine)
            node = shutil.which("node")
            server = self.launch("api", [node, "apps/api/dist/src/server.js"], env)
            ready(3000, "/ready", server)
            worker_env = {key: value for key, value in env.items() if key not in {"SENTINEL_JWT_SECRET", "SENTINEL_ALERT_WEBHOOK_SECRET"}}
            worker_env.update(SENTINEL_EVIDENCE_URL="http://127.0.0.1:8001", SENTINEL_EVIDENCE_SECRET=evidence["SENTINEL_EVIDENCE_SECRET"])
            self.launch("worker", [node, "apps/api/dist/src/worker-main.js"], worker_env)
            self.demo = self.stack.enter_context(Demo())
            webhook_secret()
            self.collectors = collector_command()
            command(self.collectors + ["up", "-d", "prometheus", "loki", "alloy", "tempo", "alertmanager"])
            for port, path in [(9090, "/-/ready"), (3100, "/ready"), (3200, "/ready"), (9093, "/-/ready")]:
                ready(port, path)
            self.check()
            return self
        except BaseException:
            self.stack.close()
            raise

    def check(self):
        if any(child.poll() is not None for child in [*self.children, *self.demo.children.values()]):
            raise RuntimeError("An owned native service exited; inspect ignored logs")
        logs = [*(ROOT / ".artifacts/demo").glob("*.log"), *(ROOT / ".artifacts/observability/logs").glob("*.log")]
        if sum(path.stat().st_size for path in logs) > 20_000_000:
            raise RuntimeError("Demo log budget exceeded; inspect/archive local logs before restart")

    def __exit__(self, *_):
        self.stack.close()


def doctor():
    """Read-only HTTP probes; knowledge uses the actual unchanged eight-second bound."""
    checks = {}
    for name, port, path in [("api", 3000, "/ready"), ("engine", 8001, "/health"), ("checkout", 3001, "/health"),
                             ("payment", 3002, "/health"), ("prometheus", 9090, "/-/ready"), ("loki", 3100, "/ready"),
                             ("tempo", 3200, "/ready"), ("alertmanager", 9093, "/-/ready")]:
        try:
            ready(port, path, seconds=0.1)
            checks[name] = "READY"
        except (OSError, TimeoutError):
            checks[name] = "UNAVAILABLE"
    knowledge = "NOT_CONFIGURED"
    if values(".env.knowledge").get("SENTINEL_KNOWLEDGE_READ_URL"):
        env = {key: value for key, value in os.environ.items() if key.upper() in OS_KEYS}
        env["PYTHONPATH"] = os.pathsep.join([sysconfig.get_path("purelib"), str(ROOT / "apps/ai-engine")])
        env["SENTINEL_KNOWLEDGE_READ_URL"] = values(".env.knowledge")["SENTINEL_KNOWLEDGE_READ_URL"]
        source = "import os; from knowledge_service import _run; print(_run(os.environ, 'checkout-service', 'dependency')['status'])"
        try:
            result = subprocess.run([sys._base_executable, "-c", source], env=env, cwd=ROOT, capture_output=True, text=True, timeout=20, check=True)
            knowledge = "READY" if result.stdout.strip() == "OK" else "UNAVAILABLE"
        except (OSError, subprocess.SubprocessError):
            knowledge = "UNAVAILABLE"
    return {"core": "READY" if all(value == "READY" for value in checks.values()) else "UNAVAILABLE",
            "checks": checks, "knowledge": knowledge, "worker": "NOT_CHECKED_BY_HTTP", "scope": "local_read_only_probe_not_end_to_end_acceptance"}
