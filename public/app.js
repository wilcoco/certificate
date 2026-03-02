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

const fetchJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    clearTimeout(timeoutId);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "요청에 실패했습니다.");
    }
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error("요청 시간이 초과되었습니다.");
    }
    throw error;
  }
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

// 모바일 터치 피드백 추가
document.addEventListener('DOMContentLoaded', () => {
  // 터치 디바이스 감지
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  
  if (isTouchDevice) {
    // 버튼에 터치 피드백 추가
    document.querySelectorAll('button').forEach(button => {
      button.addEventListener('touchstart', function() {
        this.style.transform = 'scale(0.98)';
      }, { passive: true });
      
      button.addEventListener('touchend', function() {
        this.style.transform = '';
      }, { passive: true });
    });
    
    // 입력 필드 포커스 시 키보드 공간 확보
    const inputs = document.querySelectorAll('input[type="text"], input[type="password"], input[type="date"]');
    inputs.forEach(input => {
      input.addEventListener('focus', () => {
        // iOS Safari에서 뷰포트 조정
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
          viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, height=device-height');
        }
      });
      
      input.addEventListener('blur', () => {
        // 뷰포트 원복
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
          viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
        }
      });
    });
  }
  
  // 세션 로드
  loadSession();
});

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
      button.textContent = "삭제 중...";
      button.disabled = true;
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
    
    // 모바일에서 폼 위치로 스크롤
    employeeForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  const originalText = button.textContent;
  button.textContent = "다운로드 중...";
  button.disabled = true;

  try {
    const response = await fetch(`/api/certificates/${id}`);
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "다운로드 실패");
    }
    const blob = await response.blob();
    
    // 모바일에서 파일 다운로드 처리
    if (navigator.share && navigator.canShare && blob.type === 'application/pdf') {
      const file = new File([blob], `${id}_certificate.pdf`, { type: 'application/pdf' });
      try {
        await navigator.share({
          title: `${state.certificates.find(c => c.id === id)?.title}`,
          text: '문서가 발급되었습니다.',
          files: [file],
        });
      } catch (shareError) {
        // 공유 실패 시 기본 다운로드
        downloadFile(blob, `${id}_certificate.pdf`);
      }
    } else {
      downloadFile(blob, `${id}_certificate.pdf`);
    }

    state.lastIssued = new Date().toLocaleDateString("ko-KR");
    lastIssued.textContent = state.lastIssued;
  } catch (error) {
    alert(error.message);
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
});

const downloadFile = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

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
