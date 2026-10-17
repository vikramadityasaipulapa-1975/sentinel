let token = null;
const result = document.querySelector("#result");
const session = document.querySelector("#session");
async function request(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (response.status === 401) {
    token = null;
    session.textContent = "Not signed in or session expired. Log in again.";
  }
  return { response, data };
}
document.querySelector("#login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  stopWatching();
  token = null;
  const password = document.querySelector("#password");
  try {
    const { response, data } = await request("/api/v1/auth/login", "POST", {
      email: document.querySelector("#email").value,
      password: password.value,
    });
    if (response.ok) {
      token = data.access_token;
      session.textContent = `Signed in as ${data.user.email} (${data.user.role}). Access token expires in 15 minutes.`;
      result.textContent = JSON.stringify(
        {
          status: response.status,
          user: data.user,
          expires_in: data.expires_in,
        },
        null,
        2,
      );
    } else {
      session.textContent = "Login failed.";
      result.textContent = JSON.stringify(
        { status: response.status, ...data },
        null,
        2,
      );
    }
  } catch {
    session.textContent = "Login did not complete.";
    result.textContent = "Connection or timeout error. Check the API terminal.";
  } finally {
    password.value = "";
    button.disabled = false;
  }
});
document.querySelectorAll("[data-path]").forEach((button) =>
  button.addEventListener("click", async () => {
    try {
      const { response, data } = await request(button.dataset.path);
      result.textContent = JSON.stringify(
        { status: response.status, ...data },
        null,
        2,
      );
    } catch {
      result.textContent = "Connection or timeout error.";
    }
  }),
);
document.querySelector("#logout").addEventListener("click", () => {
  stopWatching();
  token = null;
  session.textContent = "Token forgotten in this page.";
  result.textContent = "Not signed in.";
});
document
  .querySelector("#incident")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const { response, data } = await request("/api/v1/incidents", "POST", {
        service_id: document.querySelector("#service").value,
        title: document.querySelector("#title").value,
        severity: "HIGH",
      });
      result.textContent = JSON.stringify(
        { status: response.status, ...data },
        null,
        2,
      );
    } catch {
      result.textContent =
        "Connection or timeout error. Check existing incidents before retrying a write.";
    } finally {
      button.disabled = false;
    }
  });

const keyInput = document.querySelector("#queue-key");
keyInput.value = crypto.randomUUID();
document.querySelector("#new-key").addEventListener("click", () => {
  keyInput.value = crypto.randomUUID();
});
document
  .querySelector("#investigation")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const response = await fetch(
        `/api/v1/incidents/${encodeURIComponent(document.querySelector("#queue-incident").value)}/investigations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": keyInput.value,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: "{}",
          signal: AbortSignal.timeout(10000),
        },
      );
      const data = await response.json();
      if (response.ok) document.querySelector("#queue-id").value = data.id;
      result.textContent = JSON.stringify(
        { status: response.status, ...data },
        null,
        2,
      );
    } catch {
      result.textContent =
        "Submission did not complete. Inspect status or retry with the same request key.";
    } finally {
      button.disabled = false;
    }
  });
document.querySelector("#job-status").addEventListener("click", async () => {
  try {
    const { response, data } = await request(
      `/api/v1/investigations/${encodeURIComponent(document.querySelector("#queue-id").value)}`,
    );
    result.textContent = JSON.stringify(
      { status: response.status, ...data },
      null,
      2,
    );
  } catch {
    result.textContent = "Status request failed.";
  }
});
document.querySelector("#job-list").addEventListener("click", async () => {
  try {
    const { response, data } = await request(
      `/api/v1/incidents/${encodeURIComponent(document.querySelector("#queue-incident").value)}/investigations`,
    );
    result.textContent = JSON.stringify(
      { status: response.status, ...data },
      null,
      2,
    );
  } catch {
    result.textContent = "List request failed.";
  }
});

let watching;
const streamStatus = document.querySelector("#stream-status");
function stopWatching() {
  watching?.abort();
  watching = undefined;
  streamStatus.textContent = "Stopped.";
}
document.querySelector("#stop-watch").addEventListener("click", stopWatching);
document
  .querySelector("#queue-incident")
  .addEventListener("input", stopWatching);
document.querySelector("#history").addEventListener("click", async () => {
  try {
    const { response, data } = await request(
      `/api/v1/incidents/${encodeURIComponent(document.querySelector("#queue-incident").value)}/events`,
    );
    result.textContent = JSON.stringify(
      { status: response.status, ...data },
      null,
      2,
    );
  } catch {
    result.textContent = "History request failed.";
  }
});
document.querySelector("#watch").addEventListener("click", async () => {
  stopWatching();
  if (!token) {
    streamStatus.textContent = "Log in before watching.";
    return;
  }
  const controller = new AbortController();
  watching = controller;
  const incident = document.querySelector("#queue-incident").value;
  const timeline = document.querySelector("#timeline");
  const lines = [];
  let lastId;
  timeline.textContent = "";
  for (let attempt = 0; attempt < 5 && !controller.signal.aborted; attempt++) {
    try {
      streamStatus.textContent = "Connecting�";
      const response = await fetch(
        `/api/v1/incidents/${encodeURIComponent(incident)}/stream`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            ...(lastId ? { "last-event-id": lastId } : {}),
          },
          signal: controller.signal,
          cache: "no-store",
        },
      );
      if (!response.ok) {
        if (response.status === 401) {
          token = null;
          session.textContent = "Session expired. Log in again.";
        }
        streamStatus.textContent = `Stream rejected (${response.status}).`;
        return;
      }
      streamStatus.textContent = "Watching saved and live events.";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const fields = Object.fromEntries(
              frame
                .split("\n")
                .filter((line) => !line.startsWith(":"))
                .map((line) => {
                  const i = line.indexOf(":");
                  return [line.slice(0, i), line.slice(i + 1).trimStart()];
                }),
            );
            if (fields.event === "auth_expired") {
              token = null;
              session.textContent = "Session changed. Log in again.";
              stopWatching();
              return;
            }
            if (fields.event === "stream_error")
              throw new Error("Stream interrupted");
            if (fields.event === "incident_event" && fields.id !== lastId) {
              const event = JSON.parse(fields.data);
              lines.push(JSON.stringify(event));
              if (lines.length > 100) lines.shift();
              timeline.textContent = lines.join("\n");
              lastId = fields.id;
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch {
      if (controller.signal.aborted) return;
    }
    if (!controller.signal.aborted) {
      streamStatus.textContent = "Reconnecting from the last saved event ID�";
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, (attempt + 1) * 1000);
        controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
  if (!controller.signal.aborted)
    streamStatus.textContent =
      "Reconnect budget exhausted. Click Watch to reload history.";
});

let evidenceCursor = null;
let evidenceInvestigation = null;
async function loadEvidence(next) {
  const id = document.querySelector("#queue-id").value;
  if (!next || evidenceInvestigation !== id) evidenceCursor = null;
  evidenceInvestigation = id;
  try {
    const params = new URLSearchParams({ limit: "4" });
    if (evidenceCursor) params.set("cursor", evidenceCursor);
    const { response, data } = await request(
      `/api/v1/investigations/${encodeURIComponent(id)}/evidence?${params}`,
    );
    evidenceCursor = response.ok ? data.next_cursor : null;
    document.querySelector("#next-evidence").disabled = !evidenceCursor;
    result.textContent = JSON.stringify(
      { status: response.status, ...data },
      null,
      2,
    );
  } catch {
    result.textContent =
      "Evidence request failed. Check the investigation ID and session.";
  }
}
document
  .querySelector("#job-evidence")
  .addEventListener("click", () => loadEvidence(false));
document
  .querySelector("#next-evidence")
  .addEventListener("click", () => loadEvidence(true));
