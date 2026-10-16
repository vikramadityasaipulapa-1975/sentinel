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
