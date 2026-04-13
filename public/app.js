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

const shopSection = document.getElementById("shop-section");
const myPointsBadge = document.getElementById("my-points-badge");
const shopProductList = document.getElementById("shop-product-list");
const myOrdersTable = document.getElementById("my-orders-table");

const shopCsvImportForm = document.getElementById("shop-csv-import-form");
const shopCsvImportStatus = document.getElementById("shop-csv-import-status");
const shopCsvImportError = document.getElementById("shop-csv-import-error");

const shopAddProductForm = document.getElementById("shop-add-product-form");
const shopAddProductStatus = document.getElementById("shop-add-product-status");
const shopAddProductError = document.getElementById("shop-add-product-error");
const adminProductsTable = document.getElementById("admin-products-table");

const shopPointForm = document.getElementById("shop-point-form");
const shopPointStatus = document.getElementById("shop-point-status");
const shopPointError = document.getElementById("shop-point-error");

const shopPointBulkForm = document.getElementById("shop-point-bulk-form");
const shopPointBulkStatus = document.getElementById("shop-point-bulk-status");
const shopPointBulkError = document.getElementById("shop-point-bulk-error");

const adminOrdersTable = document.getElementById("admin-orders-table");
const adminOrdersRefresh = document.getElementById("admin-orders-refresh");

const state = {
  employee: null,
  certificates: [],
  employees: [],
  lastIssued: null,
  products: [],
  myOrders: [],
  myPoints: 0,
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
    const pts = record.points != null ? Number(record.points).toLocaleString() : "0";
    row.innerHTML = `
      <td>${record.employeeId}</td>
      <td>${record.name}</td>
      <td>${record.team}</td>
      <td>${pts}P</td>
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
    loadShop();
    if (state.employee.isAdmin) {
      employeeAdmin.classList.remove("hidden");
      adminBadge.classList.remove("hidden");
      loadAdminProducts();
      loadAdminOrders();
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
    loadShop();
    if (state.employee.isAdmin) {
      employeeAdmin.classList.remove("hidden");
      adminBadge.classList.remove("hidden");
      loadAdminProducts();
      loadAdminOrders();
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
    // 원천징수 영수증 외 증명서는 주민번호 뒷자리 검증 필요
    let residentBack = "";
    if (id !== "withholding") {
      residentBack = prompt("본인 확인을 위해 주민등록번호 뒷자리 7자리를 입력하세요.");
      if (!residentBack || residentBack.trim().length === 0) {
        button.textContent = originalText;
        button.disabled = false;
        return;
      }
      residentBack = residentBack.trim();
    }

    const maskResidentNumber = maskResidentNumberToggle?.checked ? "1" : "0";
    const response = await fetch(
      `/api/certificates/${id}?maskResidentNumber=${encodeURIComponent(maskResidentNumber)}${residentBack ? `&residentBack=${encodeURIComponent(residentBack)}` : ""}`
    );
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "다운로드 실패");
    }
    const blob = await response.blob();
    
    // 모바일에서 파일 다운로드 처리
    const isPdfBlob = blob.type === 'application/pdf';
    let handled = false;

    if (typeof navigator.share === 'function' && isPdfBlob) {
      const file = new File([blob], filename, { type: 'application/pdf' });
      const canShareFiles =
        typeof navigator.canShare !== 'function'
          ? true
          : (() => {
              try {
                return navigator.canShare({ files: [file] });
              } catch (canShareError) {
                return false;
              }
            })();

      if (canShareFiles) {
        try {
          await navigator.share({
            title: `${certificate?.title}`,
            text: '문서가 발급되었습니다.',
            files: [file],
          });
          handled = true;
        } catch (shareError) {
          // 공유 실패 시 기본 다운로드
          downloadFile(blob, filename);
          handled = true;
        }
      }
    }

    if (!handled) {
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
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (isIOS) {
    window.location.href = url;
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 60000);
    return;
  }

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
  state.products = [];
  state.myOrders = [];
  state.myPoints = 0;
  dashboard.classList.add("hidden");
  employeeAdmin.classList.add("hidden");
  if (shopSection) shopSection.classList.add("hidden");
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

// ======== 복지 포인트몰 ========

const formatPoints = (n) => Number(n || 0).toLocaleString("ko-KR") + " P";

const loadShop = async () => {
  try {
    const [productsData, pointsData, ordersData] = await Promise.all([
      fetchJson("/api/products"),
      fetchJson("/api/points/me"),
      fetchJson("/api/orders/me"),
    ]);
    state.products = productsData.products || [];
    state.myPoints = pointsData.points || 0;
    state.myOrders = ordersData.orders || [];
    renderShop();
  } catch (error) {
    console.error("복지몰 로드 실패", error);
  }
};

const renderShop = () => {
  if (!shopSection) return;
  shopSection.classList.remove("hidden");

  if (myPointsBadge) myPointsBadge.textContent = formatPoints(state.myPoints);

  if (shopProductList) {
    shopProductList.innerHTML = "";
    if (!state.products.length) {
      shopProductList.innerHTML = '<div class="shop-empty">등록된 상품이 없습니다.</div>';
    } else {
      state.products.forEach((p) => {
        const card = document.createElement("div");
        card.className = "shop-product";
        const imgHtml = p.image_url
          ? `<img class="shop-product__img" src="${p.image_url}" alt="${p.name}" onerror="this.style.display='none'" />`
          : `<div class="shop-product__img"></div>`;
        const categoryHtml = p.category ? `<p class="shop-product__category">${p.category}</p>` : "";
        const descHtml = p.description ? `<p class="shop-product__desc">${p.description}</p>` : "";
        const stockText = p.stock >= 0 ? ` (재고: ${p.stock})` : "";
        card.innerHTML = `
          ${imgHtml}
          <div class="shop-product__body">
            ${categoryHtml}
            <p class="shop-product__name">${p.name}</p>
            ${descHtml}
            <p class="shop-product__price">${formatPoints(p.point_price)}${stockText}</p>
          </div>
          <button class="primary" data-product-id="${p.id}">구매</button>
        `;
        shopProductList.appendChild(card);
      });
    }
  }

  renderMyOrders();
};

const renderMyOrders = () => {
  if (!myOrdersTable) return;
  myOrdersTable.innerHTML = "";
  state.myOrders.forEach((o) => {
    const row = document.createElement("tr");
    const dateStr = o.ordered_at ? new Date(o.ordered_at).toLocaleString("ko-KR") : "-";
    row.innerHTML = `
      <td>${o.product_name || "-"}</td>
      <td>${formatPoints(o.point_cost)}</td>
      <td>${o.quantity || 1}</td>
      <td>${dateStr}</td>
    `;
    myOrdersTable.appendChild(row);
  });
};

if (shopProductList) {
  shopProductList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-product-id]");
    if (!button) return;

    const productId = Number(button.dataset.productId);
    const product = state.products.find((p) => p.id === productId);
    if (!product) return;

    const confirmed = confirm(`"${product.name}" (${formatPoints(product.point_price)})을(를) 구매하시겠습니까?`);
    if (!confirmed) return;

    button.disabled = true;
    button.textContent = "구매 중...";

    try {
      const data = await fetchJson("/api/orders", {
        method: "POST",
        body: JSON.stringify({ productId, quantity: 1 }),
      });
      state.myPoints = data.remainingPoints;
      if (myPointsBadge) myPointsBadge.textContent = formatPoints(state.myPoints);
      alert(`구매 완료! 잔여 포인트: ${formatPoints(data.remainingPoints)}`);
      await loadShop();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "구매";
    }
  });
}

// 관리자: CSV 상품 가져오기
if (shopCsvImportForm) {
  shopCsvImportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (shopCsvImportError) shopCsvImportError.textContent = "";
    if (shopCsvImportStatus) shopCsvImportStatus.textContent = "";

    const fileInput = document.getElementById("shopCsvFile");
    const file = fileInput?.files?.[0];
    if (!file) {
      if (shopCsvImportError) shopCsvImportError.textContent = "CSV 파일을 선택해주세요.";
      return;
    }

    const formData = new FormData();
    formData.append("file", file, file.name);

    const submitButton = shopCsvImportForm.querySelector("button");
    const originalText = submitButton?.textContent;
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = "가져오는 중..."; }

    try {
      const response = await fetch("/api/admin/products/import-csv", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "가져오기 실패");
      if (shopCsvImportStatus) shopCsvImportStatus.textContent = `가져오기 완료: ${data.importedCount}개 등록, ${data.skippedCount}개 스킵`;
      shopCsvImportForm.reset();
      loadAdminProducts();
      loadShop();
    } catch (error) {
      if (shopCsvImportError) shopCsvImportError.textContent = error.message;
    } finally {
      if (submitButton) { submitButton.disabled = false; submitButton.textContent = originalText; }
    }
  });
}

// 이미지 파일 업로드 헬퍼
const uploadProductImage = async (file) => {
  const formData = new FormData();
  formData.append("image", file, file.name);
  const response = await fetch("/api/admin/products/upload-image", { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "이미지 업로드 실패");
  return data.imageUrl;
};

// 관리자: 상품 개별 등록
if (shopAddProductForm) {
  shopAddProductForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (shopAddProductError) shopAddProductError.textContent = "";
    if (shopAddProductStatus) shopAddProductStatus.textContent = "";

    const fd = new FormData(shopAddProductForm);
    let imageUrl = fd.get("imageUrl") || "";

    try {
      // 파일이 있으면 먼저 업로드
      const imageFile = document.getElementById("shopProductImageFile")?.files?.[0];
      if (imageFile) {
        if (shopAddProductStatus) shopAddProductStatus.textContent = "이미지 업로드 중...";
        imageUrl = await uploadProductImage(imageFile);
      }

      const payload = {
        name: fd.get("name"),
        pointPrice: fd.get("pointPrice"),
        category: fd.get("category") || "",
        imageUrl,
        description: fd.get("description") || "",
        stock: Number(fd.get("stock")) || -1,
      };

      await fetchJson("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
      if (shopAddProductStatus) shopAddProductStatus.textContent = "상품이 등록되었습니다.";
      shopAddProductForm.reset();
      document.getElementById("shopProductStock").value = "-1";
      loadAdminProducts();
      loadShop();
    } catch (error) {
      if (shopAddProductError) shopAddProductError.textContent = error.message;
    }
  });
}

// 관리자: 상품 목록
const showEditForm = (product) => {
  const existing = document.getElementById("product-edit-panel");
  if (existing) existing.remove();

  const panel = document.createElement("div");
  panel.id = "product-edit-panel";
  panel.style.cssText = "background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:16px;margin:12px 0;";
  const imgSrc = product.image_url || "";
  panel.innerHTML = `
    <h3 style="margin:0 0 12px">상품 수정 (ID: ${product.id})</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <label style="font-size:13px;font-weight:600">상품명</label>
        <input id="edit-p-name" type="text" value="${product.name}" style="width:100%;padding:6px;box-sizing:border-box" />
      </div>
      <div>
        <label style="font-size:13px;font-weight:600">포인트 가격</label>
        <input id="edit-p-price" type="number" value="${product.point_price}" style="width:100%;padding:6px;box-sizing:border-box" />
      </div>
      <div>
        <label style="font-size:13px;font-weight:600">카테고리</label>
        <input id="edit-p-category" type="text" value="${product.category || ""}" style="width:100%;padding:6px;box-sizing:border-box" />
      </div>
      <div>
        <label style="font-size:13px;font-weight:600">재고 (-1=무제한)</label>
        <input id="edit-p-stock" type="number" value="${product.stock}" style="width:100%;padding:6px;box-sizing:border-box" />
      </div>
      <div style="grid-column:1/-1">
        <label style="font-size:13px;font-weight:600">설명</label>
        <input id="edit-p-desc" type="text" value="${product.description || ""}" style="width:100%;padding:6px;box-sizing:border-box" />
      </div>
    </div>
    <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:12px">
      <div>
        <label style="font-size:13px;font-weight:600">현재 이미지</label><br>
        ${imgSrc ? `<img id="edit-p-preview" src="${imgSrc}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;margin-top:4px">` : `<span id="edit-p-preview" style="color:#aaa;font-size:13px">없음</span>`}
      </div>
      <div style="flex:1">
        <label style="font-size:13px;font-weight:600">새 이미지 업로드</label>
        <input id="edit-p-file" type="file" accept="image/*" style="margin-top:4px;width:100%" />
        <p id="edit-p-upload-status" style="font-size:12px;color:#666;margin:4px 0 0"></p>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button id="edit-p-save" style="padding:6px 20px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px">저장</button>
      <button id="edit-p-cancel" style="padding:6px 20px;background:#6b7280;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px">취소</button>
    </div>
    <p id="edit-p-error" style="color:red;font-size:13px;margin:6px 0 0"></p>
  `;

  const wrap = document.getElementById("admin-products-wrap");
  wrap.parentNode.insertBefore(panel, wrap);

  // 파일 선택 시 미리보기
  document.getElementById("edit-p-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = document.getElementById("edit-p-preview");
    if (preview.tagName === "IMG") {
      preview.src = URL.createObjectURL(file);
    } else {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.style.cssText = "width:80px;height:80px;object-fit:cover;border-radius:6px;margin-top:4px";
      img.id = "edit-p-preview";
      preview.replaceWith(img);
    }
  });

  document.getElementById("edit-p-cancel").addEventListener("click", () => panel.remove());

  document.getElementById("edit-p-save").addEventListener("click", async () => {
    const saveBtn = document.getElementById("edit-p-save");
    const errEl = document.getElementById("edit-p-error");
    const statusEl = document.getElementById("edit-p-upload-status");
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중...";
    errEl.textContent = "";

    try {
      let imageUrl = product.image_url || "";
      const imageFile = document.getElementById("edit-p-file").files[0];
      if (imageFile) {
        statusEl.textContent = "이미지 업로드 중...";
        imageUrl = await uploadProductImage(imageFile);
        statusEl.textContent = "업로드 완료";
      }

      await fetchJson(`/api/admin/products/${product.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: document.getElementById("edit-p-name").value,
          pointPrice: Number(document.getElementById("edit-p-price").value),
          category: document.getElementById("edit-p-category").value,
          description: document.getElementById("edit-p-desc").value,
          imageUrl,
          stock: Number(document.getElementById("edit-p-stock").value),
          active: product.active,
        }),
      });
      panel.remove();
      loadAdminProducts();
      loadShop();
    } catch (err) {
      errEl.textContent = "수정 실패: " + err.message;
      saveBtn.disabled = false;
      saveBtn.textContent = "저장";
    }
  });
};

const loadAdminProducts = async () => {
  if (!adminProductsTable) return;
  try {
    const data = await fetchJson("/api/admin/products");
    adminProductsTable.innerHTML = "";
    (data.products || []).forEach((p) => {
      const row = document.createElement("tr");
      const imgSrc = p.image_url || "";
      const imgHtml = imgSrc
        ? `<img src="${imgSrc}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:4px;">`
        : `<span style="color:#aaa;font-size:12px">없음</span>`;
      row.innerHTML = `
        <td>${p.id}</td>
        <td>${imgHtml}</td>
        <td>${p.name}</td>
        <td>${formatPoints(p.point_price)}</td>
        <td>${p.stock < 0 ? "무제한" : p.stock}</td>
        <td>${p.active !== false ? "활성" : "비활성"}</td>
        <td>
          <button class="btn-edit-product" data-id="${p.id}" style="font-size:12px;padding:4px 10px;margin:2px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer">수정</button>
          <button class="btn-del-product" data-id="${p.id}" style="font-size:12px;padding:4px 10px;margin:2px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer">삭제</button>
        </td>
      `;
      adminProductsTable.appendChild(row);
    });

    adminProductsTable.querySelectorAll(".btn-edit-product").forEach((btn) => {
      btn.addEventListener("click", () => {
        const product = (data.products || []).find((p) => String(p.id) === btn.dataset.id);
        if (product) showEditForm(product);
      });
    });

    adminProductsTable.querySelectorAll(".btn-del-product").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("정말 삭제하시겠습니까?")) return;
        try {
          await fetchJson(`/api/admin/products/${btn.dataset.id}`, { method: "DELETE" });
          loadAdminProducts();
          loadShop();
        } catch (err) {
          alert("삭제 실패: " + err.message);
        }
      });
    });
  } catch (error) {
    console.error("관리자 상품 목록 로드 실패", error);
  }
};

// 관리자: 포인트 설정
if (shopPointForm) {
  shopPointForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (shopPointError) shopPointError.textContent = "";
    if (shopPointStatus) shopPointStatus.textContent = "";

    const fd = new FormData(shopPointForm);
    const payload = {
      employeeId: fd.get("employeeId") || "",
      name: fd.get("name") || "",
      points: fd.get("points"),
    };

    try {
      const data = await fetchJson("/api/admin/points", { method: "POST", body: JSON.stringify(payload) });
      if (shopPointStatus) shopPointStatus.textContent = `${data.employee.name}님 포인트: ${formatPoints(data.employee.points)}`;
      shopPointForm.reset();
    } catch (error) {
      if (shopPointError) shopPointError.textContent = error.message;
    }
  });
}

// 관리자: 전체 일괄 포인트
if (shopPointBulkForm) {
  shopPointBulkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (shopPointBulkError) shopPointBulkError.textContent = "";
    if (shopPointBulkStatus) shopPointBulkStatus.textContent = "";

    const fd = new FormData(shopPointBulkForm);
    const points = fd.get("points");
    const confirmed = confirm(`전체 사원에게 ${Number(points).toLocaleString("ko-KR")} P를 일괄 설정합니다. 계속하시겠습니까?`);
    if (!confirmed) return;

    try {
      const data = await fetchJson("/api/admin/points/bulk", { method: "POST", body: JSON.stringify({ points }) });
      if (shopPointBulkStatus) shopPointBulkStatus.textContent = `${data.updatedCount}명에게 ${formatPoints(data.points)} 설정 완료`;
      shopPointBulkForm.reset();
    } catch (error) {
      if (shopPointBulkError) shopPointBulkError.textContent = error.message;
    }
  });
}

// 관리자: 주문 내역
const loadAdminOrders = async () => {
  if (!adminOrdersTable) return;
  try {
    const data = await fetchJson("/api/admin/orders");
    adminOrdersTable.innerHTML = "";
    (data.orders || []).forEach((o) => {
      const row = document.createElement("tr");
      const dateStr = o.ordered_at ? new Date(o.ordered_at).toLocaleString("ko-KR") : "-";
      row.innerHTML = `
        <td>${o.employee_id}</td>
        <td>${o.employee_name || "-"}</td>
        <td>${o.product_name || "-"}</td>
        <td>${formatPoints(o.point_cost)}</td>
        <td>${o.quantity || 1}</td>
        <td>${dateStr}</td>
      `;
      adminOrdersTable.appendChild(row);
    });
  } catch (error) {
    console.error("관리자 주문 목록 로드 실패", error);
  }
};

const shopPointCsvForm = document.getElementById("shop-point-csv-form");
const shopPointCsvStatus = document.getElementById("shop-point-csv-status");
const shopPointCsvError = document.getElementById("shop-point-csv-error");

if (shopPointCsvForm) {
  shopPointCsvForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (shopPointCsvError) shopPointCsvError.textContent = "";
    if (shopPointCsvStatus) shopPointCsvStatus.textContent = "";

    const fileInput = document.getElementById("pointCsvFile");
    const file = fileInput?.files?.[0];
    if (!file) {
      if (shopPointCsvError) shopPointCsvError.textContent = "CSV 파일을 선택해주세요.";
      return;
    }

    const formData = new FormData();
    formData.append("file", file, file.name);

    const submitButton = shopPointCsvForm.querySelector("button");
    const originalText = submitButton?.textContent;
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = "처리 중..."; }

    try {
      const response = await fetch("/api/admin/points/import-csv", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "실패");

      let msg = `완료: ${data.updatedCount}명 포인트 지급`;
      if (data.skippedCount > 0) msg += `, ${data.skippedCount}건 스킵(미매칭/오류)`;
      if (data.multiMatchCount > 0) msg += `, ${data.multiMatchCount}건 동명(전원 지급)`;
      if (data.debug) msg += ` [PG:${data.debug.pgCount} ORA:${data.debug.oracleCount} 합계:${data.debug.idMapSize}]`;
      if (shopPointCsvStatus) shopPointCsvStatus.textContent = msg;
      shopPointCsvForm.reset();
    } catch (error) {
      if (shopPointCsvError) shopPointCsvError.textContent = error.message;
    } finally {
      if (submitButton) { submitButton.disabled = false; submitButton.textContent = originalText; }
    }
  });
}

if (adminOrdersRefresh) {
  adminOrdersRefresh.addEventListener("click", () => loadAdminOrders());
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

