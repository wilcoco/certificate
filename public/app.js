const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginCard = document.getElementById("login-card");
const dashboard = document.getElementById("dashboard");
const employeeName = document.getElementById("employee-name");
const employeeMeta = document.getElementById("employee-meta");
const certificateList = document.getElementById("certificate-list");
const lastIssued = document.getElementById("last-issued");
const docCount = document.getElementById("doc-count");
const logoutButton = document.getElementById("logout-button");
const employeeAdmin = document.getElementById("employee-admin");
const employeeForm = document.getElementById("employee-form");
const employeeError = document.getElementById("employee-error");
const employeeTable = document.getElementById("employee-table");
const adminBadge = document.getElementById("admin-badge");

const state = {
  employee: null,
  certificates: [],
  employees: [],
  lastIssued: null,
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "요청에 실패했습니다.");
  }
  return data;
};

const renderDashboard = () => {
  if (!state.employee) return;
  loginCard.classList.add("hidden");
  dashboard.classList.remove("hidden");

  employeeName.textContent = `${state.employee.name}님`;
  employeeMeta.textContent = `${state.employee.department} · ${state.employee.role}`;

  certificateList.innerHTML = "";
  state.certificates.forEach((cert) => {
    const card = document.createElement("div");
    card.className = "certificate";
    card.innerHTML = `
      <div>
        <h3>${cert.title}</h3>
        <p>${cert.description}</p>
      </div>
      <button class="primary" data-id="${cert.id}">파일 다운로드</button>
    `;
    certificateList.appendChild(card);
  });

  docCount.textContent = `${state.certificates.length}건`;
  lastIssued.textContent = state.lastIssued || "-";
};

const renderEmployees = () => {
  if (!employeeTable) return;
  employeeTable.innerHTML = "";

  state.employees.forEach((record) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${record.employeeId}</td>
      <td>${record.name}</td>
      <td>${record.team}</td>
      <td>${record.joinDate}</td>
      <td>${record.retirementDate || "-"}</td>
      <td>
        <div class="action-group">
          <button class="secondary" data-action="edit" data-id="${record.employeeId}">
            수정
          </button>
          <button class="primary" data-action="delete" data-id="${record.employeeId}">
            삭제
          </button>
        </div>
      </td>
    `;
    employeeTable.appendChild(row);
  });
};

const loadSession = async () => {
  try {
    const data = await fetchJson("/api/me");
    state.employee = data.employee;
    state.certificates = data.certificates;
    state.employees = data.employees || [];
    renderDashboard();
    renderEmployees();
    if (state.employee.isAdmin) {
      employeeAdmin.classList.remove("hidden");
      adminBadge.classList.remove("hidden");
    }
  } catch (error) {
    loginCard.classList.remove("hidden");
  }
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";

  const formData = new FormData(loginForm);
  const employeeId = formData.get("employeeId");
  const password = formData.get("password");

  try {
    const data = await fetchJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, password }),
    });
    state.employee = data.employee;
    const sessionData = await fetchJson("/api/me");
    state.certificates = sessionData.certificates;
    state.employees = sessionData.employees || [];
    renderDashboard();
    renderEmployees();
    if (state.employee.isAdmin) {
      employeeAdmin.classList.remove("hidden");
      adminBadge.classList.remove("hidden");
    }
  } catch (error) {
    loginError.textContent = error.message;
  }
});

employeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  employeeError.textContent = "";

  const formData = new FormData(employeeForm);
  const payload = Object.fromEntries(formData.entries());
  const editingId = employeeForm.dataset.editing;

  try {
    if (editingId) {
      const data = await fetchJson(`/api/employees/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.employees = state.employees.map((record) =>
        record.employeeId === editingId ? data.employee : record
      );
    } else {
      const data = await fetchJson("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      state.employees = [...state.employees, data.employee];
    }
    renderEmployees();
    employeeForm.reset();
  } catch (error) {
    employeeError.textContent = error.message;
  }
});

employeeTable.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  if (action === "delete") {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await fetchJson(`/api/employees/${id}`, { method: "DELETE" });
      state.employees = state.employees.filter(
        (record) => record.employeeId !== id
      );
      renderEmployees();
    } catch (error) {
      employeeError.textContent = error.message;
    }
    return;
  }

  if (action === "edit") {
    const record = state.employees.find((item) => item.employeeId === id);
    if (!record) return;

    employeeForm.employeeId.value = record.employeeId;
    employeeForm.password.value = "";
    employeeForm.name.value = record.name;
    employeeForm.team.value = record.team;
    employeeForm.joinDate.value = record.joinDate;
    employeeForm.retirementDate.value = record.retirementDate || "";

    employeeForm.dataset.editing = id;
    employeeForm.querySelector("button").textContent = "사원 수정";
  }
});

employeeForm.addEventListener("reset", () => {
  employeeForm.dataset.editing = "";
  const button = employeeForm.querySelector("button");
  if (button) button.textContent = "사원 추가";
});

certificateList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;

  const id = button.dataset.id;
  button.textContent = "다운로드 중...";
  button.disabled = true;

  try {
    const response = await fetch(`/api/certificates/${id}`);
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "다운로드 실패");
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${id}_certificate.pdf`;
    link.click();
    window.URL.revokeObjectURL(url);

    state.lastIssued = new Date().toLocaleDateString("ko-KR");
    lastIssued.textContent = state.lastIssued;
  } catch (error) {
    alert(error.message);
  } finally {
    button.textContent = "파일 다운로드";
    button.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await fetchJson("/api/logout", { method: "POST" });
  state.employee = null;
  state.certificates = [];
  state.employees = [];
  state.lastIssued = null;
  dashboard.classList.add("hidden");
  employeeAdmin.classList.add("hidden");
  loginCard.classList.remove("hidden");
  loginForm.reset();
});

loadSession();
