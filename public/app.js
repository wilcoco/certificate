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
const maskResidentNumberToggle = document.getElementById("mask-resident-number");

const withholdingUploadForm = document.getElementById(
  "withholding-upload-form"
);
const withholdingUploadFile = document.getElementById("withholdingUploadFile");
const withholdingTaxYear = document.getElementById("withholdingTaxYear");
const withholdingUploadStatus = document.getElementById(
  "withholding-upload-status"
);
const withholdingUploadError = document.getElementById(
  "withholding-upload-error"
);

const withholdingLinkForm = document.getElementById("withholding-link-form");
const withholdingLinkEmployeeId = document.getElementById(
  "withholdingLinkEmployeeId"
);
const withholdingLinkName = document.getElementById("withholdingLinkName");
const withholdingLinkResidentNumber = document.getElementById(
  "withholdingLinkResidentNumber"
);
const withholdingLinkTaxYear = document.getElementById("withholdingLinkTaxYear");
const withholdingLinkStatus = document.getElementById("withholding-link-status");
const withholdingLinkError = document.getElementById("withholding-link-error");

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
  employeeMeta.textContent = state.employee.team || "";

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
      <td>${record.address || "-"}</td>
      <td>${record.residentNumber || "-"}</td>
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
  const employeeId = String(formData.get("employeeId") || "").trim();
  const password = String(formData.get("password") || "").trim();

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
  Object.keys(payload).forEach((key) => {
    if (typeof payload[key] === "string") {
      payload[key] = payload[key].trim();
    }
  });
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
    employeeForm.address.value = record.address || "";
    employeeForm.residentNumber.value = record.residentNumber || "";
    employeeForm.joinDate.value = record.joinDate;
    employeeForm.retirementDate.value = record.retirementDate || "";

    employeeForm.dataset.editing = id;
    employeeForm.querySelector("button").textContent = "사원 수정";

    document.getElementById("newEmployeeId").disabled = true;
    document.getElementById("newPassword").required = false;
    
    // 모바일에서 폼 위치로 스크롤
    employeeForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

employeeForm.addEventListener("reset", () => {
  employeeForm.dataset.editing = "";
  const button = employeeForm.querySelector("button");
  if (button) button.textContent = "사원 추가";

  document.getElementById("newEmployeeId").disabled = false;
  document.getElementById("newPassword").required = true;
});

certificateList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;

  const id = button.dataset.id;
  const certificate = state.certificates.find((item) => item.id === id);
  const filename = certificate?.filename || `${id}_certificate.pdf`;
  const originalText = button.textContent;
  button.textContent = "다운로드 중...";
  button.disabled = true;

  try {
    const maskResidentNumber = maskResidentNumberToggle?.checked ? "1" : "0";
    const response = await fetch(
      `/api/certificates/${id}?maskResidentNumber=${encodeURIComponent(maskResidentNumber)}`
    );
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "다운로드 실패");
    }
    const blob = await response.blob();
    
    // 모바일에서 파일 다운로드 처리
    if (navigator.share && navigator.canShare && blob.type === 'application/pdf') {
      const file = new File([blob], filename, { type: 'application/pdf' });
      try {
        await navigator.share({
          title: `${certificate?.title}`,
          text: '문서가 발급되었습니다.',
          files: [file],
        });
      } catch (shareError) {
        // 공유 실패 시 기본 다운로드
        downloadFile(blob, filename);
      }
    } else {
      downloadFile(blob, filename);
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

if (withholdingUploadForm) {
  withholdingUploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (withholdingUploadError) withholdingUploadError.textContent = "";
    if (withholdingUploadStatus) withholdingUploadStatus.textContent = "";

    const file = withholdingUploadFile?.files?.[0];
    if (!file) {
      if (withholdingUploadError) {
        withholdingUploadError.textContent = "업로드 파일을 선택해주세요.";
      }
      return;
    }

    const formData = new FormData();
    formData.append("file", file, file.name);
    const taxYearValue = String(withholdingTaxYear?.value || "").trim();
    if (taxYearValue) {
      formData.append("taxYear", taxYearValue);
    }

    const submitButton = withholdingUploadForm.querySelector("button");
    const originalButtonText = submitButton?.textContent;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "업로드 중...";
    }
    if (withholdingUploadStatus) {
      withholdingUploadStatus.textContent = "업로드 중...";
    }

    try {
      const response = await fetch("/api/admin/withholding-receipts/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "업로드에 실패했습니다.");
      }

      const imported = data.importedCount ?? 0;
      const skipped = data.skippedCount ?? 0;
      const matched = data.matchedCount ?? 0;
      const staged = data.stagedCount ?? 0;
      if (withholdingUploadStatus) {
        const breakdown =
          matched || staged
            ? ` (매칭 ${matched}개, 스테이징 ${staged}개)`
            : "";
        withholdingUploadStatus.textContent = `업로드 완료: ${imported}개 저장${breakdown}, ${skipped}개 스킵`;
      }
      withholdingUploadForm.reset();
    } catch (error) {
      if (withholdingUploadError) {
        withholdingUploadError.textContent = error.message;
      }
      if (withholdingUploadStatus) {
        withholdingUploadStatus.textContent = "";
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
      }
    }
  });
}

if (withholdingLinkForm) {
  withholdingLinkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (withholdingLinkError) withholdingLinkError.textContent = "";
    if (withholdingLinkStatus) withholdingLinkStatus.textContent = "";

    const employeeIdValue = String(withholdingLinkEmployeeId?.value || "").trim();
    const nameValue = String(withholdingLinkName?.value || "").trim();
    const residentNumberValue = String(
      withholdingLinkResidentNumber?.value || ""
    ).trim();
    const taxYearValue = String(withholdingLinkTaxYear?.value || "").trim();

    if (!employeeIdValue || !nameValue || !residentNumberValue) {
      if (withholdingLinkError) {
        withholdingLinkError.textContent =
          "사번, 이름, 주민등록번호를 입력해주세요.";
      }
      return;
    }

    const payload = {
      employeeId: employeeIdValue,
      name: nameValue,
      residentNumber: residentNumberValue,
    };
    if (taxYearValue) {
      payload.taxYear = taxYearValue;
    }

    const submitButton = withholdingLinkForm.querySelector("button");
    const originalButtonText = submitButton?.textContent;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "매칭 중...";
    }
    if (withholdingLinkStatus) {
      withholdingLinkStatus.textContent = "매칭 중...";
    }

    try {
      const data = await fetchJson("/api/admin/withholding-receipts/link", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const linkedCount = data.linkedCount ?? 0;
      const taxYears = Array.isArray(data.taxYears) ? data.taxYears : [];

      if (withholdingLinkStatus) {
        const taxYearText = taxYears.length
          ? ` (귀속연도: ${taxYears.join(", ")})`
          : "";
        withholdingLinkStatus.textContent = `매칭 완료: ${linkedCount}건${taxYearText}`;
      }
      withholdingLinkForm.reset();
    } catch (error) {
      if (withholdingLinkError) {
        withholdingLinkError.textContent = error.message;
      }
      if (withholdingLinkStatus) {
        withholdingLinkStatus.textContent = "";
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
      }
    }
  });
}

loadSession();
