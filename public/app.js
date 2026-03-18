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
const employeeSearch = document.getElementById("employee-search");
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

const withholdingAutoLinkForm = document.getElementById(
  "withholding-auto-link-form"
);
const withholdingAutoLinkTaxYear = document.getElementById(
  "withholdingAutoLinkTaxYear"
);
const withholdingAutoLinkStatus = document.getElementById(
  "withholding-auto-link-status"
);
const withholdingAutoLinkError = document.getElementById(
  "withholding-auto-link-error"
);

const state = {
  employee: null,
  certificates: [],
  employees: [],
  lastIssued: null,
};

const fetchJson = async (url, options = {}) => {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(fetchOptions.headers || {}),
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

  const query = String(employeeSearch?.value || "")
    .trim()
    .toLowerCase();
  const filteredEmployees = query
    ? state.employees.filter((record) => {
        const id = String(record.employeeId || "").toLowerCase();
        const name = String(record.name || "").toLowerCase();
        return id.includes(query) || name.includes(query);
      })
    : state.employees;

  filteredEmployees.forEach((record) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${record.employeeId}</td>
      <td>${record.name}</td>
      <td>${record.team}</td>
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

if (employeeSearch) {
  employeeSearch.addEventListener("input", () => {
    renderEmployees();
  });
}

if (withholdingAutoLinkForm) {
  withholdingAutoLinkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (withholdingAutoLinkError) withholdingAutoLinkError.textContent = "";
    if (withholdingAutoLinkStatus) withholdingAutoLinkStatus.textContent = "";

    const taxYearValue = String(withholdingAutoLinkTaxYear?.value || "").trim();
    const payload = {};
    if (taxYearValue) {
      payload.taxYear = taxYearValue;
    }

    const submitButton = withholdingAutoLinkForm.querySelector("button");
    const originalButtonText = submitButton?.textContent;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "자동 매칭 중...";
    }
    if (withholdingAutoLinkStatus) {
      withholdingAutoLinkStatus.textContent = "자동 매칭 중...";
    }

    try {
      const data = await fetchJson("/api/admin/withholding-receipts/auto-link", {
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: 60000,
      });

      const linkedCount = data.linkedCount ?? 0;
      const targetCount = data.targetCount ?? 0;
      const noMatchCount = data.noMatchCount ?? 0;
      const conflictCount = data.conflictCount ?? 0;
      const missingEmployeeRowCount = data.missingEmployeeRowCount ?? 0;
      const errorCount = data.errorCount ?? 0;

      if (withholdingAutoLinkStatus) {
        const yearText = data.taxYear ? ` (귀속연도: ${data.taxYear})` : "";
        const detail =
          targetCount
            ? ` / 대상 ${targetCount}건 (미매칭 ${noMatchCount}건, 충돌 ${conflictCount}건, 사원미등록 ${missingEmployeeRowCount}건, 오류 ${errorCount}건)`
            : "";
        withholdingAutoLinkStatus.textContent = `자동 매칭 완료: ${linkedCount}건${yearText}${detail}`;
      }
      withholdingAutoLinkForm.reset();
    } catch (error) {
      if (withholdingAutoLinkError) {
        withholdingAutoLinkError.textContent = error.message;
      }
      if (withholdingAutoLinkStatus) {
        withholdingAutoLinkStatus.textContent = "";
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
      }
    }
  });
}

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

if (employeeForm) {
  employeeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (employeeError) {
      employeeError.textContent = "";
    }
  });
}

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

