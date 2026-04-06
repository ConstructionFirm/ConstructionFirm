const SUPABASE_URL = "https://olylorarbaizpogbbjmb.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9seWxvcmFyYmFpenBvZ2Jiam1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODEzMjIsImV4cCI6MjA4OTA1NzMyMn0.ESovUr-sRcrrFyLRY9g6dFeW-opcJUf0qyw_CbKBDVA";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let editId = null,
    currentUserId = null,
    currentRole = null;
let allowedSiteIds = null; // null = no restriction (admin/accountant)

// ── SITE ACCESS FILTER ──
async function loadAllowedSites(user) {
    if (currentRole === "admin" || currentRole === "accountant") {
        allowedSiteIds = null;
        return;
    }
    const uid = user.id;
    const userName = (
        (user.user_metadata && user.user_metadata.fullname) ||
        (user.user_metadata && user.user_metadata.full_name) ||
        user.email.split("@")[0]
    )
        .toLowerCase()
        .trim();

    // Fetch ALL sites (bypass allowedSiteIds filter) to calculate access
    const { data: sites } = await sb
        .from("sites")
        .select("id, supervisor, supervisorid, engineerids");
    if (!sites || sites.length === 0) {
        allowedSiteIds = [];
        return;
    }

    if (currentRole === "supervisor") {
        allowedSiteIds = sites
            .filter((s) => {
                // Match by UUID (new sites)
                if (s.supervisorid && s.supervisorid === uid) return true;
                // Fallback: match by supervisor name text (old sites)
                if (
                    s.supervisor &&
                    s.supervisor.toLowerCase().trim() === userName
                )
                    return true;
                return false;
            })
            .map((s) => s.id);
    } else if (currentRole === "engineer") {
        allowedSiteIds = sites
            .filter((s) => {
                // Match by UUID array (new sites)
                if (Array.isArray(s.engineerids) && s.engineerids.includes(uid))
                    return true;
                return false;
            })
            .map((s) => s.id);
    } else {
        allowedSiteIds = null;
    }

    // If still no sites found, warn but don't lock out completely
    // (admin should assign sites to this user)
    if (allowedSiteIds !== null && allowedSiteIds.length === 0) {
        console.warn("No sites assigned to this user:", userName, uid);
    }
}
let labChart2, siteChart2, trendChart2;

// ── DATE HELPER (IST-safe, no UTC offset bug) ──
function getToday() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().split("T")[0];
}

// ── PERMISSIONS ──
const PERMISSIONS = {
    admin: {
        canAddSite: true,
        canEditSite: true,
        canDeleteSite: true,
        canAddWorker: true,
        canEditWorker: true,
        canDeleteWorker: true,
        canAddMaterial: true,
        canEditMaterial: true,
        canDeleteMaterial: true,
        canAddAttendance: true,
        canEditAttendance: true,
        canDeleteAttendance: true,
        canAddMatEntry: true,
        canEditMatEntry: true,
        canDeleteMatEntry: true,
        canAddCash: true,
        canEditCash: true,
        canDeleteCash: true,
    },
    supervisor: {
        canAddSite: false,
        canEditSite: false,
        canDeleteSite: false,
        canAddWorker: true,
        canEditWorker: true,
        canDeleteWorker: true,
        canAddMaterial: false,
        canEditMaterial: false,
        canDeleteMaterial: false,
        canAddAttendance: true,
        canEditAttendance: true,
        canDeleteAttendance: false,
        canAddMatEntry: true,
        canEditMatEntry: true,
        canDeleteMatEntry: false,
        canAddCash: false,
        canEditCash: false,
        canDeleteCash: false,
    },
    engineer: {
        canAddSite: false,
        canEditSite: false,
        canDeleteSite: false,
        canAddWorker: false,
        canEditWorker: false,
        canDeleteWorker: false,
        canAddMaterial: false,
        canEditMaterial: false,
        canDeleteMaterial: false,
        canAddAttendance: true,
        canEditAttendance: false,
        canDeleteAttendance: false,
        canAddMatEntry: true,
        canEditMatEntry: false,
        canDeleteMatEntry: false,
        canAddCash: false,
        canEditCash: false,
        canDeleteCash: false,
    },
    accountant: {
        canAddSite: false,
        canEditSite: false,
        canDeleteSite: false,
        canAddWorker: false,
        canEditWorker: false,
        canDeleteWorker: false,
        canAddMaterial: false,
        canEditMaterial: false,
        canDeleteMaterial: false,
        canAddAttendance: false,
        canEditAttendance: false,
        canDeleteAttendance: false,
        canAddMatEntry: false,
        canEditMatEntry: false,
        canDeleteMatEntry: false,
        canAddCash: true,
        canEditCash: true,
        canDeleteCash: false,
    },
};
function can(action) {
    const p = PERMISSIONS[currentRole];
    return p ? p[action] : true;
}
function guard(action, label) {
    if (!can(action)) {
        toast(label + " — Permission denied for your role", false);
        return false;
    }
    return true;
}

// ── PAST DATE GUARDS ──
function isToday(dateStr) {
    const today = getToday(); // ✅ correctly called with ()
    return dateStr >= today;
}
function guardPastDate(dateStr, action) {
    if (currentRole === "admin") return true;
    if (!isToday(dateStr)) {
        toast(
            "⛔ Cannot " + action + " past date records — contact Admin",
            false,
        );
        return false;
    }
    return true;
}

// ── AUTH ──
function switchAuthTab(tab) {
    const isLogin = tab === "login";
    document.getElementById("loginForm").style.display = isLogin
        ? "flex"
        : "none";
    document.getElementById("signupForm").style.display = isLogin
        ? "none"
        : "flex";
    document.getElementById("tabLogin").classList.toggle("active", isLogin);
    document
        .getElementById("tabSignup")
        .classList.toggle("active", !isLogin);
    document.getElementById("li_err").textContent = "";
}
async function doLogin() {
    const email = document.getElementById("li_email").value.trim();
    const pass = document.getElementById("li_pass").value;
    const btn = document.getElementById("loginBtn");
    const err = document.getElementById("li_err");
    if (!email || !pass) {
        err.className = "auth-err err";
        err.textContent = "Enter email and password";
        return;
    }
    btn.innerHTML = '<span class="loading"></span>Signing in...';
    btn.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({
        email,
        password: pass,
    });
    btn.innerHTML = "Sign In";
    btn.disabled = false;
    if (error) {
        err.className = "auth-err err";
        err.textContent = error.message;
        return;
    }
    currentUserId = data.user.id;
    showApp(data.user);
}
async function doSignup() {
    const name = document.getElementById("su_name").value.trim();
    const email = document.getElementById("su_email").value.trim();
    const pass = document.getElementById("su_pass").value;
    const role = document.getElementById("su_role").value;
    const btn = document.getElementById("signupBtn");
    const err = document.getElementById("li_err");
    if (!name || !email || !pass || !role) {
        err.className = "auth-err err";
        err.textContent = "All fields are required";
        return;
    }
    if (pass.length < 6) {
        err.className = "auth-err err";
        err.textContent = "Password must be at least 6 characters";
        return;
    }
    btn.innerHTML = '<span class="loading"></span>Creating...';
    btn.disabled = true;
    const { data, error } = await sb.auth.signUp({
        email,
        password: pass,
        options: { data: { full_name: name, role } },
    });
    btn.innerHTML = "Create Account";
    btn.disabled = false;
    if (error) {
        err.className = "auth-err err";
        err.textContent = error.message;
        return;
    }
    // Save profile so we can look up users by role later
    if (data.user) {
        await sb.from("profiles").upsert({
            id: data.user.id,
            full_name: name,
            role: role,
            email: email,
        });
    }
    err.className = "auth-err ok";
    err.textContent = "Account created! You can now login.";
    switchAuthTab("login");
    document.getElementById("li_email").value = email;
}
async function doLogout() {
    await sb.auth.signOut();
    currentUserId = null;
    currentRole = null;
    document.getElementById("appWrapper").style.display = "none";
    document.getElementById("loginScreen").style.display = "flex";
    document.getElementById("li_err").textContent = "";
    document.getElementById("li_email").value = "";
    document.getElementById("li_pass").value = "";
}
async function showApp(user) {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("appWrapper").style.display = "flex";
    currentRole =
        (user.user_metadata && user.user_metadata.role) || "supervisor";
    const name =
        (user.user_metadata && user.user_metadata.full_name) ||
        user.email.split("@")[0];
    document.getElementById("userEmail").textContent = name;
    document.getElementById("userRoleLbl").textContent = currentRole;
    document.getElementById("userAv").textContent = name[0].toUpperCase();
    applyRoleVisibility();
    await loadAllowedSites(user);
    // Auto-create profile entry if missing (handles pre-profiles-table users)
    sb.from("profiles")
        .upsert(
            {
                id: user.id,
                full_name: name,
                role: currentRole,
                email: user.email,
            },
            { onConflict: "id" },
        )
        .then(() => { });
    initDashboard();
}

// ── ROLE VISIBILITY ──
function applyRoleVisibility() {
    const r = currentRole;
    document.getElementById("navOverview").style.display = "flex";
    document.getElementById("navLabour").style.display =
        r === "accountant" ? "none" : "flex";
    document.getElementById("navMaterials").style.display =
        r === "accountant" ? "none" : "flex";
    document.getElementById("navCashbook").style.display =
        r === "engineer" ? "none" : "flex";
    document.getElementById("navMasters").style.display =
        r === "admin" || r === "supervisor" ? "flex" : "none";

    const btnMap = [
        ["btnAddSite", "canAddSite"],
        ["btnAddWorker", "canAddWorker"],
        ["btnAddMatMaster", "canAddMaterial"],
        ["btnAddAttend", "canAddAttendance"],
        ["btnAddMatEntry", "canAddMatEntry"],
        ["btnAddCash", "canAddCash"],
    ];
    btnMap.forEach(([id, perm]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = can(perm) ? "inline-block" : "none";
    });

    // Supervisor sees only Workers tab in Masters
    if (r === "supervisor") {
        const ts = document.getElementById("mtabSites");
        const tm = document.getElementById("mtabMaterials");
        if (ts) ts.style.display = "none";
        if (tm) tm.style.display = "none";
    }
}

// ── INIT ──
function initDashboard() {
    document.getElementById("todayDate").textContent =
        new Date().toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    const td = getToday();
    ["labDate", "me_date", "l_date", "c_date"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = td;
    });
    // Show warning if supervisor/engineer has no assigned sites
    const existing = document.getElementById("noSiteBanner");
    if (allowedSiteIds !== null && allowedSiteIds.length === 0) {
        if (!existing) {
            const banner = document.createElement("div");
            banner.id = "noSiteBanner";
            banner.style.cssText =
                "background:#fef3c7;color:#92400e;padding:10px 20px;" +
                "font-size:13px;font-weight:600;text-align:center;" +
                "border-bottom:2px solid #f59e0b;flex-shrink:0;";
            banner.textContent =
                "⚠️ You have not been assigned to any site yet. Ask your Admin to assign you via Masters → Sites → Edit.";
            const main = document.querySelector(".main");
            if (main) main.prepend(banner);
        }
    } else if (existing) {
        existing.remove();
    }
    populateAllDropdowns();
    renderAll();
}
function renderAll() {
    renderOverview();
    renderLabour();
    renderMaterials();
    renderCash();
    renderSites();
    renderWorkers();
    renderMatMaster();
}

// ── DB HELPERS ──
async function dbGet(table) {
    let query = sb
        .from(table)
        .select("*")
        .order("created_at", { ascending: false });
    // Apply site-level access filter for supervisor / engineer
    if (
        allowedSiteIds !== null &&
        ["attendance", "material_entries", "cashbook"].includes(table)
    ) {
        if (allowedSiteIds.length === 0) return [];
        query = query.in("site_id", allowedSiteIds);
    }
    if (allowedSiteIds !== null && table === "sites") {
        if (allowedSiteIds.length === 0) return [];
        query = query.in("id", allowedSiteIds);
    }
    if (allowedSiteIds !== null && table === "workers") {
        if (allowedSiteIds.length === 0) return [];
        query = query.in("site_id", allowedSiteIds);
    }
    const { data, error } = await query;
    if (error) {
        console.error(table, error.message);
        return [];
    }
    return data || [];
}
async function dbInsert(table, obj) {
    obj.user_id = currentUserId;
    const { data, error } = await sb
        .from(table)
        .insert(obj)
        .select()
        .single();
    if (error) throw error;
    return data;
}
async function dbUpdate(table, id, obj) {
    const { error } = await sb.from(table).update(obj).eq("id", id);
    if (error) throw error;
}
async function dbDelete(table, id) {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) throw error;
}

// ── DROPDOWNS ──
async function populateSiteUserDropdowns() {
    const { data: profiles, error } = await sb
        .from("profiles")
        .select("id, full_name, role")
        .in("role", ["supervisor", "engineer"]);
    const list = profiles || [];
    const supervisors = list.filter((p) => p.role === "supervisor");
    const engineers = list.filter((p) => p.role === "engineer");
    const supEl = document.getElementById("s_sup");
    if (supEl) {
        if (supervisors.length === 0) {
            supEl.innerHTML = `<option value="">-- No supervisors registered yet --</option>`;
        } else {
            supEl.innerHTML =
                `<option value="">-- Select Supervisor --</option>` +
                supervisors
                    .map((u) => `<option value="${u.id}">${u.full_name}</option>`)
                    .join("");
        }
    }
    const engEl = document.getElementById("s_engineers");
    if (engEl) {
        if (engineers.length === 0) {
            engEl.innerHTML = `<option value="" disabled>No engineers registered yet</option>`;
        } else {
            engEl.innerHTML = engineers
                .map((u) => `<option value="${u.id}">${u.full_name}</option>`)
                .join("");
        }
    }
}

async function populateAllDropdowns() {
    const sites = await dbGet("sites");
    const sOpts = sites
        .map((s) => `<option value="${s.id}">${s.name}</option>`)
        .join("");
    const all = `<option value="">All Sites</option>`;
    const sel = `<option value="">-- Select Site --</option>`;
    ["labSite", "matSite", "cashSite", "gSite", "wfSite"].forEach((id) => {
        const e = document.getElementById(id);
        if (e) e.innerHTML = all + sOpts;
    });
    ["l_site", "me_site", "c_site", "w_site"].forEach((id) => {
        const e = document.getElementById(id);
        if (e) e.innerHTML = sel + sOpts;
    });
    const mats = await dbGet("materials_master");
    const mn = document.getElementById("matName");
    if (mn)
        mn.innerHTML =
            `<option value="">All Materials</option>` +
            mats
                .map((m) => `<option value="${m.name}">${m.name}</option>`)
                .join("");
    const mm = document.getElementById("me_mat");
    if (mm)
        mm.innerHTML =
            `<option value="">-- Select --</option>` +
            mats
                .map(
                    (m) => `<option value="${m.id}">${m.name} (${m.unit})</option>`,
                )
                .join("");
}
async function populateWorkerDropdown() {
    const siteId = document.getElementById("l_site").value;
    const workers = await dbGet("workers");
    const filt = workers.filter(
        (w) => w.status === "Active" && (!siteId || w.site_id === siteId),
    );
    document.getElementById("l_worker").innerHTML =
        `<option value="">Select worker</option>` +
        filt
            .map(
                (w) =>
                    `<option value="${w.id}" data-wage="${w.daily_wage}" data-des="${w.designation}" data-gender="${w.gender}">${w.name}</option>`,
            )
            .join("");
}
function autoFillWorker() {
    const sel = document.getElementById("l_worker");
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) {
        document.getElementById("l_des").value = "";
        setAttendanceGender("");
        document.getElementById("l_wage").value = 0;
        calcPay();
        return;
    }
    document.getElementById("l_des").value =
        opt.getAttribute("data-des") || "";
    setAttendanceGender(opt.getAttribute("data-gender") || "");
    document.getElementById("l_wage").value =
        opt.getAttribute("data-wage") || 0;
    calcPay();
}
async function autoFillMat() {
    const id = document.getElementById("me_mat").value;
    const mats = await dbGet("materials_master");
    const m = mats.find((x) => x.id === id);
    if (m) {
        document.getElementById("me_unit").value = m.unit;
        document.getElementById("me_rate").value = m.default_rate || 0;
        calcMatAmt();
    }
}
function setAttendanceGender(value = "") {
    document.getElementById("l_gender").value = value;
    document
        .querySelectorAll("#genderBtns .attendance-pill-btn")
        .forEach((btn) => {
            btn.classList.toggle(
                "gender-active",
                btn.dataset.value === value && !!value,
            );
        });
}
function setAttendanceStatus(value = "Present") {
    const input = document.getElementById("l_status");
    if (input) input.value = value;
    document
        .querySelectorAll("#statusBtns .attendance-pill-btn")
        .forEach((btn) => {
            btn.classList.remove(
                "active",
                "halfday-active",
                "absent-active",
                "leave-active",
            );
            if (btn.dataset.value === value) {
                if (value === "Present") btn.classList.add("active");
                else if (value === "Half Day")
                    btn.classList.add("halfday-active");
                else if (value === "Absent") btn.classList.add("absent-active");
                else if (value === "Leave") btn.classList.add("leave-active");
            }
        });
    calcPay();
}
function calcPay() {
    const wage = parseFloat(document.getElementById("l_wage").value) || 0;
    const st = document.getElementById("l_status").value || "Present";
    const hrs = parseFloat(document.getElementById("l_hours").value) || 0;
    let pay = 0;
    if (st === "Present") pay = wage;
    else if (st === "Half Day") pay = wage / 2;
    else if (st === "Absent" || st === "Leave") pay = 0;
    if (hrs > 0 && st === "Present") pay = (wage / 8) * hrs;
    document.getElementById("l_pay").value = Math.round(pay * 100) / 100;
    const preview = document.getElementById("attendancePayPreview");
    if (preview) preview.textContent = fmtF(pay);
}
function calcMatAmt() {
    const q = parseFloat(document.getElementById("me_qty").value) || 0;
    const r = parseFloat(document.getElementById("me_rate").value) || 0;
    document.getElementById("me_amt").value = (q * r).toFixed(2);
}

// ── MODAL HELPERS ──
function openModal(id) {
    document.getElementById(id).classList.add("open");
}
function closeModal(id) {
    document.getElementById(id).classList.remove("open");
    editId = null;
}
function toast(msg, ok = true) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.style.borderLeftColor = ok ? "var(--success)" : "var(--danger)";
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2800);
}
function fmt(n) {
    return "₹" + (n || 0).toLocaleString("en-IN");
}
function fmtF(n) {
    return "₹" + parseFloat(n || 0).toLocaleString("en-IN");
}
function strCol(name) {
    const colors = [
        "#f97316",
        "#3b82f6",
        "#22c55e",
        "#8b5cf6",
        "#ef4444",
        "#f59e0b",
        "#06b6d4",
        "#ec4899",
    ];
    let hash = 0;
    for (let c of name || "") hash = c.charCodeAt(0) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

// ── ATTENDANCE MODAL ──
function openAttendanceModal() {
    editId = null;
    const today = getToday(); // ✅ properly store result
    const dateInput = document.getElementById("l_date");
    dateInput.value = today;

    if (currentRole !== "admin") {
        dateInput.min = today;
        dateInput.max = today;
        dateInput.readOnly = true;
        dateInput.style.background = "#f1f5f9";
        dateInput.style.cursor = "not-allowed";
    } else {
        dateInput.min = "";
        dateInput.max = "";
        dateInput.readOnly = false;
        dateInput.style.background = "";
        dateInput.style.cursor = "";
    }
    document.getElementById("l_site").value = "";
    document.getElementById("l_worker").innerHTML =
        '<option value="">Select worker</option>';
    document.getElementById("l_des").value = "";
    document.getElementById("l_des").value = "";
    setAttendanceGender("");
    document.getElementById("l_wage").value = 0;
    document.getElementById("l_hours").value = 8;
    document.getElementById("l_pay").value = 0;
    document.getElementById("l_remarks").value = "";
    document.getElementById("labModalTitle").textContent = "Add Attendance";
    populateAllDropdowns();
    setAttendanceStatus("Present");
    calcPay();
    openModal("labModal");
}

// ════════════ SITES ════════════
async function saveSite() {
    if (editId && !guard("canEditSite", "Admin only")) return;
    if (!editId && !guard("canAddSite", "Admin only")) return;
    const name = document.getElementById("s_name").value.trim();
    if (!name) {
        toast("Site name is required", false);
        return;
    }
    const supEl = document.getElementById("s_sup");
    const engEl = document.getElementById("s_engineers");
    // Sanitize: ensure empty string becomes null for UUID fields
    const supervisorId =
        supEl.value && supEl.value.trim() !== "" ? supEl.value.trim() : null;
    const supervisorName =
        supervisorId && supEl.selectedIndex >= 0
            ? (supEl.options[supEl.selectedIndex]?.text || "")
                .replace("-- Select Supervisor --", "")
                .trim()
            : "";
    // Filter out empty strings from engineer IDs
    const engineerIds = engEl
        ? Array.from(engEl.selectedOptions)
            .map((o) => o.value)
            .filter((v) => v && v.trim() !== "")
        : [];
    const obj = {
        name,
        city: document.getElementById("s_city").value,
        addr: document.getElementById("s_addr").value,
        start_date: document.getElementById("s_date").value || null,
        status: document.getElementById("s_status").value,
        supervisor: supervisorName,
        supervisorid: supervisorId,
        engineerids: engineerIds,
        phone: document.getElementById("s_phone").value,
    };
    try {
        if (editId) await dbUpdate("sites", editId, obj);
        else await dbInsert("sites", obj);
        closeModal("siteModal");
        populateAllDropdowns();
        renderSites();
        renderOverview();
        toast(editId ? "Site updated!" : "Site added!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editSite(id) {
    if (!guard("canEditSite", "Admin only")) return;
    editId = id;
    const sites = await dbGet("sites");
    const s = sites.find((x) => x.id === id);
    if (!s) return;
    document.getElementById("siteModalTitle").textContent = "Edit Site";
    document.getElementById("s_name").value = s.name;
    document.getElementById("s_city").value = s.city || "";
    document.getElementById("s_addr").value = s.addr || "";
    document.getElementById("s_date").value = s.start_date || "";
    document.getElementById("s_status").value = s.status || "Active";
    document.getElementById("s_phone").value = s.phone || "";
    // Load user dropdowns first, then pre-select saved values
    await populateSiteUserDropdowns();
    const supEl = document.getElementById("s_sup");
    if (supEl && s.supervisorid) {
        supEl.value = s.supervisorid;
        // fallback: if uuid not found in dropdown, try matching by name
        if (!supEl.value && s.supervisor) {
            Array.from(supEl.options).forEach((opt) => {
                if (
                    opt.text.trim().toLowerCase() ===
                    s.supervisor.trim().toLowerCase()
                )
                    opt.selected = true;
            });
        }
    }
    const engEl = document.getElementById("s_engineers");
    if (engEl && s.engineerids && Array.isArray(s.engineerids)) {
        Array.from(engEl.options).forEach((opt) => {
            opt.selected = s.engineerids.includes(opt.value);
        });
    }
    openModal("siteModal");
}
async function deleteSite(id) {
    if (!guard("canDeleteSite", "Admin only")) return;
    if (
        !confirm(
            "Delete this site?\nAll linked workers, attendance, material entries and cashbook records will be unlinked.",
        )
    )
        return;
    try {
        // Unlink all FK-referencing tables before deleting site
        const tables = [
            "workers",
            "attendance",
            "material_entries",
            "cashbook",
        ];
        for (const tbl of tables) {
            const { error } = await sb
                .from(tbl)
                .update({ site_id: null })
                .eq("site_id", id);
            if (error) throw error;
        }
        // Now safe to delete site
        await dbDelete("sites", id);
        populateAllDropdowns();
        renderSites();
        renderOverview();
        toast("Site deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ WORKERS ════════════
async function saveWorker() {
    if (editId && !guard("canEditWorker", "Cannot edit worker")) return;
    if (!editId && !guard("canAddWorker", "Cannot add worker")) return;
    const name = document.getElementById("w_name").value.trim();
    if (!name) {
        toast("Worker name required", false);
        return;
    }
    const obj = {
        name,
        phone: document.getElementById("w_phone").value,
        gender: document.getElementById("w_gender").value,
        designation: document.getElementById("w_des").value,
        daily_wage: parseFloat(document.getElementById("w_wage").value) || 0,
        site_id: document.getElementById("w_site").value || null,
        status: document.getElementById("w_status").value,
    };
    try {
        if (editId) await dbUpdate("workers", editId, obj);
        else await dbInsert("workers", obj);
        closeModal("workerModal");
        renderWorkers();
        toast(editId ? "Worker updated!" : "Worker added!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editWorker(id) {
    if (!guard("canEditWorker", "Cannot edit worker")) return;
    const workers = await dbGet("workers");
    const w = workers.find((x) => x.id === id);
    if (!w) return;
    if (currentRole !== "admin") {
        const today = getToday(); // ✅ correctly stored
        const addedDate = w.created_at ? w.created_at.split("T")[0] : "";
        if (addedDate !== today) {
            toast(
                "⛔ Can only edit workers added today — contact Admin",
                false,
            );
            return;
        }
    }
    editId = id;
    await populateAllDropdowns();
    document.getElementById("workerModalTitle").textContent = "Edit Worker";
    document.getElementById("w_name").value = w.name;
    document.getElementById("w_phone").value = w.phone || "";
    document.getElementById("w_gender").value = w.gender || "Male";
    document.getElementById("w_des").value = w.designation || "Labour";
    document.getElementById("w_wage").value = w.daily_wage || 0;
    document.getElementById("w_site").value = w.site_id || "";
    document.getElementById("w_status").value = w.status || "Active";
    openModal("workerModal");
}
async function deleteWorker(id) {
    if (!guard("canDeleteWorker", "Cannot delete worker")) return;
    const workers = await dbGet("workers");
    const w = workers.find((x) => x.id === id);
    if (!w) return;
    if (currentRole !== "admin") {
        const today = getToday(); // ✅ correctly stored
        const addedDate = w.created_at ? w.created_at.split("T")[0] : "";
        if (addedDate !== today) {
            toast(
                "⛔ Can only delete workers added today — contact Admin",
                false,
            );
            return;
        }
    }
    if (!confirm("Delete worker?")) return;
    try {
        await dbDelete("workers", id);
        renderWorkers();
        toast("Worker deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ MATERIAL MASTER ════════════
async function saveMatMaster() {
    if (editId && !guard("canEditMaterial", "Admin only")) return;
    if (!editId && !guard("canAddMaterial", "Admin only")) return;
    const name = document.getElementById("mm_name").value.trim();
    if (!name) {
        toast("Material name required", false);
        return;
    }
    const obj = {
        name,
        category: document.getElementById("mm_cat").value,
        unit: document.getElementById("mm_unit").value,
        default_rate:
            parseFloat(document.getElementById("mm_rate").value) || 0,
        status: document.getElementById("mm_status").value,
    };
    try {
        if (editId) await dbUpdate("materials_master", editId, obj);
        else await dbInsert("materials_master", obj);
        closeModal("matMasterModal");
        populateAllDropdowns();
        renderMatMaster();
        toast(editId ? "Updated!" : "Material added!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editMatMaster(id) {
    if (!guard("canEditMaterial", "Admin only")) return;
    editId = id;
    const mats = await dbGet("materials_master");
    const m = mats.find((x) => x.id === id);
    if (!m) return;
    document.getElementById("matMasterModalTitle").textContent =
        "Edit Material";
    document.getElementById("mm_name").value = m.name;
    document.getElementById("mm_cat").value = m.category || "Cement";
    document.getElementById("mm_unit").value = m.unit || "";
    document.getElementById("mm_rate").value = m.default_rate || 0;
    document.getElementById("mm_status").value = m.status || "Active";
    openModal("matMasterModal");
}
async function deleteMatMaster(id) {
    if (!guard("canDeleteMaterial", "Admin only")) return;
    if (!confirm("Delete material?")) return;
    try {
        await dbDelete("materials_master", id);
        populateAllDropdowns();
        renderMatMaster();
        toast("Deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ ATTENDANCE ════════════
async function saveAttendance() {
    if (editId && !guard("canEditAttendance", "Cannot edit attendance"))
        return;
    if (!editId && !guard("canAddAttendance", "Cannot add attendance"))
        return;
    const date = document.getElementById("l_date").value;
    const siteId = document.getElementById("l_site").value;
    const workerId = document.getElementById("l_worker").value;
    if (!date || !siteId || !workerId) {
        toast("Date, site and worker required", false);
        return;
    }
    if (!guardPastDate(date, "add attendance for")) return; // ✅ blocks past dates for non-admin
    const sites = await dbGet("sites");
    const s = sites.find((x) => x.id === siteId);
    const sel = document.getElementById("l_worker");
    const opt = sel.options[sel.selectedIndex];
    const obj = {
        date,
        site_id: siteId,
        site_name: s ? s.name : "",
        worker_id: workerId,
        worker_name: opt ? opt.text : "",
        designation: document.getElementById("l_des").value,
        gender: document.getElementById("l_gender").value,
        wage: parseFloat(document.getElementById("l_wage").value) || 0,
        status: document.getElementById("l_status").value,
        hours: document.getElementById("l_hours").value || null,
        pay: parseFloat(document.getElementById("l_pay").value) || 0,
        remarks: document.getElementById("l_remarks").value,
    };
    try {
        if (editId) await dbUpdate("attendance", editId, obj);
        else await dbInsert("attendance", obj);
        closeModal("labModal");
        renderLabour();
        renderOverview();
        toast(editId ? "Updated!" : "Attendance saved!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editAttendance(id) {
    if (!guard("canEditAttendance", "Cannot edit attendance")) return;
    const entries = await dbGet("attendance");
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    if (!guardPastDate(e.date, "edit")) return;
    editId = id;
    await populateAllDropdowns();
    document.getElementById("labModalTitle").textContent =
        "Edit Attendance";
    document.getElementById("l_date").value = e.date;
    document.getElementById("l_site").value = e.site_id;
    await populateWorkerDropdown();
    document.getElementById("l_worker").value = e.worker_id;
    document.getElementById("l_des").value = e.designation || "";
    setAttendanceGender(e.gender || "");
    document.getElementById("l_wage").value = e.wage || 0;
    document.getElementById("l_hours").value = e.hours || "";
    document.getElementById("l_pay").value = e.pay || 0;
    document.getElementById("l_remarks").value = e.remarks || "";
    setAttendanceStatus(e.status || "Present");
    calcPay();

    // Lock date for non-admin
    const dateInput = document.getElementById("l_date");
    if (currentRole !== "admin") {
        const today = getToday();
        dateInput.min = today;
        dateInput.max = today;
        dateInput.readOnly = true;
        dateInput.style.background = "#f1f5f9";
        dateInput.style.cursor = "not-allowed";
    } else {
        dateInput.min = "";
        dateInput.max = "";
        dateInput.readOnly = false;
        dateInput.style.background = "";
        dateInput.style.cursor = "";
    }
    openModal("labModal");
}
async function deleteAttendance(id) {
    if (!guard("canDeleteAttendance", "Only Admin can delete attendance"))
        return;
    if (!confirm("Delete entry?")) return;
    try {
        await dbDelete("attendance", id);
        renderLabour();
        renderOverview();
        toast("Deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ MATERIAL ENTRIES ════════════
async function saveMatEntry() {
    if (editId && !guard("canEditMatEntry", "Cannot edit material entries"))
        return;
    if (!editId && !guard("canAddMatEntry", "Cannot add material entries"))
        return;
    const date = document.getElementById("me_date").value;
    const siteId = document.getElementById("me_site").value;
    const matId = document.getElementById("me_mat").value;
    if (!date || !siteId || !matId) {
        toast("Date, site and material required", false);
        return;
    }
    if (!guardPastDate(date, "add material entry for")) return;
    const sites = await dbGet("sites");
    const s = sites.find((x) => x.id === siteId);
    const mats = await dbGet("materials_master");
    const m = mats.find((x) => x.id === matId);
    const obj = {
        date,
        site_id: siteId,
        site_name: s ? s.name : "",
        material_id: matId,
        material_name: m ? m.name : "",
        type: document.getElementById("me_type").value,
        qty: parseFloat(document.getElementById("me_qty").value) || 0,
        unit: document.getElementById("me_unit").value,
        rate: parseFloat(document.getElementById("me_rate").value) || 0,
        amount: parseFloat(document.getElementById("me_amt").value) || 0,
        party: document.getElementById("me_party").value,
    };
    try {
        if (editId) await dbUpdate("material_entries", editId, obj);
        else await dbInsert("material_entries", obj);
        closeModal("matModal");
        renderMaterials();
        renderOverview();
        toast(editId ? "Updated!" : "Entry saved!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editMatEntry(id) {
    if (!guard("canEditMatEntry", "Cannot edit material entries")) return;
    const entries = await dbGet("material_entries");
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    if (!guardPastDate(e.date, "edit")) return;
    editId = id;
    await populateAllDropdowns();
    document.getElementById("matModalTitle").textContent =
        "Edit Material Entry";
    document.getElementById("me_date").value = e.date;
    document.getElementById("me_site").value = e.site_id;
    document.getElementById("me_type").value = e.type;
    document.getElementById("me_mat").value = e.material_id;
    document.getElementById("me_qty").value = e.qty;
    document.getElementById("me_unit").value = e.unit;
    document.getElementById("me_rate").value = e.rate;
    document.getElementById("me_amt").value = e.amount;
    document.getElementById("me_party").value = e.party || "";
    openModal("matModal");
}
async function deleteMatEntry(id) {
    if (
        !guard("canDeleteMatEntry", "Only Admin can delete material entries")
    )
        return;
    if (!confirm("Delete entry?")) return;
    try {
        await dbDelete("material_entries", id);
        renderMaterials();
        renderOverview();
        toast("Deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ CASHBOOK ════════════
async function saveCash() {
    if (editId && !guard("canEditCash", "Cannot edit cash entries")) return;
    if (!editId && !guard("canAddCash", "Cannot add cash entries")) return;
    const date = document.getElementById("c_date").value;
    const siteId = document.getElementById("c_site").value;
    const amt = parseFloat(document.getElementById("c_amt").value) || 0;
    if (!date || !siteId || !amt) {
        toast("Date, site and amount required", false);
        return;
    }
    const sites = await dbGet("sites");
    const s = sites.find((x) => x.id === siteId);
    const obj = {
        date,
        site_id: siteId,
        site_name: s ? s.name : "",
        type: document.getElementById("c_type").value,
        head: document.getElementById("c_head").value,
        amount: amt,
        mode: document.getElementById("c_mode").value,
        party: document.getElementById("c_party").value,
        notes: document.getElementById("c_notes").value,
    };
    try {
        if (editId) await dbUpdate("cashbook", editId, obj);
        else await dbInsert("cashbook", obj);
        closeModal("cashModal");
        renderCash();
        renderOverview();
        toast(editId ? "Updated!" : "Cash entry saved!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}
async function editCash(id) {
    if (!guard("canEditCash", "Cannot edit cash entries")) return;
    editId = id;
    const entries = await dbGet("cashbook");
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    await populateAllDropdowns();
    document.getElementById("cashModalTitle").textContent =
        "Edit Cash Entry";
    document.getElementById("c_date").value = e.date;
    document.getElementById("c_site").value = e.site_id;
    document.getElementById("c_type").value = e.type;
    document.getElementById("c_head").value = e.head;
    document.getElementById("c_amt").value = e.amount;
    document.getElementById("c_mode").value = e.mode || "Cash";
    document.getElementById("c_party").value = e.party || "";
    document.getElementById("c_notes").value = e.notes || "";
    openModal("cashModal");
}
async function deleteCash(id) {
    if (!guard("canDeleteCash", "Only Admin can delete cash entries"))
        return;
    if (!confirm("Delete entry?")) return;
    try {
        await dbDelete("cashbook", id);
        renderCash();
        renderOverview();
        toast("Deleted!");
    } catch (e) {
        toast("Error: " + e.message, false);
    }
}

// ════════════ RENDER OVERVIEW ════════════
async function renderOverview() {
    const gSite = document.getElementById("gSite").value;
    const gSiteName = gSite
        ? (
            document.getElementById("gSite")?.options[
                document.getElementById("gSite")?.selectedIndex
            ]?.text || ""
        ).trim()
        : "";

    const [sites, attend, mats, cash] = await Promise.all([
        dbGet("sites"),
        dbGet("attendance"),
        dbGet("material_entries"),
        dbGet("cashbook"),
    ]);
    const today = getToday();

    // Helper: does a record belong to selected site?
    function matchSite(rec) {
        if (!gSite) return true;
        return (
            rec.site_id === gSite ||
            (rec.site_name && rec.site_name.trim() === gSiteName)
        );
    }

    // Filter all data by selected site upfront
    const filtSites = gSite
        ? sites.filter((s) => s.id === gSite || s.name === gSiteName)
        : sites;
    const filtAttend = attend.filter(matchSite);
    const filtMats = mats.filter(matchSite);
    const filtCash = cash.filter(matchSite);

    // ── KPIs ──
    document.getElementById("ov-sites").textContent = filtSites.filter(
        (s) => s.status === "Active",
    ).length;

    const todayLab = filtAttend.filter((a) => a.date === today);
    document.getElementById("ov-labour").textContent = fmt(
        todayLab.reduce((s, a) => s + (a.pay || 0), 0),
    );
    document.getElementById("ov-present").textContent =
        todayLab.filter((a) => a.status === "Present").length +
        " present today";

    document.getElementById("ov-mat").textContent = fmt(
        filtMats
            .filter((m) => m.type === "In")
            .reduce((s, m) => s + (m.amount || 0), 0),
    );

    const sent = filtCash
        .filter((c) => c.type === "Money Sent")
        .reduce((s, c) => s + (c.amount || 0), 0);
    const exp = filtCash
        .filter((c) => c.type === "Expense")
        .reduce((s, c) => s + (c.amount || 0), 0);
    const bal = sent - exp;
    const bEl = document.getElementById("ov-cash");
    bEl.textContent = fmt(Math.abs(bal));
    bEl.style.color = bal >= 0 ? "var(--success)" : "var(--danger)";

    // ── Site Summary Table (filtered) ──
    const sc = {
        Active: "bg-green",
        "On Hold": "bg-orange",
        Completed: "bg-gray",
    };
    // ── Site Summary Cards ──
    document.getElementById("ovTable").innerHTML =
        filtSites.length === 0
            ? '<div style="text-align:center;color:var(--muted);padding:24px 0">No sites yet.</div>'
            : filtSites
                .map((s) => {
                    const sL = attend
                        .filter((a) => a.site_id === s.id || a.site_name === s.name)
                        .reduce((t, a) => t + (a.pay || 0), 0);
                    const sM = mats
                        .filter(
                            (m) =>
                                (m.site_id === s.id || m.site_name === s.name) &&
                                m.type === "In",
                        )
                        .reduce((t, m) => t + (m.amount || 0), 0);
                    const sSent = cash
                        .filter(
                            (c) =>
                                (c.site_id === s.id || c.site_name === s.name) &&
                                c.type === "Money Sent",
                        )
                        .reduce((t, c) => t + (c.amount || 0), 0);
                    const sExp = cash
                        .filter(
                            (c) =>
                                (c.site_id === s.id || c.site_name === s.name) &&
                                c.type === "Expense",
                        )
                        .reduce((t, c) => t + (c.amount || 0), 0);
                    const sBal = sSent - sExp;
                    const balCls = sBal >= 0 ? "sc-val-pos" : "sc-val-neg";
                    const stBadge = sc[s.status] || "bg-gray";
                    return `<div class="site-card">
                <div class="site-card-head">
                  <div class="site-card-name">${s.name}</div>
                  <span class="badge ${stBadge}">${s.status}</span>
                </div>
                <div class="site-card-sup">${s.supervisor || "SUPER"}</div>
                <div class="site-card-grid">
                  <div class="sc-stat"><div class="sc-lbl">Labour</div><div class="sc-val">${fmt(sL)}</div></div>
                  <div class="sc-stat"><div class="sc-lbl">Material</div><div class="sc-val">${fmt(sM)}</div></div>
                  <div class="sc-stat"><div class="sc-lbl">Balance</div><div class="sc-val ${balCls}">${fmt(sBal)}</div></div>
                </div>
                <div class="site-card-row2">
                  <div class="sc-stat"><div class="sc-lbl">Cash Sent</div><div class="sc-val">${fmt(sSent)}</div></div>
                  <div class="sc-stat"><div class="sc-lbl">Expenses</div><div class="sc-val sc-val-neg">${fmt(sExp)}</div></div>
                </div>
              </div>`;
                })
                .join("");

    // ── Trend Chart — last 7 days (filtered) ──
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(new Date().getTime() - i * 86400000);
        days.push(d.toISOString().split("T")[0]);
    }
    const dData = days.map((d) =>
        filtAttend
            .filter((a) => a.date === d)
            .reduce((s, a) => s + (a.pay || 0), 0),
    );
    if (trendChart2) trendChart2.destroy();
    trendChart2 = new Chart(
        document.getElementById("trendChart").getContext("2d"),
        {
            type: "line",
            data: {
                labels: days.map((d) => d.slice(5)),
                datasets: [
                    {
                        label: "Labour Cost",
                        data: dData,
                        borderColor: "#f97316",
                        backgroundColor: "rgba(249,115,22,.1)",
                        fill: true,
                        tension: 0.4,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } },
            },
        },
    );

    // ── Site Bar Chart (filtered sites) ──
    const siteCosts = filtSites.map((s) => ({
        name: s.name,
        cost: attend
            .filter((a) => a.site_id === s.id || a.site_name === s.name)
            .reduce((t, a) => t + (a.pay || 0), 0),
    }));
    if (siteChart2) siteChart2.destroy();
    siteChart2 = new Chart(
        document.getElementById("siteChart").getContext("2d"),
        {
            type: "bar",
            data: {
                labels: siteCosts.map((s) => s.name),
                datasets: [
                    {
                        label: "Labour Cost",
                        data: siteCosts.map((s) => s.cost),
                        backgroundColor: "#f97316",
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } },
            },
        },
    );
}

// ════════════ RENDER LABOUR ════════════
async function renderLabour() {
    const date = document.getElementById("labDate").value,
        site = document.getElementById("labSite").value;
    const des = document.getElementById("labDes").value,
        search = document.getElementById("labSearch").value.toLowerCase();
    let E = await dbGet("attendance");
    if (date) E = E.filter((e) => e.date === date);
    if (site) {
        const _sName = (
            document.getElementById("labSite")?.options[
                document.getElementById("labSite")?.selectedIndex
            ]?.text || ""
        ).trim();
        E = E.filter(
            (e) =>
                e.site_id === site ||
                (e.site_name && e.site_name.trim() === _sName),
        );
    }
    if (des)
        E = E.filter(
            (e) => (e.designation || "").toLowerCase() === des.toLowerCase(),
        );
    if (search)
        E = E.filter((e) =>
            (e.worker_name || "").toLowerCase().includes(search),
        );
    E.sort((a, b) => b.date.localeCompare(a.date));
    const total = E.reduce((s, e) => s + (e.pay || 0), 0);
    const p = E.filter((e) => e.status === "Present").length;
    document.getElementById("labTotalPay").textContent = fmtF(total);
    document.getElementById("labP").textContent = p;
    document.getElementById("labH").textContent = E.filter(
        (e) => e.status === "Half Day",
    ).length;
    document.getElementById("labA").textContent = E.filter(
        (e) => e.status === "Absent",
    ).length;
    document.getElementById("labL").textContent = E.filter(
        (e) => e.status === "Leave",
    ).length;
    document.getElementById("labPresCount").textContent = p + " Present";
    const dB = {
        Mason: "bg-blue",
        Labour: "bg-gray",
        Helper: "bg-orange",
        Carpenter: "bg-purple",
        Barbender: "bg-green",
    };
    const sB = {
        Present: "bg-green",
        "Half Day": "bg-orange",
        Absent: "bg-red",
        Leave: "bg-gray",
    };
    const canEdit = can("canEditAttendance"),
        canDel = can("canDeleteAttendance");
    document.getElementById("labTable").innerHTML =
        E.map(
            (e) => `<tr>
    <td><div class="wc"><div class="wav" style="background:${strCol(e.worker_name)}">${(e.worker_name || "?")[0].toUpperCase()}</div><strong>${e.worker_name || ""}</strong></div></td>
    <td><span class="badge ${dB[e.designation] || "bg-gray"}">${e.designation || ""}</span></td>
    <td>${e.gender || ""}</td><td>${e.site_name || ""}</td><td>${e.date || ""}</td>
    <td><span class="badge ${sB[e.status] || "bg-gray"}">${e.status || ""}</span></td>
    <td>${e.hours || "–"}</td><td>${fmtF(e.wage)}</td><td><strong style="color:var(--primary)">${fmtF(e.pay)}</strong></td><td>${e.remarks || "–"}</td>
    <td style="white-space:nowrap">${canEdit ? `<button class="btn-sm-edit" onclick="editAttendance('${e.id}')">✏️</button>` : ""}${canDel ? `<button class="btn-sm-danger" onclick="deleteAttendance('${e.id}')">🗑</button>` : ""}</td>
  </tr>`,
        ).join("") ||
        '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:20px">No records. Click "+ Add Attendance".</td></tr>';

    // Doughnut chart
    const sites = await dbGet("sites"),
        allA = await dbGet("attendance");
    if (labChart2) labChart2.destroy();
    labChart2 = new Chart(
        document.getElementById("labChart").getContext("2d"),
        {
            type: "doughnut",
            data: {
                labels: sites.map((s) => s.name),
                datasets: [
                    {
                        data: sites.map((s) =>
                            allA
                                .filter((a) => a.site_id === s.id)
                                .reduce((t, a) => t + (a.pay || 0), 0),
                        ),
                        backgroundColor: [
                            "#f97316",
                            "#3b82f6",
                            "#22c55e",
                            "#8b5cf6",
                            "#f59e0b",
                        ],
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } },
            },
        },
    );
}

// ════════════ RENDER MATERIALS ════════════
async function renderMaterials() {
    const site = document.getElementById("matSite").value,
        name = document.getElementById("matName").value;
    const type = document.getElementById("matType").value,
        date = document.getElementById("matDate").value;
    const search = document.getElementById("matSearch").value.toLowerCase();
    let E = await dbGet("material_entries");
    if (site) {
        const _sName = (
            document.getElementById("matSite")?.options[
                document.getElementById("matSite")?.selectedIndex
            ]?.text || ""
        ).trim();
        E = E.filter(
            (e) =>
                e.site_id === site ||
                (e.site_name && e.site_name.trim() === _sName),
        );
    }
    if (name)
        E = E.filter(
            (e) => (e.material_name || "").toLowerCase() === name.toLowerCase(),
        );
    if (type) E = E.filter((e) => e.type === type);
    if (date) E = E.filter((e) => e.date === date);
    if (search)
        E = E.filter(
            (e) =>
                (e.material_name || "").toLowerCase().includes(search) ||
                (e.party || "").toLowerCase().includes(search),
        );
    const inVal = E.filter((e) => e.type === "In").reduce(
        (s, e) => s + (e.amount || 0),
        0,
    );
    const outVal = E.filter((e) => e.type === "Out").reduce(
        (s, e) => s + (e.amount || 0),
        0,
    );
    document.getElementById("matInVal").textContent = fmtF(inVal);
    document.getElementById("matOutVal").textContent = fmtF(outVal);
    document.getElementById("matInCnt").textContent = E.filter(
        (e) => e.type === "In",
    ).length;
    document.getElementById("matOutCnt").textContent = E.filter(
        (e) => e.type === "Out",
    ).length;
    const canEdit = can("canEditMatEntry"),
        canDel = can("canDeleteMatEntry");
    document.getElementById("matTable").innerHTML =
        E.map(
            (e) => `<tr>
    <td>${e.date || ""}</td><td>${e.site_name || ""}</td>
    <td><span class="badge ${e.type === "In" ? "bg-green" : "bg-orange"}">${e.type}</span></td>
    <td><strong>${e.material_name || ""}</strong></td><td>${e.qty || 0}</td><td>${e.unit || ""}</td>
    <td>${fmtF(e.rate)}</td><td><strong>${fmtF(e.amount)}</strong></td><td>${e.party || ""}</td>
    <td style="white-space:nowrap">${canEdit ? `<button class="btn-sm-edit" onclick="editMatEntry('${e.id}')">✏️</button>` : ""}${canDel ? `<button class="btn-sm-danger" onclick="deleteMatEntry('${e.id}')">🗑</button>` : ""}</td>
  </tr>`,
        ).join("") ||
        '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:20px">No entries.</td></tr>';

    // Stock summary — filtered by selected site
    let allE = await dbGet("material_entries");
    if (site) {
        const _sn = (
            document.getElementById("matSite")?.options[
                document.getElementById("matSite")?.selectedIndex
            ]?.text || ""
        ).trim();
        allE = allE.filter(
            (e) =>
                e.site_id === site || (e.site_name && e.site_name.trim() === _sn),
        );
    }
    const mMast = await dbGet("materials_master");
    document.getElementById("stockList").innerHTML =
        mMast
            .map((m) => {
                const inQ = allE
                    .filter((e) => e.material_id === m.id && e.type === "In")
                    .reduce((s, e) => s + (e.qty || 0), 0);
                const outQ = allE
                    .filter((e) => e.material_id === m.id && e.type === "Out")
                    .reduce((s, e) => s + (e.qty || 0), 0);
                const net = inQ - outQ;
                const pct = inQ > 0 ? Math.round((net / inQ) * 100) : 0;
                return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span><strong>${m.name}</strong></span><span>${net} ${m.unit}</span></div><div style="background:#f1f5f9;border-radius:4px;height:6px"><div style="background:var(--primary);width:${pct}%;height:100%;border-radius:4px"></div></div></div>`;
            })
            .join("") ||
        '<p style="color:var(--muted);font-size:13px;text-align:center;padding:12px">No materials.</p>';
}

// ════════════ RENDER CASHBOOK ════════════
async function renderCash() {
    const site = document.getElementById("cashSite").value,
        type = document.getElementById("cashType").value;
    const head = document.getElementById("cashHead").value,
        from = document.getElementById("cashFrom").value;
    const to = document.getElementById("cashTo").value,
        search = document.getElementById("cashSearch").value.toLowerCase();
    let E = await dbGet("cashbook");
    if (site) {
        const _sName = (
            document.getElementById("cashSite")?.options[
                document.getElementById("cashSite")?.selectedIndex
            ]?.text || ""
        ).trim();
        E = E.filter(
            (e) =>
                e.site_id === site ||
                (e.site_name && e.site_name.trim() === _sName),
        );
    }
    if (type) E = E.filter((e) => e.type === type);
    if (head) E = E.filter((e) => e.head === head);
    if (from) E = E.filter((e) => e.date >= from);
    if (to) E = E.filter((e) => e.date <= to);
    if (search)
        E = E.filter(
            (e) =>
                (e.site_name || "").toLowerCase().includes(search) ||
                (e.party || "").toLowerCase().includes(search),
        );
    E.sort((a, b) => b.date.localeCompare(a.date));
    const sent = E.filter((e) => e.type === "Money Sent").reduce(
        (s, e) => s + (e.amount || 0),
        0,
    );
    const exp = E.filter((e) => e.type === "Expense").reduce(
        (s, e) => s + (e.amount || 0),
        0,
    );
    document.getElementById("cashSent").textContent = fmtF(sent);
    document.getElementById("cashExp").textContent = fmtF(exp);
    document.getElementById("cashBal").textContent = fmtF(sent - exp);
    document.getElementById("cashLabPaid").textContent = fmtF(
        E.filter((e) => e.head === "Labour Payment").reduce(
            (s, e) => s + (e.amount || 0),
            0,
        ),
    );
    document.getElementById("cashMatBought").textContent = fmtF(
        E.filter((e) => e.head === "Material Purchase").reduce(
            (s, e) => s + (e.amount || 0),
            0,
        ),
    );
    const canEdit = can("canEditCash"),
        canDel = can("canDeleteCash");
    document.getElementById("cashTable").innerHTML =
        E.map(
            (e) => `<tr>
    <td>${e.date || ""}</td><td>${e.site_name || ""}</td>
    <td><span class="badge ${e.type === "Money Sent" ? "bg-green" : "bg-red"}">${e.type === "Money Sent" ? "Sent" : "Exp"}</span></td>
    <td>${e.head || ""}</td>
    <td><strong style="color:${e.type === "Money Sent" ? "var(--success)" : "var(--danger)"}">${e.type === "Money Sent" ? "+" : "-"}${fmtF(e.amount)}</strong></td>
    <td><span class="badge bg-blue">${e.mode || ""}</span></td><td>${e.party || ""}</td><td>${e.notes || ""}</td>
    <td style="white-space:nowrap">${canEdit ? `<button class="btn-sm-edit" onclick="editCash('${e.id}')">✏️</button>` : ""}${canDel ? `<button class="btn-sm-danger" onclick="deleteCash('${e.id}')">🗑</button>` : ""}</td>
  </tr>`,
        ).join("") ||
        '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px">No entries. Click "+ Add Entry".</td></tr>';

    // Site balance
    const sites = await dbGet("sites"),
        allC = await dbGet("cashbook");
    document.getElementById("cashSiteTable").innerHTML =
        sites
            .map((s) => {
                const sS = allC
                    .filter((c) => c.site_id === s.id && c.type === "Money Sent")
                    .reduce((t, c) => t + (c.amount || 0), 0);
                const sE = allC
                    .filter((c) => c.site_id === s.id && c.type === "Expense")
                    .reduce((t, c) => t + (c.amount || 0), 0);
                const sB = sS - sE;
                return `<tr><td><strong>${s.name}</strong></td><td style="color:var(--success)">${fmtF(sS)}</td><td style="color:var(--danger)">${fmtF(sE)}</td><td style="color:${sB >= 0 ? "var(--success)" : "var(--danger)"}">${fmtF(sB)}</td></tr>`;
            })
            .join("") ||
        '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">No sites.</td></tr>';
}

// ════════════ RENDER MASTERS ════════════
async function renderSites(q = "") {
    let S = await dbGet("sites");
    if (q)
        S = S.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
    const sc = {
        Active: "bg-green",
        Completed: "bg-gray",
        "On Hold": "bg-orange",
    };
    const canEdit = can("canEditSite"),
        canDel = can("canDeleteSite");
    document.getElementById("sitesTable").innerHTML =
        S.map(
            (s, i) => `<tr>
    <td>${String(i + 1).padStart(3, "0")}</td><td><strong>${s.name}</strong></td><td>${s.addr || ""}</td>
    <td>${s.start_date || ""}</td><td>${s.supervisor || "–"}</td>
    <td style="font-size:11px;color:var(--muted)">${Array.isArray(s.engineerids) && s.engineerids.length > 0 ? s.engineerids.length + " assigned" : "–"}</td>
    <td>${s.phone || ""}</td>
    <td><span class="badge ${sc[s.status] || "bg-gray"}">${s.status}</span></td>
    <td style="white-space:nowrap">${canEdit ? `<button class="btn-sm-edit" onclick="editSite('${s.id}')">Edit</button>` : ""}${canDel ? `<button class="btn-sm-danger" onclick="deleteSite('${s.id}')">Delete</button>` : ""}</td>
  </tr>`,
        ).join("") ||
        '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">No sites. Click "Add Site".</td></tr>';
}
async function renderWorkers(q = "") {
    let W = await dbGet("workers");
    const fSite = document.getElementById("wfSite")?.value || "";
    const fDes = document.getElementById("wfDes")?.value || "";
    if (q)
        W = W.filter((w) => w.name.toLowerCase().includes(q.toLowerCase()));
    if (fSite) W = W.filter((w) => w.site_id === fSite);
    if (fDes) W = W.filter((w) => w.designation === fDes);
    const canEdit = can("canEditWorker"),
        canDel = can("canDeleteWorker");
    const sites = await dbGet("sites");
    document.getElementById("workersTable").innerHTML =
        W.map((w) => {
            const sName = sites.find((s) => s.id === w.site_id)?.name || "–";
            return `<tr>
      <td><div class="wc"><div class="wav" style="background:${strCol(w.name)}">${w.name[0].toUpperCase()}</div><strong>${w.name}</strong></div></td>
      <td>${w.designation || ""}</td><td>${w.gender || ""}</td><td>${sName}</td>
      <td>${fmtF(w.daily_wage)}</td><td>${w.phone || ""}</td>
      <td><span class="badge ${w.status === "Active" ? "bg-green" : "bg-red"}">${w.status}</span></td>
      <td style="white-space:nowrap">${canEdit ? `<button class="btn-sm-edit" onclick="editWorker('${w.id}')">Edit</button>` : ""}${canDel ? `<button class="btn-sm-danger" onclick="deleteWorker('${w.id}')">Delete</button>` : ""}</td>
    </tr>`;
        }).join("") ||
        '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">No workers. Click "Add Worker".</td></tr>';
}
async function renderMatMaster(q = "") {
    let M = await dbGet("materials_master");
    if (q)
        M = M.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
    const cB = {
        Cement: "bg-gray",
        Sand: "bg-orange",
        Aggregate: "bg-gray",
        Steel: "bg-blue",
        Bricks: "bg-red",
    };
    const canEdit = can("canEditMaterial"),
        canDel = can("canDeleteMaterial");
    document.getElementById("matMasterTable").innerHTML =
        M.map(
            (m, i) => `<tr>
    <td>${String(i + 1).padStart(3, "0")}</td><td><strong>${m.name}</strong></td>
    <td><span class="badge ${cB[m.category] || "bg-gray"}">${m.category || ""}</span></td>
    <td>${m.unit || ""}</td><td>${fmtF(m.default_rate || 0)} / ${m.unit || "unit"}</td>
    <td><span class="badge ${m.status === "Active" ? "bg-green" : "bg-red"}">${m.status}</span></td>
    <td style="white-space:nowrap">${canEdit ? `<button class="btn-sm-edit" onclick="editMatMaster('${m.id}')">Edit</button>` : ""}${canDel ? `<button class="btn-sm-danger" onclick="deleteMatMaster('${m.id}')">Delete</button>` : ""}</td>
  </tr>`,
        ).join("") ||
        '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">No materials.</td></tr>';
}

// ── NAVIGATION ──
// ── GLOBAL SITE SYNC ──
function syncGlobalSite() {
    const val = document.getElementById("gSite").value;
    // Push to all page-level site dropdowns
    ["labSite", "matSite", "cashSite", "wfSite"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    });
    renderOverview();
    renderLabour();
    renderMaterials();
    renderCash();
    renderWorkers();
}

function showPage(id, el) {
    if (window.innerWidth <= 900) closeSidebar();
    document
        .querySelectorAll(".page")
        .forEach((p) => p.classList.remove("active"));
    document
        .querySelectorAll(".nav-item")
        .forEach((n) => n.classList.remove("active"));
    document.getElementById("page-" + id).classList.add("active");
    if (el) el.classList.add("active");
    const titles = {
        overview: "Overview",
        labour: "Labour",
        materials: "Materials",
        cashbook: "Cashbook",
        masters: "Masters",
    };
    document.getElementById("pgT").textContent = titles[id];
    document.getElementById("pgB").textContent =
        "Dashboard › " + titles[id];
    document.getElementById("sidebar").classList.remove("open");
    // sync bottom nav
    document
        .querySelectorAll(".bnav-item")
        .forEach((b) => b.classList.remove("active"));
    const bnEl = document.getElementById("bn-" + id);
    if (bnEl) bnEl.classList.add("active");
    populateAllDropdowns();
    if (id === "overview") renderOverview();
    else if (id === "labour") renderLabour();
    else if (id === "materials") renderMaterials();
    else if (id === "cashbook") renderCash();
    else if (id === "masters") {
        renderSites();
        renderWorkers();
        renderMatMaster();
    }
    // resize charts after page switch
    setTimeout(() => {
        if (trendChart2) trendChart2.resize();
        if (siteChart2) siteChart2.resize();
        if (labChart2) labChart2.resize();
    }, 50);
}
// Bottom nav handler (no sidebar nav-item to highlight)
function showPageBnav(id) {
    const navMap = {
        overview: "navOverview",
        labour: "navLabour",
        materials: "navMaterials",
        cashbook: "navCashbook",
    };
    const navEl = navMap[id] ? document.getElementById(navMap[id]) : null;
    showPage(id, navEl);
}
// Password eye toggle
function togglePw(inputId, btn) {
    const el = document.getElementById(inputId);
    el.type = el.type === "password" ? "text" : "password";
    btn.textContent = el.type === "password" ? "👁" : "🙈";
}
function showMaster(id, el) {
    ["sites", "workers", "materials"].forEach((m) => {
        document.getElementById("ms-" + m).style.display =
            m === id ? "block" : "none";
    });
    document
        .querySelectorAll(".mtab")
        .forEach((t) => t.classList.remove("active"));
    el.classList.add("active");
}

// ── EXPORT ──
async function exportData() {
    const [sites, workers, matMaster, attend, mats, cash] =
        await Promise.all([
            dbGet("sites"),
            dbGet("workers"),
            dbGet("materials_master"),
            dbGet("attendance"),
            dbGet("material_entries"),
            dbGet("cashbook"),
        ]);
    const blob = new Blob(
        [
            JSON.stringify(
                {
                    sites,
                    workers,
                    materials_master: matMaster,
                    attendance: attend,
                    material_entries: mats,
                    cashbook: cash,
                },
                null,
                2,
            ),
        ],
        { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "RamaConstruction-" + getToday() + ".json";
    a.click();
    toast("Data exported!");
}

// ── SIDEBAR TOGGLE (mobile) ──
function toggleSidebar() {
    const sb = document.getElementById("sidebar");
    const ov = document.getElementById("sidebarOverlay");
    const isOpen = sb.classList.toggle("open");
    if (ov) ov.classList.toggle("show", isOpen);
}
function closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    const ov = document.getElementById("sidebarOverlay");
    if (ov) ov.classList.remove("show");
}

// ── BOOT ──
window.onload = async function () {
    const { data } = await sb.auth.getSession();
    if (data.session) {
        currentUserId = data.session.user.id;
        showApp(data.session.user);
    } else {
        document.getElementById("loginScreen").style.display = "flex";
        document.getElementById("appWrapper").style.display = "none";
    }
};

// === MOBILE UI REFRESH PATCH ===
(function () {
    const isPhoneView = () => window.innerWidth <= 600;
    const esc = (v) =>
        String(v ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    const selectedText = (id) => {
        const el = document.getElementById(id);
        return (el?.options?.[el.selectedIndex]?.text || "").trim();
    };
    const fmtDate = (v) => v || "";
    const padCode = (n) => `# ${String(n).padStart(3, "0")}`;
    const ensureMobileBox = (parent, id, beforeEl) => {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement("div");
            el.id = id;
            el.className = "mobile-alt-view";
            if (beforeEl) parent.insertBefore(el, beforeEl);
            else parent.appendChild(el);
        }
        return el;
    };
    const initials = (name) => {
        const parts = String(name || "?")
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        return (parts[0]?.[0] || "?").toUpperCase();
    };
    const statusBadgeClass = (status) =>
        ({
            Present: "bg-green",
            "Half Day": "bg-orange",
            Absent: "bg-red",
            Leave: "bg-gray",
            Active: "bg-green",
            Inactive: "bg-gray",
            Completed: "bg-blue",
            "On Hold": "bg-orange",
        })[status] || "bg-gray";
    const siteMatch = (entry, siteId, selectId) => {
        if (!siteId) return true;
        const sName = selectedText(selectId);
        return (
            entry.site_id === siteId ||
            (entry.site_name && entry.site_name.trim() === sName) ||
            (entry.sitename && entry.sitename.trim() === sName)
        );
    };
    const actionBtns = (editJs, deleteJs, canEdit, canDel) => {
        const out = [];
        if (canEdit)
            out.push(
                `<button class="mobile-action-btn edit" onclick="${editJs}">✏ Edit</button>`,
            );
        if (canDel)
            out.push(
                `<button class="mobile-action-btn delete" onclick="${deleteJs}">🗑 Delete</button>`,
            );
        return out.length
            ? `<div class="mobile-actions">${out.join("")}</div>`
            : "";
    };

    async function renderLabourMobileUI() {
        const page = document.getElementById("page-labour");
        if (!page) return;
        const anchor = page.querySelector(".fbar");
        const beforeEl = page.querySelector(".g3");
        const box = ensureMobileBox(page, "labourMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const date = document.getElementById("labDate")?.value || "";
        const site = document.getElementById("labSite")?.value || "";
        const des = document.getElementById("labDes")?.value || "";
        const search = (
            document.getElementById("labSearch")?.value || ""
        ).toLowerCase();
        let E = await dbGet("attendance");
        if (date) E = E.filter((e) => e.date === date);
        if (site) E = E.filter((e) => siteMatch(e, site, "labSite"));
        if (des)
            E = E.filter(
                (e) => (e.designation || "").toLowerCase() === des.toLowerCase(),
            );
        if (search)
            E = E.filter((e) =>
                (e.worker_name || "").toLowerCase().includes(search),
            );
        E.sort((a, b) =>
            String(b.date || "").localeCompare(String(a.date || "")),
        );
        const total = E.reduce((s, e) => s + (+e.pay || 0), 0);
        const present = E.filter((e) => e.status === "Present").length;
        const halfDay = E.filter((e) => e.status === "Half Day").length;
        const absent = E.filter((e) => e.status === "Absent").length;
        const leave = E.filter((e) => e.status === "Leave").length;
        const canEditAttendance = can("canEditAttendance");
        const canDeleteAttendance = can("canDeleteAttendance");
        box.innerHTML = `
            <div class="mobile-summary-card">
              <div class="mobile-summary-title">Total Pay (Filtered)</div>
              <div class="mobile-summary-value">${fmtF(total)}</div>
              <div class="mobile-summary-grid">
                <div class="mobile-summary-row"><span>Present</span><strong style="color:#22c55e">${present}</strong></div>
                <div class="mobile-summary-row"><span>Half Day</span><strong style="color:#facc15">${halfDay}</strong></div>
                <div class="mobile-summary-row"><span>Absent</span><strong style="color:#f43f5e">${absent}</strong></div>
                <div class="mobile-summary-row"><span>Leave</span><strong>${leave}</strong></div>
              </div>
            </div>
            <div class="mobile-white-card">
              <div class="mobile-section-head">
                <div class="mobile-section-title">👷 Daily Attendance</div>
                <div class="mobile-count-pill">${present} Present</div>
              </div>
              <div class="mobile-list">
                ${E.length
                ? E.map(
                    (e) => `
                  <div class="mobile-entry">
                    <div class="mobile-entry-top">
                      <div>
                        <div class="mobile-entry-name">${esc(e.worker_name || "")}</div>
                        <div class="mobile-entry-sub">${esc(e.designation || "")}</div>
                      </div>
                      <span class="badge ${statusBadgeClass(e.status)}">${esc(e.status || "")}</span>
                    </div>
                    <div class="mobile-meta-grid">
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Gender</div><div class="mobile-meta-value">${esc(e.gender || "–")}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Site</div><div class="mobile-meta-value">${esc(e.site_name || "–")}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Hrs</div><div class="mobile-meta-value">${esc(e.hours ?? "–")}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Pay</div><div class="mobile-meta-value" style="color:#16a34a">${fmtF(e.pay)}</div></div>
                    </div>
                    ${e.remarks ? `<div class="mobile-remarks">Remarks: ${esc(e.remarks)}</div>` : ""}
                    ${actionBtns(`editAttendance('${e.id}')`, `deleteAttendance('${e.id}')`, canEditAttendance, canDeleteAttendance)}
                  </div>`,
                ).join("")
                : `<div class="mobile-empty">No records. Click &quot;+ Add Attendance&quot;.</div>`
            }
              </div>
            </div>`;
    }

    async function renderMaterialsMobileUI() {
        const page = document.getElementById("page-materials");
        if (!page) return;
        const beforeEl = page.querySelector(".g3");
        const box = ensureMobileBox(page, "materialsMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const site = document.getElementById("matSite")?.value || "";
        const name = document.getElementById("matName")?.value || "";
        const type = document.getElementById("matType")?.value || "";
        const date = document.getElementById("matDate")?.value || "";
        const search = (
            document.getElementById("matSearch")?.value || ""
        ).toLowerCase();
        let E = await dbGet("material_entries");
        if (site) E = E.filter((e) => siteMatch(e, site, "matSite"));
        if (name)
            E = E.filter(
                (e) =>
                    (e.material_name || "").toLowerCase() === name.toLowerCase(),
            );
        if (type) E = E.filter((e) => e.type === type);
        if (date) E = E.filter((e) => e.date === date);
        if (search)
            E = E.filter(
                (e) =>
                    (e.material_name || "").toLowerCase().includes(search) ||
                    (e.party || "").toLowerCase().includes(search),
            );
        E.sort((a, b) =>
            String(b.date || "").localeCompare(String(a.date || "")),
        );
        const inVal = E.filter((e) => e.type === "In").reduce(
            (s, e) => s + (+e.amount || 0),
            0,
        );
        const outVal = E.filter((e) => e.type === "Out").reduce(
            (s, e) => s + (+e.amount || 0),
            0,
        );
        const inCnt = E.filter((e) => e.type === "In").length;
        const outCnt = E.filter((e) => e.type === "Out").length;
        let allE = await dbGet("material_entries");
        if (site) allE = allE.filter((e) => siteMatch(e, site, "matSite"));
        const mMast = await dbGet("materials_master");
        const canEditMat = can("canEditMatEntry");
        const canDeleteMat = can("canDeleteMatEntry");
        const stockHtml =
            mMast
                .map((m) => {
                    const inQ = allE
                        .filter((e) => e.material_id === m.id && e.type === "In")
                        .reduce((s, e) => s + (+e.qty || 0), 0);
                    const outQ = allE
                        .filter((e) => e.material_id === m.id && e.type === "Out")
                        .reduce((s, e) => s + (+e.qty || 0), 0);
                    const net = inQ - outQ;
                    if (!inQ && !outQ) return "";
                    const pct =
                        inQ > 0
                            ? Math.max(
                                8,
                                Math.min(100, Math.round((Math.abs(net) / inQ) * 100)),
                            )
                            : 8;
                    const negative = net < 0;
                    return `
              <div class="mobile-stock-row">
                <div class="mobile-stock-line"><strong>${esc(m.name || "")}</strong><span class="mobile-stock-qty ${negative ? "negative" : ""}">${net} ${esc(m.unit || "")}</span></div>
                <div class="mobile-stock-bar"><div class="mobile-stock-fill ${negative ? "negative" : ""}" style="width:${pct}%"></div></div>
              </div>`;
                })
                .join("") || '<div class="mobile-empty">No materials.</div>';
        box.innerHTML = `
            <div class="mobile-summary-card">
              <div class="mobile-summary-title">IN Value</div>
              <div class="mobile-summary-value">${fmtF(inVal)}</div>
              <div class="mobile-summary-row"><span>OUT Value</span><strong style="color:#f87171">${fmtF(outVal)}</strong></div>
              <div class="mobile-summary-row"><span>IN Entries</span><strong style="color:#22c55e">${inCnt}</strong></div>
              <div class="mobile-summary-row"><span>OUT Entries</span><strong style="color:#f59e0b">${outCnt}</strong></div>
            </div>
            <div class="mobile-white-card">
              <div class="mobile-section-title">📦 Stock</div>
              <div style="margin-top:12px">${stockHtml}</div>
            </div>
            <div class="mobile-white-card">
              <div class="mobile-section-title">🧱 Material Ledger</div>
              <div class="mobile-list" style="margin-top:12px">
                ${E.length
                ? E.map(
                    (e) => `
                  <div class="mobile-entry">
                    <div class="mobile-entry-top">
                      <div>
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px"><span class="badge ${e.type === "In" ? "bg-green" : "bg-orange"}">${esc(e.type || "")}</span><div class="mobile-entry-name">${esc(e.material_name || "")}</div></div>
                        <div class="mobile-entry-sub">${esc(e.site_name || "")}</div>
                      </div>
                      <div class="mobile-amount ${e.type === "In" ? "pos" : "neg"}">${e.type === "In" ? "+" : "-"}${fmtF(e.amount)}</div>
                    </div>
                    <div class="mobile-meta-grid">
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Date</div><div class="mobile-meta-value">${fmtDate(e.date)}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Qty</div><div class="mobile-meta-value">${esc(e.qty || 0)} ${esc(e.unit || "")}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Rate</div><div class="mobile-meta-value">${fmtF(e.rate)}</div></div>
                      <div class="mobile-meta-item"><div class="mobile-meta-label">Party</div><div class="mobile-meta-value">${esc(e.party || "–")}</div></div>
                    </div>
                    ${actionBtns(`editMatEntry('${e.id}')`, `deleteMatEntry('${e.id}')`, canEditMat, canDeleteMat)}
                  </div>`,
                ).join("")
                : '<div class="mobile-empty">No entries.</div>'
            }
              </div>
            </div>`;
    }

    async function renderCashMobileUI() {
        const page = document.getElementById("page-cashbook");
        if (!page) return;
        const beforeEl = page.querySelector(".g5");
        const box = ensureMobileBox(page, "cashbookMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const site = document.getElementById("cashSite")?.value || "";
        const type = document.getElementById("cashType")?.value || "";
        const head = document.getElementById("cashHead")?.value || "";
        const from = document.getElementById("cashFrom")?.value || "";
        const to = document.getElementById("cashTo")?.value || "";
        const search = (
            document.getElementById("cashSearch")?.value || ""
        ).toLowerCase();
        let E = await dbGet("cashbook");
        if (site) E = E.filter((e) => siteMatch(e, site, "cashSite"));
        if (type) E = E.filter((e) => e.type === type);
        if (head) E = E.filter((e) => e.head === head);
        if (from) E = E.filter((e) => String(e.date || "") >= from);
        if (to) E = E.filter((e) => String(e.date || "") <= to);
        if (search)
            E = E.filter((e) =>
                [e.head, e.party, e.notes, e.site_name, e.mode].some((v) =>
                    (v || "").toLowerCase().includes(search),
                ),
            );
        E.sort((a, b) =>
            String(b.date || "").localeCompare(String(a.date || "")),
        );
        const totalSent = E.filter((e) => e.type === "Money Sent").reduce(
            (s, e) => s + (+e.amount || 0),
            0,
        );
        const totalExp = E.filter((e) => e.type === "Expense").reduce(
            (s, e) => s + (+e.amount || 0),
            0,
        );
        const balance = totalSent - totalExp;
        const labourPaid = E.filter(
            (e) => e.head === "Labour Payment",
        ).reduce((s, e) => s + (+e.amount || 0), 0);
        const materialPurchased = E.filter(
            (e) => e.head === "Material Purchase",
        ).reduce((s, e) => s + (+e.amount || 0), 0);
        const canEditCash = can("canEditCash");
        const canDeleteCash = can("canDeleteCash");
        const grouped = {};
        E.forEach((e) => {
            const k = e.site_name || "Unknown Site";
            grouped[k] ||= { sent: 0, exp: 0 };
            if (e.type === "Money Sent") grouped[k].sent += +e.amount || 0;
            else grouped[k].exp += +e.amount || 0;
        });

        const cashCard = (value, label, color, icon) => `
            <div class="mobile-mini-stat cash-card">
              <div class="cash-card-icon" style="color:${color}">${icon}</div>
              <div class="mobile-mini-value" style="color:${color}">${fmtF(value)}</div>
              <div class="mobile-mini-label">${label}</div>
            </div>`;

        box.innerHTML = `
            <div class="mobile-split-grid">
              ${cashCard(totalSent, "Total Sent", "#22c55e", "↗")}
              ${cashCard(totalExp, "Total Expenses", "#ef4444", "↘")}
              ${cashCard(balance, "Balance", "#3b82f6", "₹")}
              ${cashCard(labourPaid, "Labour Paid", "#eab308", "◌")}
            </div>
            <div class="mobile-mini-stat cash-card" style="margin-bottom:14px">
              <div class="cash-card-icon" style="color:#f59e0b">📦</div>
              <div class="mobile-mini-value" style="color:#f97316">${fmtF(materialPurchased)}</div>
              <div class="mobile-mini-label">Material Purchased</div>
            </div>
            <div class="mobile-cash-ledger-card">
              <div class="mobile-section-title">💰 Transactions</div>
              <div class="mobile-list" style="margin-top:12px">
                ${E.length
                ? E.map(
                    (e) => `
                  <div class="mobile-entry">
                    <div class="mobile-entry-top">
                      <div>
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px"><span class="badge ${e.type === "Money Sent" ? "bg-green" : "bg-red"}">${e.type === "Money Sent" ? "Sent" : "Exp"}</span><div class="mobile-entry-name">${esc(e.head || "")}</div></div>
                        <div class="mobile-txn-meta">${fmtDate(e.date)} &nbsp;•&nbsp; ${esc(e.site_name || "")} &nbsp;•&nbsp; ${esc(e.mode || "")}${e.party ? ` &nbsp;•&nbsp; ${esc(e.party)}` : ""}${e.notes ? ` &nbsp;•&nbsp; ${esc(e.notes)}` : ""}</div>
                      </div>
                      <div class="mobile-amount ${e.type === "Money Sent" ? "pos" : "neg"}">${e.type === "Money Sent" ? "+" : ""}${fmtF(e.amount)}</div>
                    </div>
                    ${actionBtns(`editCash('${e.id}')`, `deleteCash('${e.id}')`, canEditCash, canDeleteCash)}
                  </div>`,
                ).join("")
                : '<div class="mobile-empty">No entries. Click &quot;+ Add Entry&quot;.</div>'
            }
              </div>
            </div>
            <div class="mobile-cash-ledger-card">
              <div class="mobile-section-title">🏗 Site Balance</div>
              <div style="margin-top:12px;overflow:auto">
                <table class="mobile-cash-balance-table">
                  <thead>
                    <tr><th>Site</th><th>Sent</th><th>Expenses</th><th>Balance</th></tr>
                  </thead>
                  <tbody>
                    ${Object.keys(grouped).length
                ? Object.entries(grouped)
                    .map(
                        ([name, v]) => `
                      <tr>
                        <td>${esc(name)}</td>
                        <td style="color:#f59e0b">${fmtF(v.sent)}</td>
                        <td style="color:#ef4444">${fmtF(v.exp)}</td>
                        <td style="color:${v.sent - v.exp >= 0 ? "#22c55e" : "#ef4444"}">${fmtF(v.sent - v.exp)}</td>
                      </tr>`,
                    )
                    .join("")
                : '<tr><td colspan="4" class="mobile-empty">No site balance data.</td></tr>'
            }
                  </tbody>
                </table>
              </div>
            </div>`;
    }

    async function renderSitesMobileUI() {
        const wrap = document.getElementById("ms-sites");
        if (!wrap) return;
        const beforeEl = wrap.querySelector(".card");
        const box = ensureMobileBox(wrap, "sitesMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const search = (
            wrap.querySelector(".fbar input")?.value || ""
        ).toLowerCase();
        let rows = await dbGet("sites");
        if (search)
            rows = rows.filter((s) =>
                [s.name, s.city, s.address, s.supervisor_name, s.phone].some(
                    (v) => (v || "").toLowerCase().includes(search),
                ),
            );
        const canEditSite = can("canEditSite");
        const canDeleteSite = can("canDeleteSite");
        box.innerHTML = rows.length
            ? rows
                .map((s, i) => {
                    const eng = Array.isArray(s.engineers)
                        ? s.engineers.length
                        : String(s.engineers || "").trim()
                            ? String(s.engineers).split(",").filter(Boolean).length
                            : 0;
                    const sup = s.supervisor_name || s.supervisor || "–";
                    const location = s.city || s.address || "–";
                    return `
              <div class="mobile-master-card">
                <div class="mobile-master-head">
                  <div class="mobile-master-left">
                    <div class="mobile-master-avatar">🏗</div>
                    <div>
                      <div class="mobile-master-code">${padCode(i + 1)}</div>
                      <div class="mobile-master-name">${esc(s.name || "")}</div>
                      <div class="mobile-master-sub">${esc(location)}</div>
                    </div>
                  </div>
                  <span class="badge ${statusBadgeClass(s.status || "Active")}">${esc(s.status || "Active")}</span>
                </div>
                <div class="mobile-master-meta-grid">
                  <div class="mobile-master-meta-box"><div class="mobile-meta-label">Start Date</div><div class="mobile-meta-value">${fmtDate(s.start_date || s.date || "–")}</div></div>
                  <div class="mobile-master-meta-box"><div class="mobile-meta-label">Supervisor</div><div class="mobile-meta-value">${esc(sup)}</div></div>
                  <div class="mobile-master-meta-box"><div class="mobile-meta-label">Engineers</div><div class="mobile-meta-value">${eng} assigned</div></div>
                  <div class="mobile-master-meta-box"><div class="mobile-meta-label">Phone</div><div class="mobile-meta-value">${esc(s.phone || "–")}</div></div>
                </div>
                ${actionBtns(`editSite('${s.id}')`, `deleteSite('${s.id}')`, canEditSite, canDeleteSite)}
              </div>`;
                })
                .join("")
            : '<div class="mobile-empty">No sites found.</div>';
    }

    async function renderWorkersMobileUI() {
        const wrap = document.getElementById("ms-workers");
        if (!wrap) return;
        const beforeEl = wrap.querySelector(".card");
        const box = ensureMobileBox(wrap, "workersMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const search = (
            wrap.querySelector(".fbar input")?.value || ""
        ).toLowerCase();
        const site = document.getElementById("wfSite")?.value || "";
        const des = document.getElementById("wfDes")?.value || "";
        let rows = await dbGet("workers");
        if (site) rows = rows.filter((w) => siteMatch(w, site, "wfSite"));
        if (des)
            rows = rows.filter(
                (w) => (w.designation || "").toLowerCase() === des.toLowerCase(),
            );
        if (search)
            rows = rows.filter((w) =>
                [w.name, w.worker_name, w.phone, w.site_name].some((v) =>
                    (v || "").toLowerCase().includes(search),
                ),
            );
        const canEditWorker = can("canEditWorker");
        const canDeleteWorker = can("canDeleteWorker");
        box.innerHTML = rows.length
            ? rows
                .map((w) => {
                    const name = w.name || w.worker_name || "";
                    return `
              <div class="mobile-master-card">
                <div class="mobile-master-head">
                  <div class="mobile-master-left">
                    <div class="mobile-master-avatar">${initials(name)}</div>
                    <div>
                      <div class="mobile-master-name">${esc(name)}</div>
                      <div class="mobile-master-sub">${esc(w.designation || "")} • ${esc(w.gender || "")}</div>
                    </div>
                  </div>
                  <span class="badge ${statusBadgeClass(w.status || "Active")}">${esc(w.status || "Active")}</span>
                </div>
                <div class="mobile-info-grid">
                  <div class="mobile-info-box"><div class="mobile-meta-label">Site</div><div class="mobile-meta-value">${esc(w.site_name || "–")}</div></div>
                  <div class="mobile-info-box"><div class="mobile-meta-label">Wage/Day</div><div class="mobile-meta-value">${fmtF(w.wage || w.daily_wage || 0)}</div></div>
                  <div class="mobile-info-box"><div class="mobile-meta-label">Phone</div><div class="mobile-meta-value">${esc(w.phone || "–")}</div></div>
                </div>
                ${actionBtns(`editWorker('${w.id}')`, `deleteWorker('${w.id}')`, canEditWorker, canDeleteWorker)}
              </div>`;
                })
                .join("")
            : '<div class="mobile-empty">No workers found.</div>';
    }

    async function renderMatMasterMobileUI() {
        const wrap = document.getElementById("ms-materials");
        if (!wrap) return;
        const beforeEl = wrap.querySelector(".card");
        const box = ensureMobileBox(wrap, "matMasterMobileView", beforeEl);
        if (!isPhoneView()) {
            box.innerHTML = "";
            return;
        }
        const search = (
            wrap.querySelector(".fbar input")?.value || ""
        ).toLowerCase();
        let rows = await dbGet("materials_master");
        if (search)
            rows = rows.filter((m) =>
                [m.name, m.category, m.unit].some((v) =>
                    (v || "").toLowerCase().includes(search),
                ),
            );
        const canEditMaterial = can("canEditMaterial");
        const canDeleteMaterial = can("canDeleteMaterial");
        box.innerHTML = rows.length
            ? rows
                .map(
                    (m, i) => `
            <div class="mobile-master-card">
              <div class="mobile-master-head">
                <div class="mobile-master-left">
                  <div class="mobile-master-avatar">📦</div>
                  <div>
                    <div class="mobile-master-code">${padCode(i + 1)}</div>
                    <div class="mobile-master-name">${esc(m.name || "")}</div>
                    <div class="mobile-master-sub">${esc(m.category || "")}</div>
                  </div>
                </div>
                <span class="badge ${statusBadgeClass(m.status || "Active")}">${esc(m.status || "Active")}</span>
              </div>
              <div class="mobile-info-grid">
                <div class="mobile-info-box"><div class="mobile-meta-label">Unit</div><div class="mobile-meta-value">${esc(m.unit || "–")}</div></div>
                <div class="mobile-info-box"><div class="mobile-meta-label">Default Rate</div><div class="mobile-meta-value">${fmtF(m.default_rate || m.rate || 0)}</div></div>
              </div>
              ${actionBtns(`editMatMaster('${m.id}')`, `deleteMatMaster('${m.id}')`, canEditMaterial, canDeleteMaterial)}
            </div>`,
                )
                .join("")
            : '<div class="mobile-empty">No materials found.</div>';
    }

    const mobileHooksApplied = new Set();

    const wrapAsyncWhenReady = (name, fn) => {
        if (mobileHooksApplied.has(name)) return true;
        const original = window[name];
        if (typeof original !== "function") return false;

        window[name] = async function (...args) {
            const out = await original.apply(this, args);
            try {
                await fn();
            } catch (e) {
                console.error(e);
            }
            return out;
        };

        mobileHooksApplied.add(name);
        return true;
    };

    const renderAllMobileViews = () => {
        renderLabourMobileUI();
        renderMaterialsMobileUI();
        renderCashMobileUI();
        renderSitesMobileUI();
        renderWorkersMobileUI();
        renderMatMasterMobileUI();
    };

    const applyMobileHooks = () => {
        const ok = [
            wrapAsyncWhenReady("renderLabour", renderLabourMobileUI),
            wrapAsyncWhenReady("renderMaterials", renderMaterialsMobileUI),
            wrapAsyncWhenReady("renderCash", renderCashMobileUI),
            wrapAsyncWhenReady("renderSites", renderSitesMobileUI),
            wrapAsyncWhenReady("renderWorkers", renderWorkersMobileUI),
            wrapAsyncWhenReady("renderMatMaster", renderMatMasterMobileUI),
        ];

        if (ok.every(Boolean)) {
            renderAllMobileViews();
            return;
        }

        setTimeout(applyMobileHooks, 200);
    };

    window.addEventListener("load", applyMobileHooks);
    window.addEventListener("resize", renderAllMobileViews);
})();