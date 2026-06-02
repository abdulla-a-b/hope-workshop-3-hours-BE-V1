/* ============================================================================
   HOPE WORKSHOP — Application Logic
   ----------------------------------------------------------------------------
   - Slide navigation (keyboard, swipe, click, sidebar)
   - LocalStorage autosave for every input
   - Hope KPI Index live calculator
   - Break timer with animated ring
   - Submission to Google Apps Script
   - PDF export (window.print to PDF — no extra dependencies)
   - Theme toggle (dark / light)
   - Accessibility: aria-current, focus management, keyboard support
   ============================================================================ */

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = "hope_workshop_responses_v1";
  const THEME_KEY = "hope_workshop_theme";
  const slides = Array.from(document.querySelectorAll(".slide"));
  const navLinks = Array.from(document.querySelectorAll(".nav-link"));
  const total = slides.length;
  let current = 0;
  let breakState = { remaining: 15 * 60, total: 15 * 60, intervalId: null, running: false };

  // ---------------------------------------------------------------------------
  // PERSISTENCE
  // ---------------------------------------------------------------------------
  function loadResponses() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("Could not load saved responses:", e);
      return {};
    }
  }

  function saveResponses(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn("Could not save:", e);
      return false;
    }
  }

  function getAllResponses() {
    const data = {};
    document
      .querySelectorAll("[data-key]")
      .forEach((el) => {
        const k = el.getAttribute("data-key");
        data[k] = el.value;
      });
    return data;
  }

  function applySavedResponses() {
    const saved = loadResponses();
    document.querySelectorAll("[data-key]").forEach((el) => {
      const k = el.getAttribute("data-key");
      if (saved[k] !== undefined && saved[k] !== null) {
        el.value = saved[k];
        // trigger any reactive updates (sliders, HKI)
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }

  // Debounced autosave
  let saveTimer = null;
  function autosave(targetEl) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const data = getAllResponses();
      if (saveResponses(data) && targetEl) {
        const saveLabel = document.querySelector(
          `.save-state[data-for="${targetEl.getAttribute("data-key")}"]`
        );
        if (saveLabel) {
          saveLabel.classList.add("show");
          clearTimeout(saveLabel._t);
          saveLabel._t = setTimeout(() => saveLabel.classList.remove("show"), 1500);
        }
      }
    }, 350);
  }

  document.addEventListener("input", (e) => {
    if (e.target.hasAttribute("data-key")) {
      autosave(e.target);
    }
  });

  // ---------------------------------------------------------------------------
  // SLIDE NAVIGATION
  // ---------------------------------------------------------------------------
  function showSlide(idx, { focus = false } = {}) {
    idx = Math.max(0, Math.min(total - 1, idx));
    if (idx === current && slides[idx].classList.contains("active")) return;

    slides.forEach((s, i) => s.classList.toggle("active", i === idx));
    current = idx;

    // Reset reveal animations on the slide entering
    const active = slides[idx];
    active.querySelectorAll(".reveal").forEach((el) => {
      el.style.animation = "none";
      // eslint-disable-next-line no-unused-expressions
      el.offsetHeight; // force reflow
      el.style.animation = "";
    });

    // Update progress
    updateProgress();
    updateNav();
    updateFoot();

    // Scroll the stage to top (better mobile UX)
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Focus the slide for screen readers
    if (focus) {
      active.setAttribute("tabindex", "-1");
      active.focus({ preventScroll: true });
    }

    // Close mobile sidebar if open
    closeSidebar();

    // Update URL hash for shareable links
    const section = active.getAttribute("data-section");
    if (section) {
      history.replaceState(null, "", `#${section}-${idx + 1}`);
    }
  }

  function nextSlide() { showSlide(current + 1); }
  function prevSlide() { showSlide(current - 1); }

  function updateProgress() {
    const pct = ((current + 1) / total) * 100;
    document.getElementById("progressFill").style.width = pct + "%";
    document.getElementById("progressText").textContent = `${current + 1} / ${total}`;
  }

  function updateNav() {
    const activeSection = slides[current].getAttribute("data-section");
    navLinks.forEach((link) => {
      const isActive = link.getAttribute("data-target") === activeSection;
      link.classList.toggle("active", isActive);
      if (isActive) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });

    document.getElementById("prevBtn").disabled = current === 0;
    document.getElementById("nextBtn").disabled = current === total - 1;
  }

  function updateFoot() {
    const num = String(current + 1).padStart(2, "0");
    document.getElementById("footNum").textContent = num;
  }

  // Click handlers
  document.getElementById("prevBtn").addEventListener("click", prevSlide);
  document.getElementById("nextBtn").addEventListener("click", nextSlide);

  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      const target = link.getAttribute("data-target");
      // Find first slide with that section
      const idx = slides.findIndex((s) => s.getAttribute("data-section") === target);
      if (idx >= 0) showSlide(idx, { focus: true });
    });
  });

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    // Don't hijack while user is typing in inputs
    const tag = (e.target.tagName || "").toLowerCase();
    const isTyping = tag === "input" || tag === "textarea";

    if (e.key === "ArrowRight" && !isTyping) nextSlide();
    if (e.key === "ArrowLeft" && !isTyping) prevSlide();
    if (e.key === "Home" && !isTyping) showSlide(0);
    if (e.key === "End" && !isTyping) showSlide(total - 1);
    if (e.key === "Escape") closeSidebar();
  });

  // Touch swipe (mobile)
  let touchStart = null;
  document.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const dt = Date.now() - touchStart.t;

    // Must be a quick horizontal swipe, not a tap or vertical scroll
    if (dt < 500 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      // Don't swipe if target is input/textarea/range
      const tag = (e.target.tagName || "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;
      if (dx < 0) nextSlide();
      else prevSlide();
    }
    touchStart = null;
  }, { passive: true });

  // ---------------------------------------------------------------------------
  // SIDEBAR (mobile)
  // ---------------------------------------------------------------------------
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  const menuToggle = document.getElementById("menuToggle");

  function openSidebar() {
    sidebar.classList.add("open");
    backdrop.classList.add("show");
    backdrop.style.display = "block";
    menuToggle.classList.add("open");
    menuToggle.setAttribute("aria-expanded", "true");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    backdrop.classList.remove("show");
    setTimeout(() => { if (!backdrop.classList.contains("show")) backdrop.style.display = "none"; }, 250);
    menuToggle.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  }
  menuToggle.addEventListener("click", () => {
    sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });
  backdrop.addEventListener("click", closeSidebar);

  // ---------------------------------------------------------------------------
  // THEME TOGGLE
  // ---------------------------------------------------------------------------
  const themeToggleBtn = document.getElementById("themeToggle");
  const themeLabel = document.getElementById("themeLabel");

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeLabel.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
    // Adjust theme-color meta
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0a0e1a" : "#f6f4ee");
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  }

  themeToggleBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  // Restore saved theme
  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === "light" || savedTheme === "dark") applyTheme(savedTheme);
  } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------------------
  // HOPE KPI INDEX — live calculator from 5 sliders
  // Per Snyder + HDPS formula:  HKI = (G + P + A + M + F) / 5
  //   G = Goal Clarity · P = Pathway Thinking · A = Agency
  //   M = Motivation Stability · F = Future Belief
  // ---------------------------------------------------------------------------
  const rateKeys = ["rate_goal", "rate_path", "rate_agency", "rate_motivation", "rate_future"];

  function updateHKI() {
    const vals = rateKeys.map((k) => {
      const el = document.getElementById(k);
      const v = parseInt(el?.value || "5", 10);
      const lbl = document.getElementById("val_" + k);
      if (lbl) lbl.textContent = v;
      return v;
    });
    // True 5-dimensional HKI: (G + P + A + M + F) / 5
    const hki = vals.reduce((a, b) => a + b, 0) / vals.length;
    const hkiEl = document.getElementById("hkiValue");
    const fill = document.getElementById("hkiBarFill");
    if (hkiEl) hkiEl.textContent = hki.toFixed(1);
    if (fill) fill.style.width = (hki / 10) * 100 + "%";
  }
  rateKeys.forEach((k) => {
    const el = document.getElementById(k);
    if (el) el.addEventListener("input", updateHKI);
  });
  updateHKI();

  // ---------------------------------------------------------------------------
  // BREAK TIMER
  // ---------------------------------------------------------------------------
  const breakTimer = document.getElementById("breakTimer");
  const breakRing = document.getElementById("breakRingFill");
  const RING_LENGTH = 578; // 2 * pi * 92

  function renderBreak() {
    if (!breakTimer) return;
    const min = Math.floor(breakState.remaining / 60);
    const sec = breakState.remaining % 60;
    breakTimer.textContent = `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    const frac = breakState.remaining / breakState.total;
    if (breakRing) breakRing.setAttribute("stroke-dashoffset", RING_LENGTH * (1 - frac));
  }

  function startBreak() {
    if (breakState.running) return;
    breakState.running = true;
    breakState.intervalId = setInterval(() => {
      breakState.remaining = Math.max(0, breakState.remaining - 1);
      renderBreak();
      if (breakState.remaining === 0) {
        clearInterval(breakState.intervalId);
        breakState.running = false;
        toast("Break complete. Ready for Session 4 →", "success");
      }
    }, 1000);
  }

  function resetBreak() {
    clearInterval(breakState.intervalId);
    breakState.running = false;
    breakState.remaining = breakState.total;
    renderBreak();
  }

  const breakStartBtn = document.getElementById("breakStart");
  const breakResetBtn = document.getElementById("breakReset");
  if (breakStartBtn) breakStartBtn.addEventListener("click", startBreak);
  if (breakResetBtn) breakResetBtn.addEventListener("click", resetBreak);
  renderBreak();

  // ---------------------------------------------------------------------------
  // SUBMISSION TO GOOGLE APPS SCRIPT
  // ---------------------------------------------------------------------------
  const submitBtn = document.getElementById("submitBtn");
  const submitStatus = document.getElementById("submitStatus");
  const consentEl = document.getElementById("consent");

  async function submitResponses() {
    const data = getAllResponses();
    const config = window.HOPE_CONFIG || {};

    // Derived: HKI
    const ratings = rateKeys.map((k) => parseInt(data[k] || "5", 10));
    const hki = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2);

    // Generate certificate ID NOW (before submission) so we can:
    //   (a) include it in the row so verification works
    //   (b) include it in the auto-email link
    //   (c) ensure the certificate shown after submission uses the same ID
    const participantName = (data.participant_name || "").trim() || "Workshop Participant";
    const certId = buildCertId(participantName);
    window.__certIdForSubmission = certId;

    const payload = {
      workshop_id: config.WORKSHOP_ID || "hope-as-a-skill-2026",
      workshop_name: config.WORKSHOP_NAME || "Hope as a Skill",
      version: config.VERSION || "1.0.0",
      submitted_at: new Date().toISOString(),
      timezone_offset: new Date().getTimezoneOffset(),
      consent: !!(consentEl && consentEl.checked),
      batch_name: getRememberedBatch(),
      cert_id: certId,
      hki_score: hki,
      ...data
    };

    submitBtn.classList.add("loading");
    submitBtn.disabled = true;
    setStatus("Submitting…", "info");

    if (!config.GOOGLE_SCRIPT_URL) {
      // No backend configured — tell the user clearly. Do NOT download JSON.
      // (Their answers remain safely autosaved in this browser.)
      submitBtn.classList.remove("loading");
      submitBtn.disabled = false;
      setStatus(
        "Submission isn't connected yet. The Google Script URL is missing in index.html — please tell your facilitator.",
        "error"
      );
      toast("Backend not configured", "error");
      return;
    }

    try {
      // Google Apps Script doesn't return CORS headers, so we use "no-cors":
      // the POST is delivered and the row is written, but the response is
      // opaque (unreadable) by design. We confirm success using the
      // certificate ID we generated on the client, so we never need to read
      // the response. text/plain avoids a CORS preflight Apps Script rejects.
      await fetch(config.GOOGLE_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        cache: "no-cache",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });

      submitBtn.classList.remove("loading");
      submitBtn.disabled = false;
      setStatus(
        "Submitted successfully" + (payload.cert_id ? " · Reference: " + payload.cert_id : "") + ". Thank you for participating!",
        "success"
      );
      toast("Submitted to Google Sheets", "success");
    } catch (err) {
      // Only genuine network errors (offline, bad URL) land here.
      console.error(err);
      submitBtn.classList.remove("loading");
      submitBtn.disabled = false;
      setStatus(
        "Could not reach the server. Your answers are still saved in this browser — please check your connection and try again.",
        "error"
      );
      toast("Submission failed — answers saved locally", "error");
      // NOTE: no JSON download — data is preserved in localStorage automatically.
    }
  }

  function setStatus(msg, kind) {
    submitStatus.textContent = msg;
    submitStatus.className = "submit-status show " + (kind === "success" ? "success" : kind === "error" ? "error" : "");
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 200);
  }

  if (submitBtn) submitBtn.addEventListener("click", () => {
    if (validateSurvey()) submitResponses();
  });

  // ---------------------------------------------------------------------------
  // SURVEY VALIDATION — Q3, Q4, Q5 are required
  // ---------------------------------------------------------------------------
  function setFieldError(key, message) {
    const el = document.querySelector(`[data-key="${key}"]`);
    if (!el) return;
    const card =
      el.closest(".survey-card") ||
      el.closest(".form-field") ||
      document.querySelector(`[data-required="${key}"]`);
    if (!card) return;
    card.classList.add("has-error");
    let errEl = card.querySelector(".survey-error");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.className = "survey-error";
      card.appendChild(errEl);
    }
    errEl.textContent = message;
  }

  function clearFieldError(key) {
    const el = document.querySelector(`[data-key="${key}"]`);
    if (!el) return;
    const card =
      el.closest(".survey-card") ||
      el.closest(".form-field") ||
      document.querySelector(`[data-required="${key}"]`);
    if (!card) return;
    card.classList.remove("has-error");
    const errEl = card.querySelector(".survey-error");
    if (errEl) errEl.remove();
  }

  function validateSurvey() {
    let firstInvalidEl = null;
    let valid = true;

    // Q3 — Takeaway (text required, at least 4 chars)
    const takeawayEl = document.querySelector('[data-key="survey_takeaway"]');
    const takeaway = (takeawayEl?.value || "").trim();
    if (takeaway.length < 4) {
      setFieldError("survey_takeaway", "Please share your most valuable takeaway — a few words is enough.");
      if (!firstInvalidEl) firstInvalidEl = takeawayEl;
      valid = false;
    } else {
      clearFieldError("survey_takeaway");
    }

    // Q4 — Concrete change (text required)
    const changeEl = document.querySelector('[data-key="survey_change"]');
    const change = (changeEl?.value || "").trim();
    if (change.length < 4) {
      setFieldError("survey_change", "Please tell us one thing you'll do differently.");
      if (!firstInvalidEl) firstInvalidEl = changeEl;
      valid = false;
    } else {
      clearFieldError("survey_change");
    }

    // Q5 — Topics (at least one chip OR an "other" entry)
    const checkedChips = document.querySelectorAll('#surveyTopics input[type="checkbox"]:checked');
    const otherEl = document.querySelector('[data-key="survey_future_other"]');
    const other = (otherEl?.value || "").trim();
    if (checkedChips.length === 0 && other.length === 0) {
      setFieldError("survey_future_topics", "Please pick at least one topic, or write your own below.");
      if (!firstInvalidEl) firstInvalidEl = document.getElementById("surveyTopics");
      valid = false;
    } else {
      clearFieldError("survey_future_topics");
    }

    if (!valid && firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        if (firstInvalidEl.focus) firstInvalidEl.focus({ preventScroll: true });
      }, 350);
      toast("Please complete the required survey questions before submitting.", "error");
    }
    return valid;
  }

  // Clear errors as user types / changes fields
  ["survey_takeaway", "survey_change", "survey_future_other"].forEach((k) => {
    const el = document.querySelector(`[data-key="${k}"]`);
    if (el) el.addEventListener("input", () => {
      if (k === "survey_future_other") clearFieldError("survey_future_topics");
      else clearFieldError(k);
    });
  });
  document.querySelectorAll('#surveyTopics input[type="checkbox"]').forEach((c) => {
    c.addEventListener("change", () => clearFieldError("survey_future_topics"));
  });

  // ---------------------------------------------------------------------------
  // EXPORT AS PDF — leverages browser print (works on all devices)
  // ---------------------------------------------------------------------------
  const exportBtn = document.getElementById("exportBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      // Reveal all slides for the print preview
      slides.forEach((s) => s.classList.add("active"));
      toast("Use 'Save as PDF' in the print dialog", "success");
      setTimeout(() => {
        window.print();
        // Restore single-slide view after a delay
        setTimeout(() => {
          slides.forEach((s, i) => s.classList.toggle("active", i === current));
        }, 400);
      }, 250);
    });
  }

  // ---------------------------------------------------------------------------
  // CLEAR DATA
  // ---------------------------------------------------------------------------
  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const confirmed = confirm(
        "This will clear all your workshop responses from this device. Continue?"
      );
      if (!confirmed) return;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      document.querySelectorAll("[data-key]").forEach((el) => {
        if (el.type === "range") el.value = 5;
        else el.value = "";
      });
      updateHKI();
      toast("All responses cleared", "success");
    });
  }

  // ---------------------------------------------------------------------------
  // GO TO SUBMIT (from closing slide) — finds the submit slide by element
  // so it stays correct as slides are added/reordered.
  // ---------------------------------------------------------------------------
  const goToSubmit = document.getElementById("goToSubmit");
  if (goToSubmit) {
    goToSubmit.addEventListener("click", () => {
      const submitSlide = document.getElementById("continueBtn")?.closest(".slide");
      const idx = submitSlide ? slides.indexOf(submitSlide) : -1;
      if (idx >= 0) {
        showSlide(idx, { focus: true });
      } else {
        // Fallback: just advance one slide
        nextSlide();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // TOAST
  // ---------------------------------------------------------------------------
  function toast(msg, kind) {
    const stack = document.getElementById("toastStack");
    const el = document.createElement("div");
    el.className = "toast " + (kind || "");
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3100);
  }

  // ---------------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------------

  // Handle deep links via hash
  function initFromHash() {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    const parts = hash.split("-");
    const slideNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(slideNum) && slideNum >= 1 && slideNum <= total) {
      showSlide(slideNum - 1);
    }
  }

  // Apply persisted responses BEFORE first render so save indicator doesn't flicker
  applySavedResponses();
  updateHKI();
  updateNav();
  updateFoot();
  updateProgress();
  initFromHash();

  // ---------------------------------------------------------------------------
  // CONTINUE → SURVEY (slide 17 button) with contact validation
  // ---------------------------------------------------------------------------
  function validateContactInfo() {
    let firstInvalidEl = null;
    let valid = true;

    // Name — required, at least 2 chars
    const nameEl = document.getElementById("participant_name");
    const name = (nameEl?.value || "").trim();
    if (name.length < 2) {
      setFieldError("participant_name", "Please enter your name — it will appear on your certificate.");
      if (!firstInvalidEl) firstInvalidEl = nameEl;
      valid = false;
    } else {
      clearFieldError("participant_name");
    }

    // Mobile — required, must have at least 6 digits
    const mobileEl = document.getElementById("participant_mobile");
    const mobile = (mobileEl?.value || "").trim();
    const mobileDigits = mobile.replace(/\D/g, "");
    if (mobileDigits.length < 6) {
      setFieldError("participant_mobile", "Please enter a valid mobile number.");
      if (!firstInvalidEl) firstInvalidEl = mobileEl;
      valid = false;
    } else {
      clearFieldError("participant_mobile");
    }

    // Email — required, must match basic email pattern
    const emailEl = document.getElementById("participant_email");
    const email = (emailEl?.value || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError("participant_email", "Please enter a valid email address (we'll send your certificate copy).");
      if (!firstInvalidEl) firstInvalidEl = emailEl;
      valid = false;
    } else {
      clearFieldError("participant_email");
    }

    if (!valid && firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        if (firstInvalidEl.focus) firstInvalidEl.focus({ preventScroll: true });
      }, 350);
      toast("Please fill in your name, mobile, and email before continuing.", "error");
    }
    return valid;
  }

  // Clear contact errors as user types
  ["participant_name", "participant_mobile", "participant_email"].forEach((k) => {
    const el = document.getElementById(k);
    if (el) el.addEventListener("input", () => clearFieldError(k));
  });

  const continueBtn = document.getElementById("continueBtn");
  if (continueBtn) {
    continueBtn.addEventListener("click", () => {
      if (validateContactInfo()) nextSlide();
    });
  }

  // Back button on the survey slide → return to action plan
  const surveyBackBtn = document.getElementById("surveyBackBtn");
  if (surveyBackBtn) {
    surveyBackBtn.addEventListener("click", prevSlide);
  }

  // ---------------------------------------------------------------------------
  // SURVEY — live slider values + multi-select chip wiring
  // ---------------------------------------------------------------------------
  ["survey_overall", "survey_nps"].forEach((k) => {
    const slider = document.getElementById(k);
    const label = document.getElementById("val_" + k);
    if (slider && label) {
      const sync = () => { label.textContent = slider.value; };
      slider.addEventListener("input", sync);
      sync();
    }
  });

  // Multi-select chips → hidden joined field
  const surveyTopicsHidden = document.getElementById("survey_future_topics");
  const surveyChipInputs = document.querySelectorAll('#surveyTopics input[type="checkbox"]');

  function syncSurveyTopics() {
    if (!surveyTopicsHidden) return;
    const checked = Array.from(surveyChipInputs).filter((c) => c.checked).map((c) => c.value);
    surveyTopicsHidden.value = checked.join(", ");
    // Trigger autosave on hidden input
    surveyTopicsHidden.dispatchEvent(new Event("input", { bubbles: true }));
    // Visual state on label
    surveyChipInputs.forEach((c) => {
      const lbl = c.closest(".survey-chip");
      if (lbl) lbl.classList.toggle("checked", c.checked);
    });
  }
  surveyChipInputs.forEach((c) => c.addEventListener("change", syncSurveyTopics));


  // ─── Slide 3: "Voices from the room" — LIVE WALL ───────────────────────
  // Participants tap "Share with the room" → POST goes to the Apps Script,
  // which appends a row to a separate "Live_Responses" tab. While slide 3 is
  // visible, the page polls (JSONP) every 8s and renders new entries as
  // colored pills with a smooth entrance animation. CORS is sidestepped on
  // POST via no-cors mode, and on GET via JSONP (script-tag injection).
  const shareBtn  = document.getElementById("shareLoseHopeBtn");
  const voicesWall = document.getElementById("voicesWall");
  const voicesGrid = document.getElementById("voicesGrid");
  const voicesCount = document.getElementById("voicesCount");
  const voicesField = voicesWall ? voicesWall.getAttribute("data-field") : "";
  let voicesPollTimer = null;
  let voicesSeen = new Set();   // dedupe by timestamp+text
  let voicesColorCursor = 0;    // rotates through the 6 pill colors

  function voicesShareTextarea() {
    return document.getElementById("lose_hope_answer");
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const ta = voicesShareTextarea();
      const text = (ta && ta.value || "").trim();
      if (!text) { toast("Write something first to share", "error"); return; }
      const cfg = window.HOPE_CONFIG || {};
      if (!cfg.GOOGLE_SCRIPT_URL) {
        toast("Backend isn't connected — ask the facilitator", "error");
        return;
      }
      shareBtn.disabled = true;
      shareBtn.classList.add("sharing");
      const payload = {
        action: "share_response",
        field: voicesField,
        text: text,
        batch_name: (typeof getRememberedBatch === "function") ? getRememberedBatch() : "",
        workshop_id: cfg.WORKSHOP_ID || ""
      };
      try {
        await fetch(cfg.GOOGLE_SCRIPT_URL, {
          method: "POST",
          mode: "no-cors",
          cache: "no-cache",
          redirect: "follow",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload)
        });
        toast("Shared with the room", "success");
        // Optimistic local render so the participant sees their own voice instantly
        renderVoices([{ timestamp: new Date().toISOString(), text: text }], /*optimistic*/ true);
        // Trigger a server re-fetch so others' words land on this device too
        setTimeout(pollVoices, 1200);
      } catch (err) {
        toast("Could not share — try again", "error");
      } finally {
        setTimeout(() => {
          shareBtn.disabled = false;
          shareBtn.classList.remove("sharing");
        }, 2500);
      }
    });
  }

  function pollVoices() {
    if (!voicesGrid) return;
    const cfg = window.HOPE_CONFIG || {};
    if (!cfg.GOOGLE_SCRIPT_URL) return;
    const cbName = "__voicesCb_" + Date.now() + "_" + Math.floor(Math.random() * 1e5);
    const script = document.createElement("script");
    let done = false;
    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
    };
    const timeout = setTimeout(() => { if (done) return; done = true; cleanup(); }, 10000);
    window[cbName] = (data) => {
      if (done) return; done = true; clearTimeout(timeout); cleanup();
      if (data && data.ok && Array.isArray(data.responses)) {
        renderVoices(data.responses);
      }
    };
    script.onerror = () => { if (done) return; done = true; clearTimeout(timeout); cleanup(); };
    const batchName = (typeof getRememberedBatch === "function") ? getRememberedBatch() : "";
    script.src = cfg.GOOGLE_SCRIPT_URL +
      "?action=get_responses&field=" + encodeURIComponent(voicesField) +
      "&callback=" + cbName +
      (batchName ? "&batch_name=" + encodeURIComponent(batchName) : "") +
      "&_=" + Date.now(); // bust caches
    document.body.appendChild(script);
  }

  function renderVoices(responses, optimistic) {
    if (!voicesGrid) return;
    // Filter out ones we've already shown
    const fresh = responses.filter(r => {
      const key = (r.timestamp || "") + "|" + (r.text || "");
      if (voicesSeen.has(key)) return false;
      voicesSeen.add(key);
      return true;
    });
    if (!fresh.length) return;
    // Remove the "empty" placeholder once anything arrives
    const empty = voicesGrid.querySelector(".voices-empty");
    if (empty) empty.remove();
    const fragment = document.createDocumentFragment();
    fresh.forEach((r, idx) => {
      const pill = document.createElement("div");
      pill.className = "voice-pill voice-color-" + (voicesColorCursor++ % 6);
      pill.textContent = r.text;
      pill.style.setProperty("--enter-delay", (idx * 0.06) + "s");
      fragment.appendChild(pill);
    });
    // Newest pills appear at the top
    voicesGrid.insertBefore(fragment, voicesGrid.firstChild);
    if (voicesCount) voicesCount.textContent = String(voicesSeen.size);
  }

  function isVoicesSlideActive() {
    if (!voicesWall) return false;
    const slide = voicesWall.closest(".slide");
    return !!(slide && slide.classList.contains("active"));
  }

  function startVoicesPolling() {
    if (voicesPollTimer || !voicesWall) return;
    pollVoices(); // immediate fetch
    voicesPollTimer = setInterval(pollVoices, 8000);
  }
  function stopVoicesPolling() {
    if (voicesPollTimer) { clearInterval(voicesPollTimer); voicesPollTimer = null; }
  }

  // Watch the .active class on the slide; start polling only while visible.
  if (voicesWall) {
    const slideEl = voicesWall.closest(".slide");
    if (slideEl) {
      const obs = new MutationObserver(() => {
        if (isVoicesSlideActive()) startVoicesPolling();
        else stopVoicesPolling();
      });
      obs.observe(slideEl, { attributes: true, attributeFilter: ["class"] });
      // Also check on load — if slide 3 happens to be the active one already
      if (isVoicesSlideActive()) startVoicesPolling();
    }
  }


  // Tapping a card toggles its selected state. Selected values save to the
  // hidden field which submits with the rest of the responses.
  const struggleGrid = document.getElementById("struggleGrid");
  const struggleHidden = document.getElementById("struggles_experienced");
  if (struggleGrid && struggleHidden) {
    const cards = Array.from(struggleGrid.querySelectorAll(".struggle-card"));
    function syncStruggle() {
      const sel = cards.filter(c => c.classList.contains("selected"))
                       .map(c => c.getAttribute("data-value"));
      struggleHidden.value = sel.join(", ");
      struggleHidden.dispatchEvent(new Event("input", { bubbles: true }));
    }
    cards.forEach(card => {
      card.addEventListener("click", () => {
        card.classList.toggle("selected");
        syncStruggle();
      });
    });
    // Restore saved selections
    if (struggleHidden.value) {
      const saved = struggleHidden.value.split(",").map(s => s.trim());
      cards.forEach(c => { if (saved.includes(c.getAttribute("data-value"))) c.classList.add("selected"); });
    }
  }

  // Risk-chain "choose top 3" — boxes in the chain are directly clickable.
  // Selected stages (max 3) appear in the "Your Top 3" area below and save
  // to the hidden field (canonical English values for consistent analytics).
  const riskHidden = document.getElementById("org_risk_chain_top3");
  const riskChain = document.getElementById("riskChain");
  const riskCount = document.getElementById("riskChainCount");
  const riskSelected = document.getElementById("riskSelected");
  const riskSteps = riskChain ? Array.from(riskChain.querySelectorAll(".risk-step")) : [];

  function renderRiskSelection() {
    if (!riskHidden) return;
    const chosen = riskSteps.filter((s) => s.classList.contains("selected"));
    const values = chosen.map((s) => s.getAttribute("data-value"));
    riskHidden.value = values.join(", ");
    riskHidden.dispatchEvent(new Event("input", { bubbles: true }));
    if (riskCount) riskCount.textContent = String(chosen.length);

    // Disable unpicked steps once 3 are chosen
    riskSteps.forEach((s) => {
      const sel = s.classList.contains("selected");
      s.setAttribute("aria-pressed", sel ? "true" : "false");
      s.classList.toggle("risk-disabled", !sel && chosen.length >= 3);
    });

    // Rebuild the "Your Top 3" area
    if (riskSelected) {
      if (chosen.length === 0) {
        const dict = (window.HOPE_CONFIG_T && window.HOPE_CONFIG_T) || null;
        riskSelected.innerHTML =
          '<span class="risk-selected-empty" data-i18n="o4.empty">Tap stages in the chain above to add them here.</span>';
        // re-translate the empty hint if a language is active
        if (typeof window.__applyI18n === "function") window.__applyI18n();
      } else {
        riskSelected.innerHTML = chosen
          .map((s, i) => {
            const key = s.getAttribute("data-i18n");
            return (
              '<span class="risk-pill"><span class="risk-pill-num">' +
              (i + 1) +
              '</span><span data-i18n="' + key + '">' +
              s.textContent +
              "</span></span>"
            );
          })
          .join("");
        if (typeof window.__applyI18n === "function") window.__applyI18n();
      }
    }
  }

  function toggleRiskStep(step) {
    const isSelected = step.classList.contains("selected");
    const count = riskSteps.filter((s) => s.classList.contains("selected")).length;
    if (!isSelected && count >= 3) return; // max 3
    step.classList.toggle("selected");
    renderRiskSelection();
  }

  riskSteps.forEach((step) => {
    step.addEventListener("click", () => toggleRiskStep(step));
    step.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleRiskStep(step);
      }
    });
  });

  // Restore saved selection
  if (riskHidden && riskHidden.value) {
    const saved = riskHidden.value.split(",").map((s) => s.trim());
    riskSteps.forEach((s) => {
      if (saved.includes(s.getAttribute("data-value"))) s.classList.add("selected");
    });
    renderRiskSelection();
  }

  // Restore chip state from saved hidden value (applySavedResponses ran earlier)
  function restoreSurveyTopics() {
    if (!surveyTopicsHidden || !surveyTopicsHidden.value) return;
    const saved = surveyTopicsHidden.value.split(",").map((s) => s.trim());
    surveyChipInputs.forEach((c) => {
      if (saved.includes(c.value)) {
        c.checked = true;
        const lbl = c.closest(".survey-chip");
        if (lbl) lbl.classList.add("checked");
      }
    });
  }
  restoreSurveyTopics();

  // ---------------------------------------------------------------------------
  // INTERNATIONALISATION (English / বাংলা)
  //   Add more keys to TRANSLATIONS to extend Bengali coverage.
  //   Markup uses data-i18n="key" or data-i18n-placeholder="key".
  // ---------------------------------------------------------------------------
  const I18N_KEY = "hope_workshop_lang_v1";
  const TRANSLATIONS = {
    en: {
      "brand": "HOPE Workshop",
      // Password gate
      "pw.kicker": "Restricted Workshop",
      "pw.title.a": "Hope",
      "pw.title.b": "as a",
      "pw.title.c": "Skill",
      "pw.sub": "A 3-hour workshop by ProfessionalsTalk. Please enter the access code provided by your facilitator to begin.",
      "pw.label": "Access Code",
      "pw.placeholder": "Type your access code",
      "pw.enter": "Enter Workshop",
      "pw.issuedBy": "Issued by",
      // Buttons
      "btn.continue": "Continue to Survey",
      "btn.submit_cert": "Submit & Get My Certificate",
      "btn.download_cert": "Download Certificate (PNG)",
      "btn.download_summary": "Download Learning Summary (PDF)",
      "summary.hint": "Your Learning Summary is a personal take-home PDF with the key concepts, your action plan, and your Hope scores — to keep learning after today.",
      "btn.print_pdf": "Print / Save as PDF",
      "btn.export_pdf": "Download as PDF",
      "btn.clear_data": "Clear My Data",
      "btn.back_plan": "Back to Action Plan",
      "btn.goto_submit": "Go to Submission →",
      // Form labels
      "form.name": "Name",
      "form.mobile": "Mobile",
      "form.email": "Email",
      "form.role": "Role",
      "form.org": "Organisation",
      "form.name.ph": "Your full name (appears on certificate)",
      "form.email.ph": "So we can send you a summary",
      // Badges
      "badge.required": "Required",
      "badge.optional": "(optional)",
      // ---- Content (auto-generated) ----
      "s1.kicker": "Workshop Presentation",
      "s1.sub": "<span class=\"hero-chunk hero-chunk-1\">Rebuilding</span> <span class=\"hero-chunk hero-chunk-2\"><span class=\"word-accent word-amber\">Motivation</span>,</span> <span class=\"hero-chunk hero-chunk-3\"><span class=\"word-accent word-teal\">Meaning</span>,</span> <span class=\"hero-chunk hero-chunk-4\">and <span class=\"word-accent word-blue\">Future Confidence</span></span> <span class=\"hero-chunk hero-chunk-5 hero-sub-muted\">in Uncertain Times</span>",
      "s1.metak.duration": "Duration",
      "s1.metav.duration": "3 Hours",
      "s1.metak.format": "Format",
      "s1.metav.format": "Live · Interactive",
      "s1.metak.year": "Year",
      "s1.scrollhint": "Press → or scroll to begin",
      "s2.kicker": "Workshop Overview",
      "s2.title": "Workshop Objectives",
      "s2.lede": "By the end of this 3-hour session, participants will have developed practical tools to transform hope from a fleeting feeling into a daily practice.",
      "s2.c1.h": "Understand Hope",
      "s2.c1.p": "Learn hope as a psychological skill, not just an emotion that comes and goes.",
      "s2.c2.h": "Build Through Action",
      "s2.c2.p": "Discover how hope is constructed through daily actions, not luck or circumstance.",
      "s2.c3.h": "Rebuild Motivation",
      "s2.c3.p": "Develop personal tools to reignite motivation during uncertainty and pressure.",
      "s2.c4.h": "Create an Action Plan",
      "s2.c4.p": "Leave with a concrete Personal Hope Action Plan for immediate implementation.",
      "s3.kicker": "Session 1 — Opening",
      "s3.title": "Why Hope Matters Today",
      "s3.lede": "In a world of constant uncertainty, professionals feel stuck and mentally overloaded. Hope is not passive thinking — it is a learned psychological capability.",
      "s3.r1.h": "Feeling Stuck",
      "s3.r1.p": "Professionals feel mentally blocked by uncertainty, pressure, and burnout.",
      "s3.r2.h": "Impact of Uncertainty",
      "s3.r2.p": "Rapid change and ambiguity drain motivation and erode confidence over time.",
      "s3.r3.h": "The Burnout Cycle",
      "s3.r3.p": "Without hope, exhaustion becomes a self-reinforcing loop that deepens over time.",
      "s4.kicker": "Activity — Session 1",
      "s4.title": "Hope Check-In Exercise",
      "s4.lede": "Take a moment to reflect on your current state. These questions help surface what is blocking your hope right now. Your answers are saved locally on your device.",
      "s4.q1.label": "Question 1",
      "s4.q1.q": "What currently feels uncertain in my life or career?",
      "s4.q2.label": "Question 2",
      "s4.q2.q": "Where do I feel mentally blocked or stuck right now?",
      "s4.saved": "Saved automatically",
      "s5.kicker": "Core Concept",
      "s5.title": "Optimism <em>vs</em> Hope",
      "s5.lede": "These two concepts are often confused, but they operate very differently. Understanding the distinction is the foundation of this workshop.",
      "s5.opt.label": "Optimism",
      "s5.opt.h": "Thinking good things will happen",
      "s5.opt.p": "A general positive expectation about the future. It is <strong>passive</strong> — a belief that things will work out without necessarily planning how.",
      "s5.hope.label": "Hope",
      "s5.hope.h": "Taking action toward meaningful goals",
      "s5.hope.p": "A learned capability that combines clear goals, multiple pathways, and the belief that you can act. Hope is <strong>active and strategic</strong>.",
      "s5.take.h": "Key Takeaway",
      "s5.take.p": "Optimism is a feeling. Hope is a skill you can build, measure, and improve through daily practice.",
      "s6.kicker": "Core Model — Session 2",
      "s6.title": "Snyder's Hope Theory",
      "s6.lede": "Dr. Charles Snyder's research defines hope as the interaction of three components. When any one is missing, hope collapses.",
      "s6.g.h": "Goals",
      "s6.g.tag": "Where I want to go",
      "s6.g.body": "Clear, meaningful objectives that give direction and purpose to my efforts.",
      "s6.p.h": "Pathways",
      "s6.p.tag": "How I can get there",
      "s6.p.body": "Multiple routes and strategies to overcome obstacles and reach my goals.",
      "s6.a.h": "Agency",
      "s6.a.tag": "Belief I can do it",
      "s6.a.body": "The internal fuel and confidence that drives sustained effort over time.",
      "s7.kicker": "Activity — Session 2",
      "s7.title": "My Hope Map",
      "s7.lede": "Apply Snyder's theory to your own life. Map one meaningful goal using the three-component framework.",
      "s7.s1.h": "Define One Personal Career Goal",
      "s7.s1.sub": "What is one meaningful goal you want to achieve in the next 6 months?",
      "s7.s2.h": "Identify Two Possible Pathways",
      "s7.s2.sub": "What are two different ways you could realistically reach this goal?",
      "s7.s3.h": "Commit to One Action This Week",
      "s7.s3.sub": "What is the single smallest action you can start within 7 days?",
      "s8.kicker": "Session 3 — Daily Practice",
      "s8.title": "Four Hope-Building Habits",
      "s8.lede": "Hope is not built in one grand moment. It grows through small, repeated daily practices that compound over time.",
      "s8.h1.label": "Habit 1",
      "s8.h1.h": "Notice Small Positive Moments",
      "s8.h1.p": "A meaningful conversation, a learning moment, a small achievement. Train your attention to catch what is working.",
      "s8.h2.label": "Habit 2",
      "s8.h2.h": "Self-Dialogue Practice",
      "s8.h2.p": "Replace <span class=\"inline-code\">\"I can't\"</span> with <span class=\"inline-code\">\"I am learning how.\"</span> Your internal narrative shapes your capacity to persist.",
      "s8.h3.label": "Habit 3",
      "s8.h3.h": "Action First Principle",
      "s8.h3.p": "Motivation comes <em>after</em> action, not before. Start small. The feeling follows the behavior.",
      "s8.h4.label": "Habit 4",
      "s8.h4.h": "Meaning Reconnection",
      "s8.h4.p": "Ask yourself: <em>\"Why does my work matter?\"</em> Reconnecting to purpose restores energy during difficult periods.",
      "s9.kicker": "Activity — Session 3",
      "s9.title": "Reframing Exercise",
      "s9.lede": "Turn 3 negative thoughts into hopeful action statements. The words you use shape the actions you take.",
      "s9.neg": "Negative Thought",
      "s9.pos": "Hopeful Reframe",
      "s9.hint": "Tip: Edit any field above. Reframes are starter examples — replace with what feels true to you.",
      "s10.title": "Break",
      "s10.sub": "Take 15 minutes to reflect, stretch, and recharge.<br>The next session will move from thinking to doing.",
      "s10.start": "Start Timer",
      "s10.reset": "Reset",
      "s10.completed": "Completed",
      "s10.completedv": "Sessions 1–3",
      "s10.next": "Up Next",
      "s10.nextv": "Hope in Action",
      "s11.kicker": "Session 4 — Transformation",
      "s11.title": "The HOPE Action Model",
      "s11.lede": "Hope increases when people move from thinking to doing. This four-step model bridges the gap between intention and action.",
      "s11.h.h": "Highlight",
      "s11.h.tag": "your goal",
      "s11.h.p": "Name one meaningful goal with clarity and specificity.",
      "s11.o.h": "Observe",
      "s11.o.tag": "barriers",
      "s11.o.p": "Identify what is currently blocking your progress.",
      "s11.p.h": "Plan",
      "s11.p.tag": "pathways",
      "s11.p.p": "Design two or more routes to overcome each barrier.",
      "s11.e.h": "Execute",
      "s11.e.tag": "one small step",
      "s11.e.p": "Commit to one tiny action within the next 48 hours.",
      "s12.kicker": "Main Workshop Output",
      "s12.title": "Personal Hope Action Plan",
      "s12.lede": "Use the HOPE Action Model to create your personal plan. This is your takeaway from today's workshop.",
      "s12.goal.label": "One Meaningful Goal",
      "s12.goal.hint": "Career or life goal I want to achieve",
      "s12.barrier.label": "One Current Barrier",
      "s12.barrier.hint": "What is blocking my progress right now",
      "s12.sola.label": "Solution A",
      "s12.sola.hint": "First possible pathway forward",
      "s12.solb.label": "Solution B",
      "s12.solb.hint": "Alternative route if A fails",
      "s12.action.label": "One Action Within 48 Hours",
      "s12.action.hint": "The smallest step I will take immediately",
      "s13.kicker": "Reflection — Session 4",
      "s13.title": "Three Reflection Questions",
      "s13.lede": "Before completing your action plan, reflect on these three questions to deepen your commitment.",
      "s13.q1.label": "Question 1",
      "s13.q1.q": "What is blocking my hope right now?",
      "s13.q2.label": "Question 2",
      "s13.q2.q": "What small step can I take immediately?",
      "s13.q3.label": "Question 3",
      "s13.q3.q": "Who can support me on this journey?",
      "s14.kicker": "HR Framework",
      "s14.title": "HOPE-Driven Performance System",
      "s14.lede": "Traditional HR KPIs measure output. The HDPS integrates psychological hope as a performance fuel.",
      "s14.l1.label": "Layer 1 — Hard KPIs",
      "s14.l1.h": "Traditional Metrics",
      "s14.l1.i1": "Productivity rate",
      "s14.l1.i2": "Attendance and punctuality",
      "s14.l1.i3": "Quality error rate",
      "s14.l1.i4": "Training completion",
      "s14.l2.label": "Layer 2 — Soft KPIs",
      "s14.l2.h": "Hope KPI Index",
      "s14.l2.i1": "Goal clarity score",
      "s14.l2.i2": "Pathway thinking ability",
      "s14.l2.i3": "Agency confidence score",
      "s14.l2.i4": "Motivation stability",
      "s15.kicker": "HR Framework",
      "s15.title": "Hope-Performance Matrix",
      "s15.lede": "Classify employees by combining hope levels with performance scores. This reveals hidden talent and rising risks.",
      "s15.lg.goal": "Goal Clarity",
      "s15.lg.path": "Pathway Thinking",
      "s15.lg.agency": "Agency Score",
      "s15.lg.motiv": "Motivation Stability",
      "s15.lg.future": "Future Belief",
      "s15.collow": "Low Performance",
      "s15.colhigh": "High Performance",
      "s15.rowlow": "Low Hope",
      "s15.rowmed": "Medium Hope",
      "s15.rowhigh": "High Hope",
      "s15.atrisk.h": "At Risk Zone",
      "s15.atrisk.p": "Requires immediate intervention and coaching.",
      "s15.temp.h": "Temporary Performer",
      "s15.temp.p": "Performance may decline without hope recovery.",
      "s15.dev.h": "Developing Zone",
      "s15.dev.p": "High potential with targeted hope-building support.",
      "s15.stable.h": "Stable Performer",
      "s15.stable.p": "Consistent output with room for growth.",
      "s15.growth.h": "Growth Candidate",
      "s15.growth.p": "Invest in skill development for future leadership.",
      "s15.star.h": "Star Performer",
      "s15.star.p": "Top talent. Assign strategic projects and mentor others.",
      "s16.kicker": "Closing Message",
      "s16.title": "Hope is not something <em>you wait for</em>",
      "s16.sub": "It is something you practice daily through small decisions.",
      "s16.quote": "\"Hope grows when action begins, even in uncertainty.\"",
      "s16.frameworks": "Frameworks Covered",
      "s16.takeaway": "Your Takeaway",
      "s16.cta.p": "Ready to submit your reflections and receive your summary?",
      "s17.kicker": "Final Step",
      "s17.title": "Submit Your Action Plan",
      "s17.rating.h": "How would you rate yourself <em>right now</em>?",
      "s17.rating.hint": "Move each slider from 1 (low) to 10 (high).",
      "s17.rate.goal": "Goal Clarity",
      "s17.rate.path": "Pathway Thinking",
      "s17.rate.agency": "Agency (Belief I can act)",
      "s17.rate.motiv": "Motivation Stability",
      "s17.hki.label": "Your Hope KPI Index (HKI)",
      "s17.feedback.label": "One thing you will start doing this week",
      "s17.consent": "I'd like an emailed copy of my Hope Action Plan and consent to its storage for workshop improvement.",
      "s18.kicker": "Workshop Feedback · 5 Questions",
      "s18.title": "How was the workshop?",
      "s18.q1.h": "How would you rate your overall workshop experience?",
      "s18.q1.hint": "1 = Not useful at all · 10 = Transformative",
      "s18.q2.h": "How likely are you to recommend this workshop to a colleague or friend?",
      "s18.q2.hint": "0 = Not at all likely · 10 = Extremely likely",
      "s18.q3.h": "What was the single most valuable insight or technique you'll take away?",
      "s18.q3.hint": "In a sentence or two. Your words may help others discover this workshop.",
      "s18.q4.h": "What will you start doing differently after today?",
      "s18.q4.hint": "A concrete change you'll begin within the next 7 days.",
      "s18.q5.h": "Which topics would you like to see in future workshops?",
      "s18.q5.hint": "Tap any that interest you, or write your own below.",
      "s18.consent": "I'm happy for ProfessionalsTalk to share my feedback (anonymously or with attribution) to help others discover this workshop.",
      "s19.kicker": "Certificate of Completion",
      "s19.title": "Your Certificate is Ready",
      "cert.issuer.k": "Issuer",
      "cert.workshop.k": "Workshop",
      "cert.workshop.v": "Hope as a Skill · 3 Hours",
      "cert.verify.k": "Verify",
      "nav.sessionflow": "Session Flow",
      "nav.opening": "Opening",
      "nav.science": "The Science of Hope",
      "nav.daily": "Daily Hope Building",
      "nav.action": "Action Planning",
      "nav.frameworks": "Frameworks",
      "nav.snyder": "Snyder's Hope Theory",
      "nav.hopemodel": "HOPE Action Model",
      "nav.hdps": "HDPS System",
      "nav.duration": "3 Hours · 2026",
      "theme.light": "Light Mode",
      // ---- Organizational slides ----
      "o1.kicker": "Organizational Perspective",
      "o1.title": "When Hope Declines",
      "o1.sub": "The hidden cost to employee health, wellbeing, and organizational performance.",
      "o1.q.h": "The Core Question",
      "o1.q.p": "What happens when employees stop believing that improvement, growth, or a better future is possible?",
      "o2.kicker": "Activity — Reflect & Share",
      "o2.title": "Put Your Answer",
      "o2.lede": "Write your response to the question below. Your answer is saved and shared with the facilitator when you submit at the end.",
      "o2.q": "What happens when employees stop believing a better future is possible?",
      "o3.kicker": "The Science",
      "o3.title": "Hope Is Not Just Positive Thinking",
      "o3.lede": "In psychology, hope is tied to measurable capacities. When it fades, specific risks rise.",
      "o3.hi.label": "Hope relates to",
      "o3.hi.1": "Future orientation",
      "o3.hi.2": "Goal pursuit",
      "o3.hi.3": "Coping capacity",
      "o3.hi.4": "Perceived control",
      "o3.hi.5": "Motivation",
      "o3.lo.label": "Low hope relates to",
      "o3.lo.1": "Chronic stress",
      "o3.lo.2": "Uncertainty",
      "o3.lo.3": "Blocked goals",
      "o3.lo.4": "Low control",
      "o4.kicker": "Activity — Choose Top 3",
      "o4.title": "The Invisible Workplace Risk Chain",
      "o4.lede": "Low hope sets off a chain reaction. Which stages do you see most often in workplaces? Choose your top 3 — your selections are saved.",
      "o4.n1": "Low Hope",
      "o4.n2": "Low Future Confidence",
      "o4.n3": "Chronic Stress Load",
      "o4.n4": "Mental Fatigue",
      "o4.n5": "Behavior Change",
      "o4.n6": "Performance Problems",
      "o4.n7": "Organizational Health Challenges",
      "o4.pick": "Tap up to 3 stages above",
      "o4.your": "Your Top 3 Selections",
      "o4.empty": "Tap stages in the chain above to add them here.",
      "o5.kicker": "Health Impact",
      "o5.title": "Impact on Mental Health",
      "o5.lede": "When hope weakens psychologically, these symptoms tend to emerge:",
      "o5.1": "Emotional exhaustion",
      "o5.2": "Anxiety symptoms",
      "o5.3": "Reduced motivation",
      "o5.4": "Helplessness thinking",
      "o5.5": "Lower resilience",
      "o5.6": "Burnout vulnerability",
      "o6.kicker": "Health Impact",
      "o6.title": "Impact on Physical Health",
      "o6.lede": "Is hope only emotional? It influences the body too — through real physiological systems.",
      "o6.sym.label": "Common physical symptoms",
      "o6.s.1": "Poor sleep quality",
      "o6.s.2": "Fatigue",
      "o6.s.3": "Muscle tension",
      "o6.s.4": "Headaches",
      "o6.s.5": "Digestive discomfort",
      "o6.s.6": "Concentration difficulty",
      "o6.s.7": "Reduced recovery capacity",
      "o6.sys.label": "Physiological systems affected",
      "o6.y.1": "Cortisol regulation",
      "o6.y.2": "Sleep systems",
      "o6.y.3": "Cardiovascular strain",
      "o6.y.4": "Immune functioning",
      "o6.y.5": "Energy regulation",
      "o7.kicker": "People Impact",
      "o7.title": "Employee Wellbeing Impact",
      "o7.lede": "Without hope, employees can lose three things that keep them engaged:",
      "o7.d.h": "Direction",
      "o7.d.q": "“I don't know where I'm going.”",
      "o7.m.h": "Meaning",
      "o7.m.q": "“My work feels empty.”",
      "o7.a.h": "Agency",
      "o7.a.q": "“Nothing I do matters.”",
      "o7.out.label": "Possible behavioral outcomes",
      "o7.o1": "Presenteeism",
      "o7.o2": "Reduced learning",
      "o7.o3": "Low initiative",
      "o7.o4": "Emotional withdrawal",
      "o7.o5": "Reduced creativity",
      "o8.kicker": "Business Impact",
      "o8.title": "Organizational Health Cost",
      "o8.lede": "Low workplace hope quietly drives up cost and risk across the whole organization.",
      "o8.c1.h": "Productivity Risk",
      "o8.c1.p": "Slower execution, low ownership, reduced adaptability.",
      "o8.c2.h": "Burnout Risk",
      "o8.c2.p": "Emotional exhaustion and declining performance.",
      "o8.c3.h": "Retention Risk",
      "o8.c3.p": "“I don't see a future here.” — and they leave.",
      "o8.c4.h": "Safety & Quality Risk",
      "o8.c4.p": "Fatigue and low focus raise errors, safety gaps, and defects.",
      "o8.c5.h": "Healthcare & Cost Risk",
      "o8.c5.p": "More sick leave, absenteeism, turnover cost, and lost productivity.",
      "o9.kicker": "The Contrast",
      "o9.title": "Compare Two Organizations",
      "o9.lede": "Same market, same pressures — but hope changes everything about how each performs.",
      "o9.a.label": "Company A",
      "o9.a.1": "Low trust",
      "o9.a.2": "Low recognition",
      "o9.a.3": "High pressure",
      "o9.a.4": "Unclear future",
      "o9.a.say": "Employees say: “Just survive.”",
      "o9.a.result": "Result: stress, burnout, high turnover.",
      "o9.b.label": "Company B",
      "o9.b.1": "Goal clarity",
      "o9.b.2": "Supportive leadership",
      "o9.b.3": "Growth pathways",
      "o9.b.4": "Meaningful work",
      "o9.b.say": "Employees say: “We can solve problems.”",
      "o9.b.result": "Result: better engagement, adaptability, performance resilience.",
      "nav.org": "Organizational Impact",
      // ---- Cinematic slides ----
      "c1.kicker": "Scene 1 · A True-to-Life Story",
      "c1.head1": "Two employees.",
      "c1.head2": "Same Tuesday.",
      "c1.head3": "Same layoff letter.",
      "c1.sub": "The crisis was identical. Six weeks later, their lives were not.",
      "c1.a.label": "Mr. A",
      "c1.a.tag": "Six weeks on",
      "c1.a.b1": "Stopped applying. \"Why bother?\"",
      "c1.a.b2": "Withdrew from family conversations.",
      "c1.a.b3": "Slept badly. Lost confidence.",
      "c1.a.b4": "Saw no path forward.",
      "c1.b.label": "Ms. B",
      "c1.b.tag": "Six weeks on",
      "c1.b.b1": "Listed 3 goals on paper.",
      "c1.b.b2": "Took one short online course.",
      "c1.b.b3": "Called 5 old colleagues a week.",
      "c1.b.b4": "Reached an offer in week six.",
      "c1.close": "Same crisis. Different hope skill.",
      "c2.kicker": "Pause · 60 Seconds",
      "c2.head": "Close your eyes.",
      "c2.prompt": "Think of one moment you almost gave up — and didn't. What kept you going?",
      "c2.counter": "Breathe in… and out. <strong>Sixty seconds</strong> of stillness.",
      "c3.kicker": "Intermission · Two Workplace Scenes",
      "c3.title": "What hope looks like under pressure",
      "c3.lede": "Same crisis. Two leaders. Watch what changes.",
      "c3.s1.num": "Scene I — The Deadline",
      "c3.s1.title": "When hope quietly leaves the room",
      "c3.s1.b1": "Mission-impossible target dropped on the team.",
      "c3.s1.b2": "Manager blames the floor. Floor blames each other.",
      "c3.s1.b3": "Mr. Khan stops volunteering ideas.",
      "c3.s1.b4": "By Friday, half the team is quiet-quitting.",
      "c3.s1.out": "Hope leaves the room. Performance follows.",
      "c3.s2.num": "Scene II — The Choice",
      "c3.s2.title": "When a leader changes the air",
      "c3.s2.b1": "Same pressure. Different leader.",
      "c3.s2.b2": "Names one clear goal — and why it matters.",
      "c3.s2.b3": "Offers two alternative pathways the team can choose.",
      "c3.s2.b4": "Logs daily 5-minute wins on a shared board.",
      "c3.s2.out": "Hope re-enters the room. People re-engage.",
      "c3.close": "The crisis didn't change. The leadership did.",
      "c4.kicker": "Team Challenge · Live Simulation",
      "c4.title": "Build a Hope Strategy — in 10 Minutes",
      "c4.timer": "10 min",
      "c4.brief.label": "Your Mission",
      "c4.brief.text": "Your team has been hit by a crisis. Use the H·O·P·E framework — together — to build a hope-driven response in the next 10 minutes.",
      "c4.choose": "Pick one crisis to solve as a team:",
      "c4.opt1": "Sudden 30% budget cut",
      "c4.opt2": "A senior leader has resigned",
      "c4.opt3": "Your biggest client just walked out",
      "c4.h.word": "Highlight",
      "c4.h.prompt": "One realistic goal in this crisis.",
      "c4.o.word": "Observe",
      "c4.o.prompt": "Two biggest barriers in the team's way.",
      "c4.p.word": "Plan",
      "c4.p.prompt": "Three different pathways forward.",
      "c4.e.word": "Execute",
      "c4.e.prompt": "One action your team commits to by Friday.",
      "c4.input.label": "Write your team's hope strategy (saves to facilitator)",
      "c4.input.ph": "Goal:\nBarriers:\nThree pathways:\nFriday action:",
      // ---- Cinematic cold open (slide 1) ----
      "cold.presents": "ProfessionalsTalk Presents",
      "cold.title": "Hope.",
      "cold.subtitle": "As a Skill",
      "cold.tagline": "Three hours. A skill that lasts a lifetime.",
      "cold.chapter": "Chapter One",

      // ---- New slides 3 & 4 (problem + struggle) ----
      "prob.kicker": "Act I · The Problem",
      "prob.q1": "What happens",
      "prob.q2": "when employees",
      "prob.q3": "lose hope?",
      "prob.sub": "Take 60 seconds. Write what you've seen — one phrase or several, separated by commas.",
      "prob.label": "Your observations",
      "prob.ph": "e.g. People stop volunteering ideas, sick leave rises, the best ones quietly leave…",
      "prob.share": "Share with the room",
      "prob.voices": "Voices from the room",
      "prob.empty": "As people share, their words will appear here — live.",
      "strug.kicker": "Act I · The Struggle",
      "strug.title": "The Struggle",
      "strug.lede": "These are the storms that quietly drain hope from workplaces. Tap any that you've experienced — your selections save with your responses.",
      "strug.1": "Uncertainty",
      "strug.2": "Pressure",
      "strug.3": "Layoffs / Termination",
      "strug.4": "Impossible KPIs",
      "strug.5": "Leadership Conflict",
      "strug.have": "Have you experienced this?",
      "strug.hint": "Tap any that apply — your selections save with your responses.",
      // ---- HopeXP gamification ----
      "xp.rank.0": "Novice",
      "xp.rank.1": "Explorer",
      "xp.rank.2": "Builder",
      "xp.rank.3": "Strategist",
      "xp.rank.4": "Architect of Hope",
      "xp.badge.unlocked": "Achievement Unlocked",
      "xp.badge.storyteller.n": "Storyteller",
      "xp.badge.storyteller.d": "Shared your voice with the room.",
      "xp.badge.explorer.n": "Explorer",
      "xp.badge.explorer.d": "Recognised three or more workplace struggles.",
      "xp.badge.mapper.n": "Hope Mapper",
      "xp.badge.mapper.d": "Charted a goal, two pathways, and an action.",
      "xp.badge.reframer.n": "Reframer",
      "xp.badge.reframer.d": "Turned three negative thoughts into hopeful ones.",
      "xp.badge.strategist.n": "Strategist",
      "xp.badge.strategist.d": "Built a team hope-strategy under pressure.",
      "xp.badge.hero.n": "Action Hero",
      "xp.badge.hero.d": "Committed to one real action this week.",
      "xp.badge.architect.n": "Architect of Hope",
      "xp.badge.architect.d": "Completed the workshop and submitted your plan.",

      "cert.journey": "Your Hope Journey",
      "cert.earned": "Earned",
      "cert.reached": "Reached",

    },
    bn: {
      "brand": "HOPE ওয়ার্কশপ",
      "pw.kicker": "সীমাবদ্ধ ওয়ার্কশপ",
      "pw.title.a": "আশা",
      "pw.title.b": "একটি",
      "pw.title.c": "দক্ষতা",
      "pw.sub": "ProfessionalsTalk আয়োজিত একটি ৩-ঘণ্টার ওয়ার্কশপ। শুরু করতে অনুগ্রহ করে আপনার ফ্যাসিলিটেটরের দেওয়া অ্যাক্সেস কোড লিখুন।",
      "pw.label": "অ্যাক্সেস কোড",
      "pw.placeholder": "আপনার অ্যাক্সেস কোড লিখুন",
      "pw.enter": "ওয়ার্কশপ শুরু করুন",
      "pw.issuedBy": "প্রদানকারী",
      "btn.continue": "সার্ভেতে এগিয়ে যান",
      "btn.submit_cert": "জমা দিন ও সার্টিফিকেট নিন",
      "btn.download_cert": "সার্টিফিকেট ডাউনলোড (PNG)",
      "btn.download_summary": "শিখন সারাংশ ডাউনলোড (PDF)",
      "summary.hint": "আপনার শিখন সারাংশ একটি ব্যক্তিগত PDF—এতে মূল ধারণা, আপনার কর্ম পরিকল্পনা ও আপনার আশা স্কোর থাকে, যেন আজকের পরও শেখা চালিয়ে যেতে পারেন।",
      "btn.print_pdf": "প্রিন্ট / PDF সেভ করুন",
      "btn.export_pdf": "PDF হিসেবে ডাউনলোড",
      "btn.clear_data": "আমার তথ্য মুছুন",
      "btn.back_plan": "অ্যাকশন প্ল্যানে ফিরে যান",
      "btn.goto_submit": "সাবমিশনে যান →",
      "form.name": "নাম",
      "form.mobile": "মোবাইল",
      "form.email": "ইমেইল",
      "form.role": "পদবী",
      "form.org": "প্রতিষ্ঠান",
      "form.name.ph": "আপনার পূর্ণ নাম (সার্টিফিকেটে আসবে)",
      "form.email.ph": "যেন আমরা আপনাকে সারাংশ পাঠাতে পারি",
      "badge.required": "আবশ্যক",
      "badge.optional": "(ঐচ্ছিক)",
      // ---- Content (auto-generated) ----
      "s1.kicker": "ওয়ার্কশপ উপস্থাপনা",
      "s1.sub": "<span class=\"hero-chunk hero-chunk-1 hero-sub-muted\">অনিশ্চিত সময়ে</span> <span class=\"hero-chunk hero-chunk-2\"><span class=\"word-accent word-amber\">অনুপ্রেরণা</span>,</span> <span class=\"hero-chunk hero-chunk-3\"><span class=\"word-accent word-teal\">অর্থ</span></span> <span class=\"hero-chunk hero-chunk-4\">ও <span class=\"word-accent word-blue\">ভবিষ্যৎ আত্মবিশ্বাস</span></span> <span class=\"hero-chunk hero-chunk-5\">পুনর্গঠন</span>",
      "s1.metak.duration": "সময়কাল",
      "s1.metav.duration": "৩ ঘণ্টা",
      "s1.metak.format": "ধরন",
      "s1.metav.format": "সরাসরি · ইন্টারঅ্যাক্টিভ",
      "s1.metak.year": "বছর",
      "s1.scrollhint": "শুরু করতে → চাপুন বা স্ক্রোল করুন",
      "s2.kicker": "ওয়ার্কশপ পরিচিতি",
      "s2.title": "ওয়ার্কশপের উদ্দেশ্য",
      "s2.lede": "এই ৩-ঘণ্টার সেশন শেষে অংশগ্রহণকারীরা আশাকে ক্ষণস্থায়ী অনুভূতি থেকে দৈনন্দিন অনুশীলনে রূপান্তরের ব্যবহারিক দক্ষতা অর্জন করবেন।",
      "s2.c1.h": "আশা বুঝুন",
      "s2.c1.p": "আশাকে একটি মানসিক দক্ষতা হিসেবে শিখুন—শুধু আসা-যাওয়া করা আবেগ নয়।",
      "s2.c2.h": "কর্মের মাধ্যমে গড়ুন",
      "s2.c2.p": "আবিষ্কার করুন কীভাবে আশা ভাগ্য বা পরিস্থিতি নয়, বরং দৈনন্দিন কর্মের মাধ্যমে গড়ে ওঠে।",
      "s2.c3.h": "অনুপ্রেরণা পুনর্গঠন",
      "s2.c3.p": "অনিশ্চয়তা ও চাপের সময়ে অনুপ্রেরণা পুনরায় জাগানোর ব্যক্তিগত দক্ষতা তৈরি করুন।",
      "s2.c4.h": "কর্ম পরিকল্পনা তৈরি করুন",
      "s2.c4.p": "তাৎক্ষণিক বাস্তবায়নের জন্য একটি সুনির্দিষ্ট ব্যক্তিগত আশা কর্ম পরিকল্পনা নিয়ে ফিরুন।",
      "s3.kicker": "সেশন ১ — সূচনা",
      "s3.title": "আজ আশা কেন গুরুত্বপূর্ণ",
      "s3.lede": "ক্রমাগত অনিশ্চয়তার পৃথিবীতে পেশাজীবীরা আটকে যাওয়া ও মানসিকভাবে অতিরিক্ত বোঝা অনুভব করেন। আশা নিষ্ক্রিয় চিন্তা নয়—এটি একটি অর্জিত মানসিক সক্ষমতা।",
      "s3.r1.h": "আটকে থাকার অনুভূতি",
      "s3.r1.p": "অনিশ্চয়তা, চাপ ও ক্লান্তির কারণে পেশাজীবীরা মানসিকভাবে আটকে যান।",
      "s3.r2.h": "অনিশ্চয়তার প্রভাব",
      "s3.r2.p": "দ্রুত পরিবর্তন ও অস্পষ্টতা সময়ের সাথে অনুপ্রেরণা ক্ষয় করে ও আত্মবিশ্বাস দুর্বল করে।",
      "s3.r3.h": "ক্লান্তির চক্র",
      "s3.r3.p": "আশা ছাড়া ক্লান্তি একটি স্ব-শক্তিশালী চক্রে পরিণত হয় যা সময়ের সাথে গভীর হয়।",
      "s4.kicker": "অনুশীলন — সেশন ১",
      "s4.title": "আশা যাচাই অনুশীলন",
      "s4.lede": "এক মুহূর্ত থেমে নিজের বর্তমান অবস্থা নিয়ে ভাবুন। এই প্রশ্নগুলো এখন আপনার আশাকে কী আটকে রাখছে তা সামনে আনতে সাহায্য করে। আপনার উত্তর আপনার ডিভাইসেই সংরক্ষিত থাকে।",
      "s4.q1.label": "প্রশ্ন ১",
      "s4.q1.q": "আমার জীবনে বা ক্যারিয়ারে এখন কী কী অনিশ্চিত মনে হচ্ছে?",
      "s4.q2.label": "প্রশ্ন ২",
      "s4.q2.q": "এখন আমি কোথায় মানসিকভাবে আটকে আছি বলে অনুভব করি?",
      "s4.saved": "স্বয়ংক্রিয়ভাবে সংরক্ষিত",
      "s5.kicker": "মূল ধারণা",
      "s5.title": "আশাবাদ <em>বনাম</em> আশা",
      "s5.lede": "এই দুটি ধারণা প্রায়ই গুলিয়ে ফেলা হয়, কিন্তু এদের কাজ করার ধরন একেবারে আলাদা। এই পার্থক্য বোঝাই এই ওয়ার্কশপের ভিত্তি।",
      "s5.opt.label": "আশাবাদ",
      "s5.opt.h": "ভালো কিছু ঘটবে এমন ভাবনা",
      "s5.opt.p": "ভবিষ্যৎ নিয়ে একটি সাধারণ ইতিবাচক প্রত্যাশা। এটি <strong>নিষ্ক্রিয়</strong>—কীভাবে হবে তা পরিকল্পনা ছাড়াই সব ঠিক হয়ে যাবে এমন বিশ্বাস।",
      "s5.hope.label": "আশা",
      "s5.hope.h": "অর্থপূর্ণ লক্ষ্যের দিকে পদক্ষেপ নেওয়া",
      "s5.hope.p": "একটি অর্জিত সক্ষমতা যা স্পষ্ট লক্ষ্য, একাধিক পথ এবং আপনি কাজ করতে পারবেন এই বিশ্বাসকে একত্র করে। আশা <strong>সক্রিয় ও কৌশলগত</strong>।",
      "s5.take.h": "মূল শিক্ষা",
      "s5.take.p": "আশাবাদ একটি অনুভূতি। আশা একটি দক্ষতা যা আপনি দৈনন্দিন অনুশীলনে গড়তে, মাপতে ও উন্নত করতে পারেন।",
      "s6.kicker": "মূল মডেল — সেশন ২",
      "s6.title": "স্নাইডারের আশার তত্ত্ব",
      "s6.lede": "ড. চার্লস স্নাইডারের গবেষণা আশাকে তিনটি উপাদানের মিথস্ক্রিয়া হিসেবে সংজ্ঞায়িত করে। যেকোনো একটি অনুপস্থিত থাকলে আশা ভেঙে পড়ে।",
      "s6.g.h": "লক্ষ্য",
      "s6.g.tag": "আমি কোথায় যেতে চাই",
      "s6.g.body": "স্পষ্ট, অর্থপূর্ণ উদ্দেশ্য যা আমার প্রচেষ্টাকে দিক ও উদ্দেশ্য দেয়।",
      "s6.p.h": "পথ",
      "s6.p.tag": "কীভাবে আমি সেখানে পৌঁছাব",
      "s6.p.body": "বাধা পেরিয়ে লক্ষ্যে পৌঁছানোর একাধিক পথ ও কৌশল।",
      "s6.a.h": "সক্ষমতা",
      "s6.a.tag": "আমি পারব এই বিশ্বাস",
      "s6.a.body": "অভ্যন্তরীণ শক্তি ও আত্মবিশ্বাস যা দীর্ঘমেয়াদে ধারাবাহিক প্রচেষ্টা চালিয়ে নেয়।",
      "s7.kicker": "অনুশীলন — সেশন ২",
      "s7.title": "আমার আশার মানচিত্র",
      "s7.lede": "স্নাইডারের তত্ত্ব আপনার নিজের জীবনে প্রয়োগ করুন। তিন-উপাদানের কাঠামো ব্যবহার করে একটি অর্থপূর্ণ লক্ষ্য সাজান।",
      "s7.s1.h": "একটি ব্যক্তিগত ক্যারিয়ার লক্ষ্য নির্ধারণ করুন",
      "s7.s1.sub": "আগামী ৬ মাসে অর্জন করতে চান এমন একটি অর্থপূর্ণ লক্ষ্য কী?",
      "s7.s2.h": "দুটি সম্ভাব্য পথ চিহ্নিত করুন",
      "s7.s2.sub": "এই লক্ষ্যে বাস্তবসম্মতভাবে পৌঁছানোর দুটি ভিন্ন উপায় কী?",
      "s7.s3.h": "এই সপ্তাহে একটি পদক্ষেপের অঙ্গীকার করুন",
      "s7.s3.sub": "৭ দিনের মধ্যে শুরু করতে পারেন এমন সবচেয়ে ছোট পদক্ষেপটি কী?",
      "s8.kicker": "সেশন ৩ — দৈনন্দিন অনুশীলন",
      "s8.title": "আশা গড়ার চারটি অভ্যাস",
      "s8.lede": "আশা এক মহৎ মুহূর্তে গড়ে ওঠে না। এটি ছোট, পুনরাবৃত্ত দৈনন্দিন অনুশীলনের মাধ্যমে গড়ে ওঠে যা সময়ের সাথে জমা হয়।",
      "s8.h1.label": "অভ্যাস ১",
      "s8.h1.h": "ছোট ইতিবাচক মুহূর্ত লক্ষ্য করুন",
      "s8.h1.p": "একটি অর্থপূর্ণ কথোপকথন, শেখার মুহূর্ত, ছোট অর্জন। যা কাজ করছে তা ধরতে আপনার মনোযোগ অভ্যস্ত করুন।",
      "s8.h2.label": "অভ্যাস ২",
      "s8.h2.h": "আত্ম-সংলাপ অনুশীলন",
      "s8.h2.p": "বদলে দিন <span class=\"inline-code\">\"আমি পারি না\"</span>-কে <span class=\"inline-code\">\"আমি শিখছি কীভাবে করতে হয়।\"</span> আপনার অন্তর্গত কথন আপনার লেগে থাকার সামর্থ্য গড়ে।",
      "s8.h3.label": "অভ্যাস ৩",
      "s8.h3.h": "আগে কর্ম নীতি",
      "s8.h3.p": "অনুপ্রেরণা কর্মের <em>পরে</em> আসে, আগে নয়। ছোট থেকে শুরু করুন। অনুভূতি আচরণের পিছনে আসে।",
      "s8.h4.label": "অভ্যাস ৪",
      "s8.h4.h": "অর্থের সাথে পুনঃসংযোগ",
      "s8.h4.p": "নিজেকে জিজ্ঞাসা করুন: <em>\"আমার কাজ কেন গুরুত্বপূর্ণ?\"</em> উদ্দেশ্যের সাথে পুনঃসংযোগ কঠিন সময়ে শক্তি ফিরিয়ে আনে।",
      "s9.kicker": "অনুশীলন — সেশন ৩",
      "s9.title": "পুনর্বিন্যাস অনুশীলন",
      "s9.lede": "৩টি নেতিবাচক চিন্তাকে আশাব্যঞ্জক কর্ম-বিবৃতিতে রূপান্তর করুন। আপনি যে শব্দ ব্যবহার করেন তা আপনার কর্মকে গড়ে তোলে।",
      "s9.neg": "নেতিবাচক চিন্তা",
      "s9.pos": "আশাব্যঞ্জক পুনর্বিন্যাস",
      "s9.hint": "পরামর্শ: উপরের যেকোনো ঘর সম্পাদনা করুন। পুনর্বিন্যাসগুলো শুরুর উদাহরণ—আপনার কাছে যা সত্য মনে হয় তা দিয়ে বদলে দিন।",
      "s10.title": "বিরতি",
      "s10.sub": "ভাবতে, একটু নড়াচড়া করতে ও পুনরায় শক্তি সঞ্চয় করতে ১৫ মিনিট নিন।<br>পরবর্তী সেশন ভাবনা থেকে কাজের দিকে এগোবে।",
      "s10.start": "টাইমার শুরু",
      "s10.reset": "রিসেট",
      "s10.completed": "সম্পন্ন",
      "s10.completedv": "সেশন ১–৩",
      "s10.next": "পরবর্তী",
      "s10.nextv": "কর্মে আশা",
      "s11.kicker": "সেশন ৪ — রূপান্তর",
      "s11.title": "HOPE অ্যাকশন মডেল",
      "s11.lede": "মানুষ যখন ভাবনা থেকে কাজে এগোয় তখন আশা বাড়ে। এই চার-ধাপের মডেল উদ্দেশ্য ও কর্মের মধ্যে সেতু গড়ে।",
      "s11.h.h": "চিহ্নিত করুন (Highlight)",
      "s11.h.tag": "আপনার লক্ষ্য",
      "s11.h.p": "স্পষ্টতা ও নির্দিষ্টতাসহ একটি অর্থপূর্ণ লক্ষ্যের নাম দিন।",
      "s11.o.h": "পর্যবেক্ষণ করুন (Observe)",
      "s11.o.tag": "বাধাসমূহ",
      "s11.o.p": "এখন কী আপনার অগ্রগতি আটকে রাখছে তা চিহ্নিত করুন।",
      "s11.p.h": "পরিকল্পনা করুন (Plan)",
      "s11.p.tag": "পথসমূহ",
      "s11.p.p": "প্রতিটি বাধা পেরোতে দুই বা ততোধিক পথ নকশা করুন।",
      "s11.e.h": "বাস্তবায়ন করুন (Execute)",
      "s11.e.tag": "একটি ছোট পদক্ষেপ",
      "s11.e.p": "পরবর্তী ৪৮ ঘণ্টার মধ্যে একটি ছোট কাজের অঙ্গীকার করুন।",
      "s12.kicker": "প্রধান ওয়ার্কশপ ফলাফল",
      "s12.title": "ব্যক্তিগত আশা কর্ম পরিকল্পনা",
      "s12.lede": "HOPE অ্যাকশন মডেল ব্যবহার করে আপনার ব্যক্তিগত পরিকল্পনা তৈরি করুন। এটিই আজকের ওয়ার্কশপ থেকে আপনার প্রাপ্তি।",
      "s12.goal.label": "একটি অর্থপূর্ণ লক্ষ্য",
      "s12.goal.hint": "আমি যে ক্যারিয়ার বা জীবন লক্ষ্য অর্জন করতে চাই",
      "s12.barrier.label": "একটি বর্তমান বাধা",
      "s12.barrier.hint": "এখন আমার অগ্রগতি কী আটকে রাখছে",
      "s12.sola.label": "সমাধান ক",
      "s12.sola.hint": "এগিয়ে যাওয়ার প্রথম সম্ভাব্য পথ",
      "s12.solb.label": "সমাধান খ",
      "s12.solb.hint": "ক ব্যর্থ হলে বিকল্প পথ",
      "s12.action.label": "৪৮ ঘণ্টার মধ্যে একটি পদক্ষেপ",
      "s12.action.hint": "আমি যে সবচেয়ে ছোট পদক্ষেপ এখনই নেব",
      "s13.kicker": "প্রতিফলন — সেশন ৪",
      "s13.title": "তিনটি প্রতিফলন প্রশ্ন",
      "s13.lede": "আপনার কর্ম পরিকল্পনা সম্পূর্ণ করার আগে, অঙ্গীকার গভীর করতে এই তিনটি প্রশ্ন নিয়ে ভাবুন।",
      "s13.q1.label": "প্রশ্ন ১",
      "s13.q1.q": "এখন আমার আশাকে কী আটকে রাখছে?",
      "s13.q2.label": "প্রশ্ন ২",
      "s13.q2.q": "আমি এখনই কোন ছোট পদক্ষেপ নিতে পারি?",
      "s13.q3.label": "প্রশ্ন ৩",
      "s13.q3.q": "এই যাত্রায় কে আমাকে সমর্থন দিতে পারে?",
      "s14.kicker": "এইচআর কাঠামো",
      "s14.title": "HOPE-চালিত পারফরম্যান্স সিস্টেম",
      "s14.lede": "প্রচলিত এইচআর KPI ফলাফল মাপে। HDPS মানসিক আশাকে পারফরম্যান্সের জ্বালানি হিসেবে যুক্ত করে।",
      "s14.l1.label": "স্তর ১ — হার্ড KPI",
      "s14.l1.h": "প্রচলিত পরিমাপ",
      "s14.l1.i1": "উৎপাদনশীলতার হার",
      "s14.l1.i2": "উপস্থিতি ও সময়ানুবর্তিতা",
      "s14.l1.i3": "গুণমান ত্রুটির হার",
      "s14.l1.i4": "প্রশিক্ষণ সম্পন্নকরণ",
      "s14.l2.label": "স্তর ২ — সফট KPI",
      "s14.l2.h": "আশা KPI সূচক",
      "s14.l2.i1": "লক্ষ্য স্পষ্টতা স্কোর",
      "s14.l2.i2": "পথ-চিন্তার সক্ষমতা",
      "s14.l2.i3": "সক্ষমতা আত্মবিশ্বাস স্কোর",
      "s14.l2.i4": "অনুপ্রেরণার স্থিতিশীলতা",
      "s15.kicker": "এইচআর কাঠামো",
      "s15.title": "আশা-পারফরম্যান্স ম্যাট্রিক্স",
      "s15.lede": "আশার স্তর ও পারফরম্যান্স স্কোর একত্র করে কর্মীদের শ্রেণিবদ্ধ করুন। এটি লুকানো প্রতিভা ও বাড়তে থাকা ঝুঁকি প্রকাশ করে।",
      "s15.lg.goal": "লক্ষ্য স্পষ্টতা",
      "s15.lg.path": "পথ-চিন্তা",
      "s15.lg.agency": "সক্ষমতা স্কোর",
      "s15.lg.motiv": "অনুপ্রেরণার স্থিতিশীলতা",
      "s15.lg.future": "ভবিষ্যৎ বিশ্বাস",
      "s15.collow": "নিম্ন পারফরম্যান্স",
      "s15.colhigh": "উচ্চ পারফরম্যান্স",
      "s15.rowlow": "নিম্ন আশা",
      "s15.rowmed": "মাঝারি আশা",
      "s15.rowhigh": "উচ্চ আশা",
      "s15.atrisk.h": "ঝুঁকিপূর্ণ অঞ্চল",
      "s15.atrisk.p": "তাৎক্ষণিক হস্তক্ষেপ ও কোচিং প্রয়োজন।",
      "s15.temp.h": "অস্থায়ী পারফরমার",
      "s15.temp.p": "আশা পুনরুদ্ধার ছাড়া পারফরম্যান্স কমে যেতে পারে।",
      "s15.dev.h": "বিকাশমান অঞ্চল",
      "s15.dev.p": "লক্ষ্যভিত্তিক আশা-গঠন সহায়তায় উচ্চ সম্ভাবনা।",
      "s15.stable.h": "স্থিতিশীল পারফরমার",
      "s15.stable.p": "বৃদ্ধির সুযোগসহ ধারাবাহিক ফলাফল।",
      "s15.growth.h": "বৃদ্ধির প্রার্থী",
      "s15.growth.p": "ভবিষ্যৎ নেতৃত্বের জন্য দক্ষতা উন্নয়নে বিনিয়োগ করুন।",
      "s15.star.h": "তারকা পারফরমার",
      "s15.star.p": "শীর্ষ প্রতিভা। কৌশলগত প্রকল্প দিন ও অন্যদের পরামর্শ দিন।",
      "s16.kicker": "সমাপনী বার্তা",
      "s16.title": "আশা এমন কিছু নয় যার জন্য <em>আপনি অপেক্ষা করেন</em>",
      "s16.sub": "এটি এমন কিছু যা আপনি ছোট ছোট সিদ্ধান্তের মাধ্যমে প্রতিদিন অনুশীলন করেন।",
      "s16.quote": "\"কর্ম শুরু হলে আশা বাড়ে, এমনকি অনিশ্চয়তার মধ্যেও।\"",
      "s16.frameworks": "আলোচিত কাঠামো",
      "s16.takeaway": "আপনার প্রাপ্তি",
      "s16.cta.p": "আপনার প্রতিফলন জমা দিতে ও সারাংশ পেতে প্রস্তুত?",
      "s17.kicker": "চূড়ান্ত ধাপ",
      "s17.title": "আপনার কর্ম পরিকল্পনা জমা দিন",
      "s17.rating.h": "এখন আপনি নিজেকে <em>কীভাবে</em> মূল্যায়ন করবেন?",
      "s17.rating.hint": "প্রতিটি স্লাইডার ১ (কম) থেকে ১০ (বেশি) পর্যন্ত সরান।",
      "s17.rate.goal": "লক্ষ্য স্পষ্টতা",
      "s17.rate.path": "পথ-চিন্তা",
      "s17.rate.agency": "সক্ষমতা (আমি কাজ করতে পারি এই বিশ্বাস)",
      "s17.rate.motiv": "অনুপ্রেরণার স্থিতিশীলতা",
      "s17.hki.label": "আপনার আশা KPI সূচক (HKI)",
      "s17.feedback.label": "এই সপ্তাহে আপনি যা শুরু করবেন এমন একটি বিষয়",
      "s17.consent": "আমি আমার আশা কর্ম পরিকল্পনার একটি ইমেইল কপি চাই এবং ওয়ার্কশপ উন্নয়নের জন্য এর সংরক্ষণে সম্মতি দিচ্ছি।",
      "s18.kicker": "ওয়ার্কশপ মতামত · ৫টি প্রশ্ন",
      "s18.title": "ওয়ার্কশপ কেমন ছিল?",
      "s18.q1.h": "সামগ্রিকভাবে ওয়ার্কশপের অভিজ্ঞতা আপনি কীভাবে মূল্যায়ন করবেন?",
      "s18.q1.hint": "১ = একদম উপকারী নয় · ১০ = জীবন বদলে দেওয়া",
      "s18.q2.h": "এই ওয়ার্কশপটি সহকর্মী বা বন্ধুকে সুপারিশ করার সম্ভাবনা কতটুকু?",
      "s18.q2.hint": "০ = একদমই সম্ভাবনা নেই · ১০ = অত্যন্ত সম্ভাবনা",
      "s18.q3.h": "আপনি সঙ্গে নিয়ে যাবেন এমন সবচেয়ে মূল্যবান অন্তর্দৃষ্টি বা কৌশলটি কী ছিল?",
      "s18.q3.hint": "এক-দুই বাক্যে। আপনার কথা অন্যদের এই ওয়ার্কশপ খুঁজে পেতে সাহায্য করতে পারে।",
      "s18.q4.h": "আজকের পর আপনি কী ভিন্নভাবে করা শুরু করবেন?",
      "s18.q4.hint": "আগামী ৭ দিনের মধ্যে শুরু করবেন এমন একটি সুনির্দিষ্ট পরিবর্তন।",
      "s18.q5.h": "ভবিষ্যৎ ওয়ার্কশপে কোন বিষয়গুলো দেখতে চান?",
      "s18.q5.hint": "আগ্রহের যেকোনোটিতে চাপুন, অথবা নিচে নিজের মত লিখুন।",
      "s18.consent": "অন্যদের এই ওয়ার্কশপ খুঁজে পেতে সাহায্য করতে ProfessionalsTalk আমার মতামত (নাম প্রকাশ করে বা না করে) শেয়ার করতে পারে—এতে আমি সম্মত।",
      "s19.kicker": "সমাপনী সনদ",
      "s19.title": "আপনার সনদ প্রস্তুত",
      "cert.issuer.k": "প্রদানকারী",
      "cert.workshop.k": "ওয়ার্কশপ",
      "cert.workshop.v": "Hope as a Skill · ৩ ঘণ্টা",
      "cert.verify.k": "যাচাই",
      "nav.sessionflow": "সেশন প্রবাহ",
      "nav.opening": "সূচনা",
      "nav.science": "আশার বিজ্ঞান",
      "nav.daily": "দৈনন্দিন আশা গঠন",
      "nav.action": "কর্ম পরিকল্পনা",
      "nav.frameworks": "কাঠামো",
      "nav.snyder": "স্নাইডারের আশার তত্ত্ব",
      "nav.hopemodel": "HOPE অ্যাকশন মডেল",
      "nav.hdps": "HDPS সিস্টেম",
      "nav.duration": "৩ ঘণ্টা · ২০২৬",
      "theme.light": "লাইট মোড",
      // ---- Organizational slides ----
      "o1.kicker": "প্রাতিষ্ঠানিক দৃষ্টিভঙ্গি",
      "o1.title": "যখন আশা কমে যায়",
      "o1.sub": "কর্মীর স্বাস্থ্য, কল্যাণ ও প্রতিষ্ঠানের পারফরম্যান্সে এর লুকানো মূল্য।",
      "o1.q.h": "মূল প্রশ্ন",
      "o1.q.p": "যখন কর্মীরা উন্নতি, বিকাশ বা একটি উন্নত ভবিষ্যৎ সম্ভব—এই বিশ্বাস হারিয়ে ফেলে, তখন কী ঘটে?",
      "o2.kicker": "অনুশীলন — ভাবুন ও শেয়ার করুন",
      "o2.title": "আপনার উত্তর লিখুন",
      "o2.lede": "নিচের প্রশ্নের উত্তর লিখুন। আপনি শেষে জমা দিলে আপনার উত্তর সংরক্ষিত হয় ও ফ্যাসিলিটেটরের কাছে যায়।",
      "o2.q": "যখন কর্মীরা একটি উন্নত ভবিষ্যৎ সম্ভব—এই বিশ্বাস হারিয়ে ফেলে, তখন কী ঘটে?",
      "o3.kicker": "বিজ্ঞান",
      "o3.title": "আশা শুধু ইতিবাচক চিন্তা নয়",
      "o3.lede": "মনোবিজ্ঞানে আশা পরিমাপযোগ্য সক্ষমতার সাথে যুক্ত। এটি কমে গেলে নির্দিষ্ট কিছু ঝুঁকি বেড়ে যায়।",
      "o3.hi.label": "আশা সম্পর্কিত",
      "o3.hi.1": "ভবিষ্যৎমুখিতা",
      "o3.hi.2": "লক্ষ্য অনুসরণ",
      "o3.hi.3": "মোকাবিলার সক্ষমতা",
      "o3.hi.4": "নিয়ন্ত্রণের অনুভূতি",
      "o3.hi.5": "অনুপ্রেরণা",
      "o3.lo.label": "নিম্ন আশা সম্পর্কিত",
      "o3.lo.1": "দীর্ঘস্থায়ী চাপ",
      "o3.lo.2": "অনিশ্চয়তা",
      "o3.lo.3": "আটকে যাওয়া লক্ষ্য",
      "o3.lo.4": "কম নিয়ন্ত্রণ",
      "o4.kicker": "অনুশীলন — শীর্ষ ৩টি বাছুন",
      "o4.title": "কর্মক্ষেত্রের অদৃশ্য ঝুঁকি-শৃঙ্খল",
      "o4.lede": "নিম্ন আশা একটি শৃঙ্খল-প্রতিক্রিয়া শুরু করে। কর্মক্ষেত্রে আপনি কোন ধাপগুলো সবচেয়ে বেশি দেখেন? শীর্ষ ৩টি বাছুন—আপনার নির্বাচন সংরক্ষিত হয়।",
      "o4.n1": "নিম্ন আশা",
      "o4.n2": "ভবিষ্যৎ আত্মবিশ্বাসের অভাব",
      "o4.n3": "দীর্ঘস্থায়ী চাপের বোঝা",
      "o4.n4": "মানসিক ক্লান্তি",
      "o4.n5": "আচরণ পরিবর্তন",
      "o4.n6": "পারফরম্যান্স সমস্যা",
      "o4.n7": "প্রাতিষ্ঠানিক স্বাস্থ্য চ্যালেঞ্জ",
      "o4.pick": "উপরের সর্বোচ্চ ৩টি ধাপে চাপুন",
      "o4.your": "আপনার শীর্ষ ৩টি নির্বাচন",
      "o4.empty": "যোগ করতে উপরের শৃঙ্খলের ধাপগুলোতে চাপুন।",
      "o5.kicker": "স্বাস্থ্যের প্রভাব",
      "o5.title": "মানসিক স্বাস্থ্যে প্রভাব",
      "o5.lede": "যখন আশা মানসিকভাবে দুর্বল হয়, তখন সাধারণত এই লক্ষণগুলো দেখা দেয়:",
      "o5.1": "মানসিক অবসাদ",
      "o5.2": "উদ্বেগের লক্ষণ",
      "o5.3": "অনুপ্রেরণা হ্রাস",
      "o5.4": "অসহায়ত্বের চিন্তা",
      "o5.5": "স্থিতিস্থাপকতা হ্রাস",
      "o5.6": "বার্নআউটের ঝুঁকি",
      "o6.kicker": "স্বাস্থ্যের প্রভাব",
      "o6.title": "শারীরিক স্বাস্থ্যে প্রভাব",
      "o6.lede": "আশা কি শুধু আবেগীয়? এটি প্রকৃত শারীরবৃত্তীয় ব্যবস্থার মাধ্যমে শরীরেও প্রভাব ফেলে।",
      "o6.sym.label": "সাধারণ শারীরিক লক্ষণ",
      "o6.s.1": "ঘুমের নিম্নমান",
      "o6.s.2": "ক্লান্তি",
      "o6.s.3": "পেশির টান",
      "o6.s.4": "মাথাব্যথা",
      "o6.s.5": "হজমের অস্বস্তি",
      "o6.s.6": "মনোযোগে সমস্যা",
      "o6.s.7": "পুনরুদ্ধার ক্ষমতা হ্রাস",
      "o6.sys.label": "প্রভাবিত শারীরবৃত্তীয় ব্যবস্থা",
      "o6.y.1": "কর্টিসল নিয়ন্ত্রণ",
      "o6.y.2": "ঘুম ব্যবস্থা",
      "o6.y.3": "হৃদ-সংবহন চাপ",
      "o6.y.4": "রোগ প্রতিরোধ ক্ষমতা",
      "o6.y.5": "শক্তি নিয়ন্ত্রণ",
      "o7.kicker": "কর্মীর উপর প্রভাব",
      "o7.title": "কর্মীর কল্যাণে প্রভাব",
      "o7.lede": "আশা ছাড়া কর্মীরা তিনটি জিনিস হারাতে পারে যা তাদের নিয়োজিত রাখে:",
      "o7.d.h": "দিকনির্দেশনা",
      "o7.d.q": "“আমি জানি না আমি কোথায় যাচ্ছি।”",
      "o7.m.h": "অর্থ",
      "o7.m.q": "“আমার কাজ অর্থহীন মনে হয়।”",
      "o7.a.h": "সক্ষমতা",
      "o7.a.q": "“আমি যা-ই করি কিছুতেই কিছু আসে যায় না।”",
      "o7.out.label": "সম্ভাব্য আচরণগত ফলাফল",
      "o7.o1": "উপস্থিত থেকেও নিষ্ক্রিয়তা",
      "o7.o2": "শেখা হ্রাস",
      "o7.o3": "উদ্যোগের অভাব",
      "o7.o4": "আবেগীয় দূরত্ব",
      "o7.o5": "সৃজনশীলতা হ্রাস",
      "o8.kicker": "ব্যবসায়িক প্রভাব",
      "o8.title": "প্রাতিষ্ঠানিক স্বাস্থ্য ব্যয়",
      "o8.lede": "নিম্ন কর্মক্ষেত্র-আশা নীরবে পুরো প্রতিষ্ঠান জুড়ে ব্যয় ও ঝুঁকি বাড়িয়ে দেয়।",
      "o8.c1.h": "উৎপাদনশীলতা ঝুঁকি",
      "o8.c1.p": "ধীর বাস্তবায়ন, কম দায়িত্ববোধ, অভিযোজন ক্ষমতা হ্রাস।",
      "o8.c2.h": "বার্নআউট ঝুঁকি",
      "o8.c2.p": "মানসিক অবসাদ ও পারফরম্যান্সের অবনতি।",
      "o8.c3.h": "কর্মী ধরে রাখার ঝুঁকি",
      "o8.c3.p": "“এখানে আমি কোনো ভবিষ্যৎ দেখি না।”—এবং তারা চলে যায়।",
      "o8.c4.h": "নিরাপত্তা ও গুণমান ঝুঁকি",
      "o8.c4.p": "ক্লান্তি ও কম মনোযোগ ত্রুটি, নিরাপত্তা ঘাটতি ও ত্রুটিপূর্ণ পণ্য বাড়ায়।",
      "o8.c5.h": "স্বাস্থ্যসেবা ও ব্যয় ঝুঁকি",
      "o8.c5.p": "বেশি অসুস্থতাজনিত ছুটি, অনুপস্থিতি, কর্মী প্রতিস্থাপন ব্যয় ও উৎপাদনশীলতা ক্ষতি।",
      "o9.kicker": "তুলনা",
      "o9.title": "দুটি প্রতিষ্ঠানের তুলনা",
      "o9.lede": "একই বাজার, একই চাপ—কিন্তু আশা প্রতিটি প্রতিষ্ঠানের পারফরম্যান্সের সবকিছু বদলে দেয়।",
      "o9.a.label": "কোম্পানি A",
      "o9.a.1": "কম আস্থা",
      "o9.a.2": "কম স্বীকৃতি",
      "o9.a.3": "উচ্চ চাপ",
      "o9.a.4": "অস্পষ্ট ভবিষ্যৎ",
      "o9.a.say": "কর্মীরা বলে: “কোনোমতে টিকে থাকো।”",
      "o9.a.result": "ফলাফল: চাপ, বার্নআউট, উচ্চ কর্মী ছাঁটাই।",
      "o9.b.label": "কোম্পানি B",
      "o9.b.1": "স্পষ্ট লক্ষ্য",
      "o9.b.2": "সহায়ক নেতৃত্ব",
      "o9.b.3": "বিকাশের পথ",
      "o9.b.4": "অর্থপূর্ণ কাজ",
      "o9.b.say": "কর্মীরা বলে: “আমরা সমস্যা সমাধান করতে পারি।”",
      "o9.b.result": "ফলাফল: উন্নত সম্পৃক্ততা, অভিযোজন ক্ষমতা, পারফরম্যান্স স্থিতিস্থাপকতা।",
      "nav.org": "প্রাতিষ্ঠানিক প্রভাব",
      // ---- Cinematic slides ----
      "c1.kicker": "দৃশ্য ১ · জীবন থেকে নেওয়া গল্প",
      "c1.head1": "দুজন কর্মী।",
      "c1.head2": "একই মঙ্গলবার।",
      "c1.head3": "একই ছাঁটাইয়ের চিঠি।",
      "c1.sub": "সংকট ছিল একইরকম। ছয় সপ্তাহ পর তাদের জীবন কিন্তু এক রইল না।",
      "c1.a.label": "মি. A",
      "c1.a.tag": "ছয় সপ্তাহ পর",
      "c1.a.b1": "আবেদন বন্ধ করলেন। \"কী লাভ?\"",
      "c1.a.b2": "পরিবারের আলাপ থেকে দূরে সরে গেলেন।",
      "c1.a.b3": "ঘুম কমে গেল। আত্মবিশ্বাস হারালেন।",
      "c1.a.b4": "এগিয়ে যাওয়ার কোনো পথ দেখলেন না।",
      "c1.b.label": "মিস B",
      "c1.b.tag": "ছয় সপ্তাহ পর",
      "c1.b.b1": "কাগজে ৩টি লক্ষ্য লিখলেন।",
      "c1.b.b2": "একটি ছোট অনলাইন কোর্স করলেন।",
      "c1.b.b3": "সপ্তাহে ৫ জন পুরনো সহকর্মীকে ফোন করলেন।",
      "c1.b.b4": "ছয় সপ্তাহের মধ্যেই চাকরির প্রস্তাব পেলেন।",
      "c1.close": "একই সংকট। ভিন্ন আশার দক্ষতা।",
      "c2.kicker": "বিরতি · ৬০ সেকেন্ড",
      "c2.head": "চোখ বন্ধ করুন।",
      "c2.prompt": "এমন একটি মুহূর্ত মনে করুন যখন আপনি প্রায় হাল ছেড়ে দিচ্ছিলেন—কিন্তু দেননি। কী আপনাকে এগিয়ে যেতে সাহায্য করেছিল?",
      "c2.counter": "শ্বাস নিন… ছাড়ুন। <strong>ষাট সেকেন্ড</strong> নীরবতা।",
      "c3.kicker": "মধ্যবিরতি · কর্মক্ষেত্রের দুটি দৃশ্য",
      "c3.title": "চাপের নিচে আশা কেমন দেখায়",
      "c3.lede": "একই সংকট। দুজন নেতা। লক্ষ্য করুন কী পাল্টায়।",
      "c3.s1.num": "দৃশ্য ১ — ডেডলাইন",
      "c3.s1.title": "যখন আশা চুপচাপ ঘর ছেড়ে চলে যায়",
      "c3.s1.b1": "অসম্ভব এক লক্ষ্য দলের ঘাড়ে চাপিয়ে দেওয়া হলো।",
      "c3.s1.b2": "ম্যানেজার ফ্লোরকে দোষ দেন। ফ্লোর একে অপরকে।",
      "c3.s1.b3": "মি. খান নতুন আইডিয়া দেওয়া বন্ধ করে দেন।",
      "c3.s1.b4": "শুক্রবার নাগাদ দলের অর্ধেক নীরবে কাজ ছাড়ার মনস্থির করেছে।",
      "c3.s1.out": "আশা ঘর ছেড়ে যায়। পারফরম্যান্সও সাথে যায়।",
      "c3.s2.num": "দৃশ্য ২ — সিদ্ধান্ত",
      "c3.s2.title": "যখন একজন নেতা পরিবেশটাই বদলে দেন",
      "c3.s2.b1": "একই চাপ। ভিন্ন নেতা।",
      "c3.s2.b2": "একটি স্পষ্ট লক্ষ্য বলেন—এবং কেন তা গুরুত্বপূর্ণ।",
      "c3.s2.b3": "দলকে বেছে নিতে দুটি ভিন্ন পথ দেন।",
      "c3.s2.b4": "প্রতিদিন ৫ মিনিটের অর্জন একটি যৌথ বোর্ডে লেখা হয়।",
      "c3.s2.out": "আশা আবার ঘরে ফেরে। মানুষ আবার যুক্ত হয়।",
      "c3.close": "সংকট পাল্টায়নি। নেতৃত্ব পাল্টেছে।",
      "c4.kicker": "দলগত চ্যালেঞ্জ · সরাসরি সিমুলেশন",
      "c4.title": "একটি আশা কৌশল গড়ুন — ১০ মিনিটে",
      "c4.timer": "১০ মিনিট",
      "c4.brief.label": "আপনার মিশন",
      "c4.brief.text": "আপনার দলকে একটি সংকট আঘাত করেছে। H·O·P·E কাঠামো ব্যবহার করে—একসাথে—পরবর্তী ১০ মিনিটে একটি আশা-চালিত প্রতিক্রিয়া তৈরি করুন।",
      "c4.choose": "দল হিসেবে সমাধানের জন্য একটি সংকট বেছে নিন:",
      "c4.opt1": "হঠাৎ ৩০% বাজেট কমে যাওয়া",
      "c4.opt2": "একজন সিনিয়র নেতার পদত্যাগ",
      "c4.opt3": "আপনার সবচেয়ে বড় ক্লায়েন্ট সম্পর্ক ছিন্ন করেছেন",
      "c4.h.word": "চিহ্নিত করুন",
      "c4.h.prompt": "এই সংকটে একটি বাস্তবসম্মত লক্ষ্য।",
      "c4.o.word": "পর্যবেক্ষণ করুন",
      "c4.o.prompt": "দলের পথে দুটি বড় বাধা।",
      "c4.p.word": "পরিকল্পনা করুন",
      "c4.p.prompt": "এগিয়ে যাওয়ার তিনটি ভিন্ন পথ।",
      "c4.e.word": "বাস্তবায়ন করুন",
      "c4.e.prompt": "শুক্রবারের মধ্যে যে একটি কাজ আপনার দল করবে।",
      "c4.input.label": "আপনার দলের আশা কৌশল লিখুন (ফ্যাসিলিটেটরের কাছে সংরক্ষিত হবে)",
      "c4.input.ph": "লক্ষ্য:\nবাধা:\nতিনটি পথ:\nশুক্রবারের কাজ:",
      // ---- Cinematic cold open (slide 1) ----
      "cold.presents": "ProfessionalsTalk উপস্থাপন",
      "cold.title": "আশা।",
      "cold.subtitle": "একটি দক্ষতা হিসেবে",
      "cold.tagline": "তিন ঘণ্টা। একটি দক্ষতা—সারাজীবন।",
      "cold.chapter": "অধ্যায় এক",

      // ---- New slides 3 & 4 (problem + struggle) ----
      "prob.kicker": "অঙ্ক ১ · সমস্যা",
      "prob.q1": "কী ঘটে",
      "prob.q2": "যখন কর্মীরা",
      "prob.q3": "আশা হারিয়ে ফেলে?",
      "prob.sub": "৬০ সেকেন্ড নিন। যা দেখেছেন তা লিখুন—একটি বাক্য বা একাধিক, কমা দিয়ে আলাদা করে।",
      "prob.label": "আপনার পর্যবেক্ষণ",
      "prob.ph": "যেমন: মানুষ নতুন আইডিয়া দেওয়া বন্ধ করে, অসুস্থতাজনিত ছুটি বাড়ে, ভালো কর্মীরা চুপচাপ চলে যায়…",
      "prob.share": "সবার সাথে শেয়ার করুন",
      "prob.voices": "ঘরের সকলের কণ্ঠস্বর",
      "prob.empty": "মানুষ শেয়ার করলে তাদের কথাগুলো এখানে—লাইভ—দেখা যাবে।",
      "strug.kicker": "অঙ্ক ১ · সংগ্রাম",
      "strug.title": "সংগ্রাম",
      "strug.lede": "এগুলোই সেই ঝড়, যা নীরবে কর্মক্ষেত্র থেকে আশা শুষে নেয়। যা যা অনুভব করেছেন তাতে চাপুন—আপনার নির্বাচন আপনার উত্তরের সাথে সংরক্ষিত হবে।",
      "strug.1": "অনিশ্চয়তা",
      "strug.2": "চাপ",
      "strug.3": "ছাঁটাই / চাকরিচ্যুতি",
      "strug.4": "অসম্ভব KPI",
      "strug.5": "নেতৃত্বের দ্বন্দ্ব",
      "strug.have": "আপনি কি এটি অনুভব করেছেন?",
      "strug.hint": "যেগুলো প্রযোজ্য তাতে চাপুন—আপনার নির্বাচন আপনার উত্তরের সাথে সংরক্ষিত হবে।",
      // ---- HopeXP gamification ----
      "xp.rank.0": "শিক্ষানবিশ",
      "xp.rank.1": "অনুসন্ধানী",
      "xp.rank.2": "নির্মাতা",
      "xp.rank.3": "কৌশলবিদ",
      "xp.rank.4": "আশার স্থপতি",
      "xp.badge.unlocked": "অর্জন আনলক হলো",
      "xp.badge.storyteller.n": "গল্পকার",
      "xp.badge.storyteller.d": "সকলের সাথে নিজের কণ্ঠস্বর শেয়ার করেছেন।",
      "xp.badge.explorer.n": "অনুসন্ধানী",
      "xp.badge.explorer.d": "কর্মক্ষেত্রের তিন বা ততোধিক সংগ্রাম শনাক্ত করেছেন।",
      "xp.badge.mapper.n": "আশার মানচিত্রকার",
      "xp.badge.mapper.d": "একটি লক্ষ্য, দুটি পথ ও একটি কাজ মানচিত্রিত করেছেন।",
      "xp.badge.reframer.n": "পুনর্বিন্যাসকারী",
      "xp.badge.reframer.d": "তিনটি নেতিবাচক চিন্তাকে আশাবাদী চিন্তায় রূপান্তর করেছেন।",
      "xp.badge.strategist.n": "কৌশলবিদ",
      "xp.badge.strategist.d": "চাপের মধ্যে একটি দলগত আশা-কৌশল তৈরি করেছেন।",
      "xp.badge.hero.n": "কর্ম-নায়ক",
      "xp.badge.hero.d": "এই সপ্তাহের জন্য একটি বাস্তব কাজে প্রতিশ্রুতি দিয়েছেন।",
      "xp.badge.architect.n": "আশার স্থপতি",
      "xp.badge.architect.d": "কর্মশালা সম্পন্ন করেছেন এবং আপনার পরিকল্পনা জমা দিয়েছেন।",

      "cert.journey": "আপনার আশার যাত্রা",
      "cert.earned": "অর্জিত",
      "cert.reached": "পৌঁছেছেন",

    },
  };

  // In-memory source of truth for the active language. localStorage is used
  // only for persistence — if it's unavailable (incognito, blocked cookies,
  // sandboxed iframe), the toggle still works via this variable.
  let _currentLang = "en";
  try {
    const saved = localStorage.getItem(I18N_KEY);
    if (saved === "en" || saved === "bn") _currentLang = saved;
  } catch (e) {}

  function getLang() {
    return _currentLang;
  }

  function applyTranslations(lang) {
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = dict[key];
      if (typeof val === "string") {
        // Use innerHTML when the translation contains markup (e.g. <em>, <strong>,
        // <br>, <span>); otherwise textContent for safety/speed.
        if (val.indexOf("<") !== -1) el.innerHTML = val;
        else el.textContent = val;
      }
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      const val = dict[key];
      if (typeof val === "string") el.setAttribute("placeholder", val);
    });
    // Update language toggle button display
    const cur = document.getElementById("langCurrent");
    const alt = document.getElementById("langAlt");
    const btn = document.getElementById("langToggle");
    if (cur && alt && btn) {
      cur.textContent = lang === "bn" ? "বাং" : "EN";
      alt.textContent = lang === "bn" ? "English" : "বাংলা";
      btn.setAttribute("data-lang", lang);
    }
  }

  function setLang(lang) {
    if (!TRANSLATIONS[lang]) lang = "en";
    _currentLang = lang;                 // update in-memory state first
    try { localStorage.setItem(I18N_KEY, lang); } catch (e) {}
    applyTranslations(lang);
  }

  // Wire toggle + initial apply
  const langToggle = document.getElementById("langToggle");
  if (langToggle) {
    langToggle.addEventListener("click", () => {
      setLang(getLang() === "bn" ? "en" : "bn");
    });
  }
  applyTranslations(getLang());

  // Expose for dynamically-created content (e.g. risk-chain selection pills)
  window.__applyI18n = function () { applyTranslations(getLang()); };

  // ---------------------------------------------------------------------------
  // PASSWORD GATE
  // ---------------------------------------------------------------------------
  const PASSWORD_KEY = "hope_workshop_unlocked_v1";
  const passwordGate = document.getElementById("passwordGate");
  const passwordForm = document.getElementById("passwordForm");
  const passwordInput = document.getElementById("passwordInput");
  const passwordError = document.getElementById("passwordError");
  const passwordToggle = document.getElementById("passwordToggle");
  const passwordCard = passwordGate ? passwordGate.querySelector(".password-card") : null;

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const BATCH_KEY = "hope_workshop_batch_v1";

  // Validate an entered access code against the configured batch codes and
  // the master admin code. Returns { ok, batch, isAdmin, reason }.
  async function validateAccessCode(plainCode) {
    const cfg = window.HOPE_CONFIG || {};
    const hash = (await sha256Hex(plainCode)).toLowerCase();

    // 1) Master admin code — always valid, never expires
    const adminHash = (cfg.ADMIN_PASSWORD_HASH || cfg.WORKSHOP_PASSWORD_HASH || "").toLowerCase();
    if (adminHash && hash === adminHash) {
      return { ok: true, batch: "Admin", isAdmin: true };
    }

    // 2) Per-batch codes
    const batches = Array.isArray(cfg.BATCH_CODES) ? cfg.BATCH_CODES : [];
    for (const b of batches) {
      if (!b || !b.hash) continue;
      if (hash !== String(b.hash).toLowerCase()) continue;
      // Matched this batch — check active flag + expiry
      if (b.active === false) return { ok: false, reason: "disabled", batch: b.name };
      if (b.expires) {
        const exp = new Date(String(b.expires) + "T23:59:59");
        if (!isNaN(exp.getTime()) && exp < new Date()) {
          return { ok: false, reason: "expired", batch: b.name };
        }
      }
      return { ok: true, batch: b.name || "Batch" };
    }

    // 3) Back-compat: a lone WORKSHOP_PASSWORD_HASH (old single-password setups)
    const legacy = (cfg.WORKSHOP_PASSWORD_HASH || "").toLowerCase();
    if (!batches.length && legacy && hash === legacy) {
      return { ok: true, batch: "Workshop" };
    }

    return { ok: false, reason: "unknown" };
  }

  function rememberBatch(name) {
    try { localStorage.setItem(BATCH_KEY, name || ""); } catch (e) {}
    window.__batchName = name || "";
  }
  function getRememberedBatch() {
    if (window.__batchName) return window.__batchName;
    try { return localStorage.getItem(BATCH_KEY) || ""; } catch (e) { return ""; }
  }

  function unlockWorkshop(persist) {
    if (!passwordGate) return;
    passwordGate.classList.add("hidden");
    setTimeout(() => { passwordGate.style.display = "none"; }, 450);
    if (persist) {
      try { localStorage.setItem(PASSWORD_KEY, "ok"); } catch (e) { /* ignore */ }
    }
    // Focus the first slide for accessibility
    const first = slides[0];
    if (first) {
      first.setAttribute("tabindex", "-1");
      setTimeout(() => first.focus({ preventScroll: true }), 450);
    }
  }

  // If user previously unlocked, skip the gate
  try {
    if (localStorage.getItem(PASSWORD_KEY) === "ok" && passwordGate) {
      passwordGate.style.display = "none";
    } else if (passwordInput) {
      // Autofocus the input after the fade-in animation
      setTimeout(() => passwordInput.focus(), 700);
    }
  } catch (e) { /* ignore */ }

  if (passwordForm) {
    passwordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const value = (passwordInput.value || "").trim();
      const cfg = window.HOPE_CONFIG || {};
      const hasAnyCode = (Array.isArray(cfg.BATCH_CODES) && cfg.BATCH_CODES.length) ||
                         cfg.ADMIN_PASSWORD_HASH || cfg.WORKSHOP_PASSWORD_HASH;

      if (!value) {
        showPasswordError("Please enter your access code.");
        return;
      }
      if (!hasAnyCode) {
        // No codes configured at all = no gate (developer convenience)
        unlockWorkshop(true);
        return;
      }

      try {
        const result = await validateAccessCode(value);
        if (result.ok) {
          rememberBatch(result.batch);
          passwordError.classList.remove("show");
          unlockWorkshop(true);
        } else if (result.reason === "expired") {
          showPasswordError("This access code has expired. Please contact your facilitator for a current code.");
          passwordInput.select();
        } else if (result.reason === "disabled") {
          showPasswordError("This access code is no longer active. Please contact your facilitator.");
          passwordInput.select();
        } else {
          showPasswordError("Incorrect access code. Please check with your facilitator.");
          passwordInput.value = "";
          passwordInput.focus();
        }
      } catch (err) {
        showPasswordError("Could not verify access code. " + err.message);
      }
    });
  }

  function showPasswordError(msg) {
    if (!passwordError) return;
    passwordError.textContent = msg;
    passwordError.classList.add("show");
    if (passwordCard) {
      passwordCard.classList.remove("password-shake");
      // force reflow to restart animation
      void passwordCard.offsetWidth;
      passwordCard.classList.add("password-shake");
    }
  }

  if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener("click", () => {
      const isPassword = passwordInput.type === "password";
      passwordInput.type = isPassword ? "text" : "password";
      passwordInput.focus();
    });
  }

  // ---------------------------------------------------------------------------
  // CERTIFICATE GENERATION
  // ---------------------------------------------------------------------------
  const certPreview = document.getElementById("certPreview");
  const certIntro = document.getElementById("certIntro");
  const downloadCertBtn = document.getElementById("downloadCertBtn");
  const printCertBtn = document.getElementById("printCertBtn");

  // Current certificate state
  let currentCert = null; // { svg, name, id, date, hki }

  // Cert ID derived from name + timestamp + content (stable per submission)
  function buildCertId(name) {
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
    // simple, non-secure hash of the name (just for visual variety)
    let h = 0;
    for (let i = 0; i < name.length; i++) {
      h = (h * 31 + name.charCodeAt(i)) >>> 0;
    }
    const tag = h.toString(36).toUpperCase().slice(0, 5).padStart(5, "0");
    return `HW-${ymd}-${tag}`;
  }

  function formatLongDate(d) {
    const months = ["January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December"];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  // Build a constellation pattern (deterministic from string)
  function constellationDots(seed) {
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    function rand() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
    const dots = [];
    for (let i = 0; i < 38; i++) {
      const x = rand() * 1600;
      const y = rand() * 1131;
      const r = 0.7 + rand() * 1.6;
      const o = 0.06 + rand() * 0.18;
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#0a0e1a" opacity="${o.toFixed(2)}"/>`);
    }
    return dots.join("");
  }

  // SVG-safe escape
  function escapeXml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  // Dynamic font sizing for participant name
  function fitNameSize(name) {
    const len = (name || "").length;
    if (len <= 14) return 96;
    if (len <= 20) return 82;
    if (len <= 28) return 68;
    if (len <= 36) return 56;
    return 48;
  }

  function buildCertificateSVG(opts) {
    // ── Compute the "Hope Journey" panel from saved HopeXP state ──
    let __xpVal = 0, __rankIdx = 0;
    try {
      const raw = localStorage.getItem("hope_xp_v1");
      if (raw) { const st = JSON.parse(raw); __xpVal = Math.max(0, parseInt(st.xp || 0, 10)); }
    } catch (e) {}
    const __ranks = [
      { min:0,   name:"Novice",            color:"#7b8cf5" },
      { min:25,  name:"Explorer",          color:"#6dd5c5" },
      { min:70,  name:"Builder",           color:"#a3d977" },
      { min:140, name:"Strategist",        color:"#f5b97b" },
      { min:220, name:"Architect of Hope", color:"#f57b8c" }
    ];
    for (let i = 0; i < __ranks.length; i++) {
      if (__xpVal >= __ranks[i].min) __rankIdx = i;
    }
    // Build the panel: centered at SVG x=800, y=870. 5 dots evenly spaced.
    const __positions = [-340, -170, 0, 170, 340];
    const __dotsSvg = __ranks.map((r, i) => {
      const x = __positions[i];
      const achieved = i <= __rankIdx;
      const ringStroke = achieved ? r.color : "#0a0e1a";
      const ringOp     = achieved ? 1 : 0.18;
      const fillColor  = achieved ? r.color : "#ffffff";
      const fillOp     = achieved ? 1 : 1;
      const labelOp    = achieved ? 1 : 0.4;
      const labelWeight = (i === __rankIdx) ? 700 : 500;
      const goldRing = (i === __rankIdx)
        ? `<circle cx="${x}" cy="0" r="14" fill="none" stroke="#f5b97b" stroke-width="1.5" opacity="0.85"/>
           <circle cx="${x}" cy="0" r="18" fill="none" stroke="#f5b97b" stroke-width="0.6" opacity="0.4" stroke-dasharray="2,2"/>`
        : "";
      return `
        ${goldRing}
        <circle cx="${x}" cy="0" r="9" fill="${fillColor}" fill-opacity="${fillOp}" stroke="${ringStroke}" stroke-width="2" opacity="${achieved ? 1 : 0.5}"/>
        ${achieved && i < __rankIdx ? `<text x="${x}" y="3.5" text-anchor="middle" font-size="9" font-weight="700" fill="#ffffff">✓</text>` : ""}
        <text x="${x}" y="28" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" letter-spacing="0.10em" fill="#0a0e1a" opacity="${labelOp}" font-weight="${labelWeight}">${r.name.toUpperCase()}</text>
      `;
    }).join("");
    const __activeRankName = __ranks[__rankIdx].name;
    const journeyPanelSVG = `
  <g transform="translate(800, 858)">
    <text x="0" y="-22" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" letter-spacing="0.32em" fill="#0a0e1a" opacity="0.4">YOUR HOPE JOURNEY</text>
    <line x1="-340" y1="0" x2="340" y2="0" stroke="#0a0e1a" stroke-width="1" opacity="0.18"/>
    ${__dotsSvg}
    <text x="0" y="44" text-anchor="middle" font-family="Fraunces, serif" font-style="italic" font-size="13" fill="#0a0e1a"><tspan opacity="0.7">Earned\u00a0</tspan><tspan font-weight="600" font-style="normal" opacity="1">${__xpVal}\u00a0XP</tspan><tspan opacity="0.45">\u00a0\u00a0\u2014\u00a0\u00a0</tspan><tspan opacity="0.7">Reached\u00a0</tspan><tspan font-weight="600" font-style="normal" opacity="1">${__activeRankName}</tspan></text>
  </g>`;

    const name = (opts.name && opts.name.trim()) || "Participant";
    const date = opts.date || new Date();
    const certId = opts.certId || buildCertId(name);
    const hki = opts.hki || "—";
    const issuer = (window.HOPE_CONFIG?.ISSUER_NAME) || "ProfessionalsTalk";
    const issuerUrl = (window.HOPE_CONFIG?.ISSUER_URL) || "www.professionalstalk.me";
    const issuerTagline = (window.HOPE_CONFIG?.ISSUER_TAGLINE) || "";
    const nameSize = fitNameSize(name);

    const dateLong = formatLongDate(date);
    const dots = constellationDots(certId + name);

    // Inline Google Fonts via @import inside SVG <defs><style>. Note: when
    // rasterizing to canvas we'll embed fonts; while previewing in-page the
    // browser already has them loaded from the page-level <link>.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1131" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Certificate of Completion for ${escapeXml(name)}">
  <defs>
    <linearGradient id="aurora" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f5a37b"/>
      <stop offset="22%" stop-color="#f5b97b"/>
      <stop offset="44%" stop-color="#a3d977"/>
      <stop offset="66%" stop-color="#6dd5c5"/>
      <stop offset="88%" stop-color="#7b8cf5"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>
    <linearGradient id="auroraFade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="40%" stop-color="#000" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#000" stop-opacity="1"/>
    </linearGradient>
    <radialGradient id="seal" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1a2138"/>
      <stop offset="70%" stop-color="#0a0e1a"/>
      <stop offset="100%" stop-color="#060912"/>
    </radialGradient>
    <linearGradient id="sealRim" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f5b97b"/>
      <stop offset="50%" stop-color="#d4a85a"/>
      <stop offset="100%" stop-color="#b88842"/>
    </linearGradient>
    <linearGradient id="rays" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#f5b97b" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#f5b97b" stop-opacity="0"/>
    </linearGradient>
    <mask id="auroraMask">
      <rect width="1600" height="380" fill="url(#auroraFade)" transform="scale(1,-1) translate(0,-380)"/>
    </mask>
    <pattern id="microGrid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#0a0e1a" stroke-width="0.4" opacity="0.05"/>
    </pattern>
  </defs>

  <!-- Paper background -->
  <rect width="1600" height="1131" fill="#faf6ee"/>
  <rect width="1600" height="1131" fill="url(#microGrid)"/>

  <!-- Subtle constellation -->
  ${dots}

  <!-- Aurora ribbon at top -->
  <g mask="url(#auroraMask)">
    <rect x="0" y="0" width="1600" height="380" fill="url(#aurora)" opacity="0.95"/>
  </g>
  <rect x="0" y="376" width="1600" height="2" fill="#0a0e1a" opacity="0.08"/>

  <!-- Rays behind name -->
  <g opacity="0.35" transform="translate(800,580)">
    <polygon points="0,-340 -260,200 260,200" fill="url(#rays)"/>
    <polygon points="0,-340 -180,200 180,200" fill="url(#rays)"/>
  </g>

  <!-- Inner border -->
  <rect x="44" y="44" width="1512" height="1043" rx="14" fill="none" stroke="#0a0e1a" stroke-width="1" opacity="0.18"/>
  <rect x="56" y="56" width="1488" height="1019" rx="10" fill="none" stroke="#0a0e1a" stroke-width="0.5" opacity="0.1"/>

  <!-- Top brand row -->
  <g transform="translate(96,108)">
    <rect x="0" y="0" width="48" height="48" rx="12" fill="#0a0e1a"/>
    <defs><clipPath id="brandLogoClip"><rect x="12" y="12" width="24" height="24" rx="5"/></clipPath></defs><image x="12" y="12" width="24" height="24" preserveAspectRatio="xMidYMid slice" clip-path="url(#brandLogoClip)" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAGfElEQVR4nOWaXWxcRxXHf2fm3ru2d9d2Q5KatChR6QOQhC+BhEgJNJXcNE0/lCithIQaXkAQ8g68RKFSoQ8oAYlKqBIfFfDQCKlyQmyTiCAk1JK2itSKIiAVCbVD7MSO7azt3XvvzOHh7q6dKk281yu7iL80D7t3Z+7/P3POmTNzVliAcOiQcPiw79r1xT5ril/x6ncDW0T1DkBYWajCjIh5CxhMtfpC9eSZi4t4KIs+SOOL4sP93xLMd8TaDaoK3mdDrQZEwAgiBu/cVUGOVH43+P06VwFUaMz8iRO21LfuVxKGT2iagPMOEESElZ/9BhRVBRRjrIQhmiSnCjbaOzEwUAEQ9u2zHDvmSg/1vygdHfu0Wk0QCVaR9HtBUU2lUAi1Fp+pzFX7Wb9eBaC0s/8b0ll4Tqu1GJFotZneEqqxdHREvlr73uzg8CEp7dy5TkXfEmvW4P1qmstSoYgoqjVj9ePGG7ffhMFanGs4xvsdgvcqQdDpnRwwouZxzRzlf4F8BhGj3quijwTAZrwXpHX+1ph6kFoaVLOg4pcflgXvEeSeQISeepxvSYGIMD07C2m61A5gDGEY0hFFGGNwzrVO/V2jBrl6iRAnCY9tu49NfX2o6i1XQhXm4xpjk5P8c3SE86OjJHFMuVSqP8+/IrkEGBFqtRoH9+zlgU99uqW+1Tjm9X/8nedPHOfXp08RhSHW2twicgkAQISZ2VlS53DeYY0FyOz7JmQUxRhDRxSxbctWtm3ZyiOfv4+vPvsM3jlMThH5BZA5cWAtIjQF3A7eewCc9+zdvp3UpXz56cOUisWVF9BA4721OObrR37I+NQUYRA0HwTWsvHOO3niS/fzuY9tRlUJg4DEOZ68fwe/HB5i+OxfKBeLuLrAFRXQQOo9w6+e5fLYGIThjabkHUePvcjPv/1dnnpwJ877LJ1U5ckdOxh8+c8theQGTPvoZ3G4p1iks1Sit1SiZ1Fbc8cagiDg8Au/YK5Wbe4hIsLWTfcQdXS2PPttFwCZbd+sJUlCIYqYmJ5m9MpVYCF8dheLdEQRvr4qraDtAm77QmMoROEN3yVpQuocIkKrbtx2AdZagpu0KAypVCp8dONG7lq7rplOqCoXx8eZr85jTet02urEqsrkzDRzU1PMLXZiAbxyd98HOXrgINaYZjgVEU699iqaulxO3FYBYRBw4LE9TFauExhL/ZhNYCwf3rCBx7+wnfW9vVlSRxZex6eu8ZvTp+nMEULbJqAxcVEYcuip/bf8bVpP4AKbbXzfPHqEsckJusvlXMldW1cAIElTbnq4ECGs+wPAxMwMB398lN/+8Qw95e7cmWnbBYTBew9ZjWPevnSJk6+8zE+PD/D26Ag95XL9AiQf2ppKVOOY/c8+w+Vr14iC4IbcppYkXJmaZuTKOJXr14k6O+npzj/zDbR1Bbz3/OmNN/jP2BgShjcIEBECaymEIb29vdkGt/wDTftNqNzVxVSxSOFdAhSgfpxM20C8gbYL8IvSh+WctJaKFU8l2o3/bwHKwlVJo600luUDobWISDP2R2G44rdjUtr1YMvTJmR5/7133U1vqdS8VvHe89eLF4iTJFdilge5VkDJDvR/+/cFUreQgIlAZ1TA5Mjr8yK3CSkZWTECi25SvPqlkZd6iWWZSpflA4qS1OoDhbpkMiKQpoKqEIZ+WSJyC2iQWLu+yu49F+nsSrPywu1MXxf6nnxpI6PvFJclYhkClFo1YPMnrvHJz15leqqAtUs7kDhn6OmNuXypiwvny0SRQzWf0weqWhFjSrRYI1AVCh2ON8+t4UObKnR1JUu6pdf6CvzrfJnXXllHWMhPHkCKu/rPirWfIXWKSEsbW8MUvBeCwGdFzyWYEKI4l70qp/koxqDOv2METoiYZp24pVEUgkCJIo8IiMnKV7dsRhHJiOe2fVUvxgjooHHe/Myn6Qwmv4g8JPL2IyvyiTqXgP+JmR8aGhH1P5AoMqgmuYZcSaimUogM6p+bHTz9ZlboBkqz08MSFR7QWi1GJOT9WPRTTSSKQk2Sc73F7m0jEDfrwh949NFSzcUvSRTu0DgB713dqVdbiKLqEbESRWiavK4SPzx7/A9jgDHU7X5iYOB6pavc72vJ04jMSBjaul+sLoyROpd5TZMfVQi2N8gDfjHBphOXdvd/BLVfE/QhhXtRtazC320Aj5gLKvxeU31+bmjoXP2ZATzAfwFJaR4mdvYsfAAAAABJRU5ErkJggg=="/>
    <text x="64" y="22" font-family="JetBrains Mono, monospace" font-size="12" letter-spacing="0.16em" fill="#0a0e1a" opacity="0.6">HOPE WORKSHOP</text>
    <text x="64" y="42" font-family="JetBrains Mono, monospace" font-size="10" letter-spacing="0.14em" fill="#0a0e1a" opacity="0.4">A 3-HOUR PROFESSIONAL PROGRAM · 2026</text>
  </g>

  <g transform="translate(1504,108)" text-anchor="end">
    <text x="0" y="22" font-family="JetBrains Mono, monospace" font-size="12" letter-spacing="0.16em" fill="#0a0e1a" opacity="0.6">ISSUED BY</text>
    <text x="0" y="44" font-family="Fraunces, serif" font-weight="600" font-size="20" fill="#0a0e1a">${escapeXml(issuer)}</text>
  </g>

  <!-- Certificate label -->
  <g transform="translate(800,310)" text-anchor="middle">
    <text font-family="JetBrains Mono, monospace" font-size="14" letter-spacing="0.34em" fill="#0a0e1a" opacity="0.75">CERTIFICATE OF COMPLETION</text>
    <line x1="-60" y1="14" x2="-30" y2="14" stroke="#0a0e1a" stroke-width="1" opacity="0.3"/>
    <line x1="30" y1="14" x2="60" y2="14" stroke="#0a0e1a" stroke-width="1" opacity="0.3"/>
  </g>

  <!-- "awarded to" -->
  <text x="800" y="430" font-family="Fraunces, serif" font-style="italic" font-size="22" font-weight="300" fill="#0a0e1a" opacity="0.6" text-anchor="middle">presented to</text>

  <!-- Name (the star) -->
  <text x="800" y="555" font-family="Fraunces, serif" font-weight="500" font-size="${nameSize}" letter-spacing="-0.01em" fill="#0a0e1a" text-anchor="middle">${escapeXml(name)}</text>

  <!-- Underline -->
  <line x1="450" y1="588" x2="1150" y2="588" stroke="#0a0e1a" stroke-width="0.8" opacity="0.25"/>
  <circle cx="800" cy="588" r="3.5" fill="#d4a85a"/>

  <!-- "for completing" -->
  <text x="800" y="638" font-family="Fraunces, serif" font-size="20" font-weight="300" fill="#0a0e1a" opacity="0.65" text-anchor="middle">for successfully completing the</text>

  <!-- Workshop title -->
  <text x="800" y="708" font-family="Fraunces, serif" font-weight="500" font-size="44" fill="#0a0e1a" text-anchor="middle"><tspan>Hope</tspan><tspan dx="0.35em" font-style="italic" font-weight="400" opacity="0.55">as a</tspan><tspan dx="0.35em">Skill</tspan></text>
  <text x="800" y="744" font-family="JetBrains Mono, monospace" font-size="12" letter-spacing="0.22em" fill="#0a0e1a" opacity="0.55" text-anchor="middle">A 3-HOUR INTERACTIVE WORKSHOP</text>

  <!-- Framework chips -->
  <g transform="translate(800,800)" text-anchor="middle">
    <g transform="translate(-260,0)">
      <rect x="-115" y="-22" width="230" height="44" rx="22" fill="#7b8cf5" opacity="0.1"/>
      <rect x="-115" y="-22" width="230" height="44" rx="22" fill="none" stroke="#7b8cf5" stroke-width="1" opacity="0.6"/>
      <circle cx="-90" cy="0" r="4" fill="#7b8cf5"/>
      <text x="-78" y="5" text-anchor="start" font-family="JetBrains Mono, monospace" font-size="11" letter-spacing="0.08em" fill="#0a0e1a">Snyder's Hope Theory</text>
    </g>
    <g transform="translate(0,0)">
      <rect x="-115" y="-22" width="230" height="44" rx="22" fill="#a3d977" opacity="0.12"/>
      <rect x="-115" y="-22" width="230" height="44" rx="22" fill="none" stroke="#a3d977" stroke-width="1" opacity="0.7"/>
      <circle cx="-90" cy="0" r="4" fill="#a3d977"/>
      <text x="-78" y="5" text-anchor="start" font-family="JetBrains Mono, monospace" font-size="11" letter-spacing="0.08em" fill="#0a0e1a">HOPE Action Model</text>
    </g>
    <g transform="translate(260,0)">
      <rect x="-115" y="-22" width="230" height="44" rx="22" fill="#f5b97b" opacity="0.14"/>
      <rect x="-115" y="-22" width="230" height="44" rx="22" fill="none" stroke="#f5b97b" stroke-width="1" opacity="0.7"/>
      <circle cx="-90" cy="0" r="4" fill="#f5b97b"/>
      <text x="-78" y="5" text-anchor="start" font-family="JetBrains Mono, monospace" font-size="11" letter-spacing="0.08em" fill="#0a0e1a">HDPS Framework</text>
    </g>
  </g>

  <!-- Your Hope Journey — 5-rank progression ladder -->
  ${journeyPanelSVG}

  <!-- Bottom meta row -->
  <g transform="translate(0,920)">
    <line x1="120" y1="0" x2="1480" y2="0" stroke="#0a0e1a" stroke-width="0.6" opacity="0.18"/>
  </g>

  <g transform="translate(140,946)">
    <text font-family="JetBrains Mono, monospace" font-size="10" letter-spacing="0.16em" fill="#0a0e1a" opacity="0.5">DATE OF COMPLETION</text>
    <text y="26" font-family="Fraunces, serif" font-size="20" font-weight="500" fill="#0a0e1a">${escapeXml(dateLong)}</text>
  </g>
  <g transform="translate(560,946)">
    <text font-family="JetBrains Mono, monospace" font-size="10" letter-spacing="0.16em" fill="#0a0e1a" opacity="0.5">CERTIFICATE ID</text>
    <text y="26" font-family="JetBrains Mono, monospace" font-size="18" font-weight="500" fill="#0a0e1a">${escapeXml(certId)}</text>
  </g>
  <g transform="translate(940,946)">
    <text font-family="JetBrains Mono, monospace" font-size="10" letter-spacing="0.16em" fill="#0a0e1a" opacity="0.5">HOPE KPI INDEX</text>
    <text y="26" font-family="Fraunces, serif" font-size="20" font-weight="500" fill="#0a0e1a">${escapeXml(String(hki))}<tspan font-size="13" opacity="0.5"> / 10</tspan></text>
  </g>

  <!-- Circular seal (bottom right) - positioned to fit within inner frame -->
  <g transform="translate(1380,970)">
    <circle r="86" fill="url(#sealRim)" opacity="0.95"/>
    <circle r="80" fill="url(#seal)"/>
    <circle r="80" fill="none" stroke="#f5b97b" stroke-width="1" opacity="0.4"/>
    <circle r="64" fill="none" stroke="#f5b97b" stroke-width="0.5" opacity="0.3" stroke-dasharray="2,3"/>
    <defs><clipPath id="sealLogoClip"><circle r="28" cx="0" cy="0"/></clipPath></defs><image x="-28" y="-28" width="56" height="56" preserveAspectRatio="xMidYMid slice" clip-path="url(#sealLogoClip)" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAGfElEQVR4nOWaXWxcRxXHf2fm3ru2d9d2Q5KatChR6QOQhC+BhEgJNJXcNE0/lCithIQaXkAQ8g68RKFSoQ8oAYlKqBIfFfDQCKlyQmyTiCAk1JK2itSKIiAVCbVD7MSO7azt3XvvzOHh7q6dKk281yu7iL80D7t3Z+7/P3POmTNzVliAcOiQcPiw79r1xT5ril/x6ncDW0T1DkBYWajCjIh5CxhMtfpC9eSZi4t4KIs+SOOL4sP93xLMd8TaDaoK3mdDrQZEwAgiBu/cVUGOVH43+P06VwFUaMz8iRO21LfuVxKGT2iagPMOEESElZ/9BhRVBRRjrIQhmiSnCjbaOzEwUAEQ9u2zHDvmSg/1vygdHfu0Wk0QCVaR9HtBUU2lUAi1Fp+pzFX7Wb9eBaC0s/8b0ll4Tqu1GJFotZneEqqxdHREvlr73uzg8CEp7dy5TkXfEmvW4P1qmstSoYgoqjVj9ePGG7ffhMFanGs4xvsdgvcqQdDpnRwwouZxzRzlf4F8BhGj3quijwTAZrwXpHX+1ph6kFoaVLOg4pcflgXvEeSeQISeepxvSYGIMD07C2m61A5gDGEY0hFFGGNwzrVO/V2jBrl6iRAnCY9tu49NfX2o6i1XQhXm4xpjk5P8c3SE86OjJHFMuVSqP8+/IrkEGBFqtRoH9+zlgU99uqW+1Tjm9X/8nedPHOfXp08RhSHW2twicgkAQISZ2VlS53DeYY0FyOz7JmQUxRhDRxSxbctWtm3ZyiOfv4+vPvsM3jlMThH5BZA5cWAtIjQF3A7eewCc9+zdvp3UpXz56cOUisWVF9BA4721OObrR37I+NQUYRA0HwTWsvHOO3niS/fzuY9tRlUJg4DEOZ68fwe/HB5i+OxfKBeLuLrAFRXQQOo9w6+e5fLYGIThjabkHUePvcjPv/1dnnpwJ877LJ1U5ckdOxh8+c8theQGTPvoZ3G4p1iks1Sit1SiZ1Fbc8cagiDg8Au/YK5Wbe4hIsLWTfcQdXS2PPttFwCZbd+sJUlCIYqYmJ5m9MpVYCF8dheLdEQRvr4qraDtAm77QmMoROEN3yVpQuocIkKrbtx2AdZagpu0KAypVCp8dONG7lq7rplOqCoXx8eZr85jTet02urEqsrkzDRzU1PMLXZiAbxyd98HOXrgINaYZjgVEU699iqaulxO3FYBYRBw4LE9TFauExhL/ZhNYCwf3rCBx7+wnfW9vVlSRxZex6eu8ZvTp+nMEULbJqAxcVEYcuip/bf8bVpP4AKbbXzfPHqEsckJusvlXMldW1cAIElTbnq4ECGs+wPAxMwMB398lN/+8Qw95e7cmWnbBYTBew9ZjWPevnSJk6+8zE+PD/D26Ag95XL9AiQf2ppKVOOY/c8+w+Vr14iC4IbcppYkXJmaZuTKOJXr14k6O+npzj/zDbR1Bbz3/OmNN/jP2BgShjcIEBECaymEIb29vdkGt/wDTftNqNzVxVSxSOFdAhSgfpxM20C8gbYL8IvSh+WctJaKFU8l2o3/bwHKwlVJo600luUDobWISDP2R2G44rdjUtr1YMvTJmR5/7133U1vqdS8VvHe89eLF4iTJFdilge5VkDJDvR/+/cFUreQgIlAZ1TA5Mjr8yK3CSkZWTECi25SvPqlkZd6iWWZSpflA4qS1OoDhbpkMiKQpoKqEIZ+WSJyC2iQWLu+yu49F+nsSrPywu1MXxf6nnxpI6PvFJclYhkClFo1YPMnrvHJz15leqqAtUs7kDhn6OmNuXypiwvny0SRQzWf0weqWhFjSrRYI1AVCh2ON8+t4UObKnR1JUu6pdf6CvzrfJnXXllHWMhPHkCKu/rPirWfIXWKSEsbW8MUvBeCwGdFzyWYEKI4l70qp/koxqDOv2METoiYZp24pVEUgkCJIo8IiMnKV7dsRhHJiOe2fVUvxgjooHHe/Myn6Qwmv4g8JPL2IyvyiTqXgP+JmR8aGhH1P5AoMqgmuYZcSaimUogM6p+bHTz9ZlboBkqz08MSFR7QWi1GJOT9WPRTTSSKQk2Sc73F7m0jEDfrwh949NFSzcUvSRTu0DgB713dqVdbiKLqEbESRWiavK4SPzx7/A9jgDHU7X5iYOB6pavc72vJ04jMSBjaul+sLoyROpd5TZMfVQi2N8gDfjHBphOXdvd/BLVfE/QhhXtRtazC320Aj5gLKvxeU31+bmjoXP2ZATzAfwFJaR4mdvYsfAAAAABJRU5ErkJggg=="/><circle r="28" fill="none" stroke="#f5b97b" stroke-width="0.7" opacity="0.45"/>
    <text font-family="JetBrains Mono, monospace" font-size="7.5" letter-spacing="0.22em" fill="#f5b97b" text-anchor="middle" y="40">VERIFIED · 2026</text>
    <!-- Wrapping text around top of seal -->
    <defs>
      <path id="sealArcTop" d="M -56 -34 A 66 66 0 0 1 56 -34"/>
    </defs>
    <text font-family="JetBrains Mono, monospace" font-size="8.5" letter-spacing="0.28em" fill="#f5b97b" opacity="0.9">
      <textPath href="#sealArcTop" startOffset="50%" text-anchor="middle">HOPE · WORKSHOP</textPath>
    </text>
  </g>

  <!-- Issuer footer - sits within inner frame (frame inner bottom is y=1075) -->
  <g transform="translate(140,1008)">
    <text font-family="JetBrains Mono, monospace" font-size="10" letter-spacing="0.16em" fill="#0a0e1a" opacity="0.5">ISSUED BY</text>
    <text y="22" font-family="Fraunces, serif" font-weight="600" font-size="17" fill="#0a0e1a">${escapeXml(issuer)} <tspan font-family="JetBrains Mono, monospace" font-size="10" fill="#0a0e1a" opacity="0.5" dx="8">${escapeXml(issuerUrl)}</tspan></text>
  </g>
  ${issuerTagline ? `<text x="140" y="1056" font-family="JetBrains Mono, monospace" font-size="10" letter-spacing="0.1em" fill="#0a0e1a" opacity="0.4">${escapeXml(issuerTagline)}</text>` : ""}
</svg>`;
  }

  function renderCertificate(opts) {
    if (!certPreview) return;
    const svg = buildCertificateSVG(opts);
    certPreview.innerHTML = svg;
    certPreview.classList.remove("empty");
    currentCert = { svg, ...opts };
    if (downloadCertBtn) downloadCertBtn.disabled = false;
    if (printCertBtn) printCertBtn.disabled = false;
    if (certIntro) certIntro.textContent = `Awarded to ${opts.name}. Tap "Download Certificate" to save a high-resolution copy you can print or share.`;
  }

  // Show empty state on first load
  if (certPreview) certPreview.classList.add("empty");

  function getParticipantName() {
    const el = document.getElementById("participant_name");
    return (el && el.value && el.value.trim()) || "";
  }

  // ===========================================================================
  // LEARNING SUMMARY PDF — a personal take-home document
  //   Key concepts + the participant's own action plan + their Hope scores.
  //   Built client-side with jsPDF (loaded from CDN). One-click download.
  // ===========================================================================
  function generateLearningSummaryPDF() {
    const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDFCtor) {
      toast("PDF tool still loading — please try again in a moment.", "error");
      return;
    }
    const d = getAllResponses();
    const name = getParticipantName() || "Workshop Participant";
    const dateStr = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    const certId = window.__certIdForSubmission || "";

    // Hope scores
    const dims = [
      ["Goal Clarity", d.rate_goal],
      ["Pathway Thinking", d.rate_path],
      ["Agency", d.rate_agency],
      ["Motivation Stability", d.rate_motivation],
      ["Future Belief", d.rate_future],
    ];
    const nums = dims.map((x) => parseInt(x[1] || "0", 10)).filter((n) => n > 0);
    const hki = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : "—";

    const doc = new jsPDFCtor({ unit: "pt", format: "a4" });
    const PW = 595, PH = 842, M = 50, CW = PW - M * 2;
    const navy = [10, 14, 26], blue = [123, 140, 245], teal = [60, 150, 135],
          ink = [40, 46, 60], soft = [110, 118, 135], green = [90, 150, 60];
    let y = 0;

    // jsPDF standard fonts only support Latin-1. Convert/strip Unicode so
    // characters like → — '' "" • never corrupt the text rendering.
    function ascii(s) {
      return String(s == null ? "" : s)
        .replace(/→/g, " -> ")
        .replace(/[—–]/g, " - ")
        .replace(/['']/g, "'")
        .replace(/[""]/g, '"')
        .replace(/…/g, "...")
        .replace(/•/g, "-")
        .replace(/[^\x00-\xFF]/g, ""); // drop any remaining non-Latin1 (e.g. Bengali)
    }
    function ensure(space) {
      if (y + space > PH - 60) { doc.addPage(); y = 60; }
    }
    function h1(text) {
      ensure(40);
      doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...navy);
      doc.text(ascii(text), M, y); y += 8;
      doc.setDrawColor(...blue); doc.setLineWidth(2);
      doc.line(M, y, M + 40, y); y += 18;
    }
    function para(text, opts) {
      opts = opts || {};
      const size = opts.size || 10.5;
      doc.setFont("helvetica", opts.bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(...(opts.color || ink));
      const lines = doc.splitTextToSize(ascii(text), opts.width || CW);
      lines.forEach((ln) => {
        ensure(size + 4);
        doc.text(ln, opts.x || M, y);
        y += size + 4;
      });
    }
    function concept(title, body) {
      ensure(46);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...blue);
      doc.text(ascii("- " + title), M, y); y += 14;
      para(body, { x: M + 14, width: CW - 14, color: ink });
      y += 6;
    }
    function field(label, value) {
      ensure(40);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...soft);
      doc.text(ascii(label.toUpperCase()), M, y); y += 13;
      doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...ink);
      const cleaned = ascii(value).trim();
      const val = cleaned || "-";
      const lines = doc.splitTextToSize(val, CW);
      lines.forEach((ln) => { ensure(15); doc.text(ln, M, y); y += 15; });
      y += 10;
    }

    // ---- COVER ----
    doc.setFillColor(...navy); doc.rect(0, 0, PW, 230, "F");
    // aurora accent band
    doc.setFillColor(...blue); doc.rect(0, 230, PW, 4, "F");
    doc.setFont("courier", "normal"); doc.setFontSize(10); doc.setTextColor(180, 190, 220);
    doc.text("PROFESSIONALSTALK  ·  LEARNING SUMMARY", M, 70);
    doc.setFont("helvetica", "bold"); doc.setFontSize(30); doc.setTextColor(255, 255, 255);
    doc.text("Hope as a Skill", M, 120);
    doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.setTextColor(190, 200, 225);
    doc.text("Your personal take-home learning summary", M, 148);
    doc.setFontSize(11); doc.setTextColor(220, 225, 240);
    doc.text("Prepared for:  " + name, M, 185);
    doc.text("Date:  " + dateStr, M, 205);
    if (certId) { doc.setFont("courier", "normal"); doc.setFontSize(9); doc.setTextColor(150, 160, 190); doc.text("Ref: " + certId, M, 222); }
    y = 270;

    para("This summary captures the core ideas from your workshop and the personal plan you created. Keep it somewhere you'll see it — hope grows through small, repeated action.", { color: soft, size: 10.5 });
    y += 12;

    // ---- KEY CONCEPTS ----
    h1("1.  Key Concepts You Learned");
    concept("Optimism vs Hope", "Optimism is a passive feeling that things will work out. Hope is an active skill you can build — combining clear goals, multiple pathways, and the belief that you can act.");
    concept("Snyder's Hope Theory (G + P + A)", "Hope = Goals (where you want to go) + Pathways (how you'll get there) + Agency (the belief you can do it). If any one is missing, hope collapses.");
    concept("Four Daily Hope-Building Habits", "1) Notice small positive moments. 2) Shift self-talk from 'I can't' to 'I'm learning how.' 3) Act first — motivation follows action. 4) Reconnect to meaning: why your work matters.");
    concept("Reframing", "Turn negative thoughts into hopeful action statements. The words you use shape the actions you take.");
    concept("The HOPE Action Model", "Four steps: Highlight your goal, Observe the barriers in your way, Plan two or more pathways around them, then Execute one small step within 48 hours.");
    concept("Organizational Impact of Hope", "When workplace hope is low, it quietly raises mental and physical health strain, lowers wellbeing, and increases productivity, burnout, retention, safety, and cost risks. Hope is a performance fuel, not a soft extra.");
    concept("Measuring Hope (HDPS & the Hope-Performance Matrix)", "Hope can be measured as a Hope KPI Index and combined with performance to reveal hidden talent and rising risk across a team.");

    // ---- YOUR ACTION PLAN ----
    h1("2.  Your Personal Hope Action Plan");
    field("Your meaningful goal", d.plan_goal || d.map_goal);
    field("The barrier in your way", d.plan_barrier);
    field("Pathway A (first route)", d.plan_sol_a || d.map_path_a);
    field("Pathway B (backup route)", d.plan_sol_b || d.map_path_b);
    field("One action within 48 hours", d.plan_action || d.map_action);

    // ---- YOUR SCORES ----
    h1("3.  Your Hope KPI Index (HKI)");
    para("Your self-rated scores at the end of the workshop (1 = low, 10 = high):", { color: soft });
    y += 4;
    dims.forEach(([label, val]) => {
      ensure(22);
      const v = parseInt(val || "0", 10);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...ink);
      doc.text(label, M, y);
      // bar
      const barX = M + 220, barW = 200, pct = Math.max(0, Math.min(10, v)) / 10;
      doc.setFillColor(230, 232, 240); doc.roundedRect(barX, y - 9, barW, 10, 3, 3, "F");
      doc.setFillColor(...blue); doc.roundedRect(barX, y - 9, Math.max(4, barW * pct), 10, 3, 3, "F");
      doc.setFont("helvetica", "bold"); doc.setTextColor(...navy);
      doc.text(v ? String(v) : "-", barX + barW + 12, y);
      y += 20;
    });
    y += 6;
    ensure(40);
    doc.setFillColor(245, 247, 252); doc.roundedRect(M, y - 4, CW, 36, 6, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...navy);
    doc.text("Overall Hope KPI Index:  " + hki + " / 10", M + 16, y + 19);
    y += 50;

    // ---- FOOTER on every page ----
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(225, 228, 236); doc.setLineWidth(0.7);
      doc.line(M, PH - 42, PW - M, PH - 42);
      doc.setFont("courier", "normal"); doc.setFontSize(8); doc.setTextColor(...soft);
      doc.text("Issued by ProfessionalsTalk - professionalstalk.me", M, PH - 28);
      doc.text("Page " + p + " of " + pages, PW - M, PH - 28, { align: "right" });
    }

    const safe = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "participant";
    doc.save("Hope-Workshop-Learning-Summary-" + safe + ".pdf");
    toast("Learning Summary downloaded", "success");
  }

  const downloadSummaryBtn = document.getElementById("downloadSummaryBtn");
  if (downloadSummaryBtn) {
    downloadSummaryBtn.addEventListener("click", () => {
      try { generateLearningSummaryPDF(); }
      catch (err) { console.error(err); toast("Could not generate PDF: " + err.message, "error"); }
    });
  }

  // Hook: when submission succeeds, render certificate and advance
  // We instrument by listening for the submit status text change as a fallback,
  // but the cleaner path is to expose a function the submit flow can call.
  window.__hopeRenderCertificate = function (overrides) {
    const name = (overrides && overrides.name) || getParticipantName() || "Workshop Participant";
    const hkiEl = document.getElementById("hkiValue");
    const hki = hkiEl ? hkiEl.textContent : "—";
    // Prefer the cert_id assigned at submission time so the certificate
    // matches the row in Google Sheets (essential for verification).
    const certId = (overrides && overrides.certId) || window.__certIdForSubmission || buildCertId(name);
    renderCertificate({
      name,
      date: new Date(),
      certId,
      hki,
    });
    // Advance to the certificate slide
    showSlide(total - 1, { focus: true });
  };

  // Allow manual preview before submission by entering a name on slide 17
  // and clicking "Print" — but we keep buttons disabled until a name exists.
  function updateCertReadiness() {
    const name = getParticipantName();
    if (name && certPreview && certPreview.classList.contains("empty")) {
      // Live preview when name exists (helps participants confirm the certificate
      // before they hit Submit)
      const hkiEl = document.getElementById("hkiValue");
      renderCertificate({
        name,
        date: new Date(),
        certId: buildCertId(name),
        hki: hkiEl ? hkiEl.textContent : "—",
      });
    }
  }
  const partNameEl = document.getElementById("participant_name");
  if (partNameEl) {
    partNameEl.addEventListener("blur", updateCertReadiness);
  }
  // Also re-render on slide change to certificate
  document.addEventListener("hope:slideChange", () => {
    if (slides[current] && slides[current].classList.contains("slide-certificate")) {
      updateCertReadiness();
    }
  });

  // ---------------------------------------------------------------------------
  // CERTIFICATE DOWNLOAD (SVG -> Canvas -> PNG)
  // ---------------------------------------------------------------------------
  async function downloadCertificatePNG() {
    if (!currentCert || !currentCert.svg) {
      toast("Generate a certificate first by submitting your plan.", "error");
      return;
    }
    try {
      downloadCertBtn.classList.add("loading");
      downloadCertBtn.disabled = true;

      // Render at 2x for crisp print quality (1600*2 x 1131*2)
      const SCALE = 2;
      const W = 1600 * SCALE;
      const H = 1131 * SCALE;

      const svgBlob = new Blob([currentCert.svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Could not load SVG into an image."));
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      // Paint a paper background so transparent areas read as cream
      ctx.fillStyle = "#faf6ee";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (!blob) {
          toast("Could not encode the certificate as PNG.", "error");
          downloadCertBtn.classList.remove("loading");
          downloadCertBtn.disabled = false;
          return;
        }
        const safeName = (currentCert.name || "participant")
          .replace(/[^a-z0-9 ._-]/gi, "")
          .replace(/\s+/g, "_")
          .slice(0, 40);
        const fileName = `Hope_Workshop_Certificate_${safeName}.png`;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 250);
        downloadCertBtn.classList.remove("loading");
        downloadCertBtn.disabled = false;
        toast("Certificate downloaded", "success");
      }, "image/png", 0.95);
    } catch (err) {
      console.error(err);
      downloadCertBtn.classList.remove("loading");
      downloadCertBtn.disabled = false;
      toast("Download failed: " + err.message, "error");
    }
  }

  if (downloadCertBtn) downloadCertBtn.addEventListener("click", downloadCertificatePNG);
  if (printCertBtn) {
    printCertBtn.addEventListener("click", () => {
      // Use the browser print dialog — our @media print stylesheet isolates
      // the certificate slide for clean PDF output.
      if (!currentCert) {
        toast("Generate a certificate first.", "error");
        return;
      }
      window.print();
    });
  }

  // ---------------------------------------------------------------------------
  // URL PARAM RECEIVER — re-render certificate from an email link
  //   Example: ?cert=HW-20260520-K2X7P&name=Abdulla+Al+Babul&hki=8.5
  //   Used by the auto-email so participants can revisit their certificate
  //   on any device without re-completing the workshop.
  // ---------------------------------------------------------------------------
  function maybeRestoreCertificateFromURL() {
    try {
      const params = new URLSearchParams(window.location.search);
      const certId = (params.get("cert") || "").trim();
      const name = (params.get("name") || "").trim();
      const hki = (params.get("hki") || "").trim();
      if (!certId || !name) return false;

      // Bypass the password gate — this is a verified deep link
      try { localStorage.setItem(PASSWORD_KEY, "ok"); } catch (e) {}
      if (passwordGate) passwordGate.style.display = "none";

      // Pre-populate the name so the rest of the UI is consistent
      const nameEl = document.getElementById("participant_name");
      if (nameEl) nameEl.value = name;

      // Render and jump to the certificate slide
      window.__certIdForSubmission = certId;
      renderCertificate({
        name,
        date: new Date(),
        certId,
        hki: hki || "—",
      });
      setTimeout(() => showSlide(total - 1, { focus: true }), 150);
      return true;
    } catch (err) {
      console.warn("Could not restore certificate from URL:", err);
      return false;
    }
  }
  // Run after the password gate logic has had a chance to initialize
  setTimeout(maybeRestoreCertificateFromURL, 50);

  // ---------------------------------------------------------------------------
  // HOOK INTO SUBMISSION SUCCESS
  // ---------------------------------------------------------------------------
  // Wrap setStatus so that whenever a successful submission renders, we also
  // generate the certificate and move to the certificate slide.
  const originalSetStatus = setStatus;
  setStatus = function (msg, kind) {
    originalSetStatus(msg, kind);
    if (kind === "success" && /submitted|saved locally|json/i.test(msg)) {
      // Slight delay so the user sees the success message first
      setTimeout(() => {
        if (window.__hopeRenderCertificate) window.__hopeRenderCertificate();
      }, 900);
    }
  };

  // ---------------------------------------------------------------------------
  // PREMIUM PRESENTATION LAYER (additive — cursor spotlight, help overlay,
  // extra keyboard shortcuts). None of this touches navigation/submit logic.
  // ---------------------------------------------------------------------------

  // 1. Cursor-aware ambient spotlight on the stage
  const stageEl = document.getElementById("stage");
  const _mm = (typeof window.matchMedia === "function")
    ? window.matchMedia.bind(window)
    : function () { return { matches: false }; };
  const prefersReducedMotion = _mm("(prefers-reduced-motion: reduce)").matches;
  const finePointer = _mm("(hover: hover)").matches;
  if (stageEl && finePointer && !prefersReducedMotion) {
    let rafPending = false;
    let lastX = 0, lastY = 0;
    document.addEventListener("mousemove", (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          stageEl.style.setProperty("--mx", lastX + "px");
          stageEl.style.setProperty("--my", lastY + "px");
          if (!stageEl.classList.contains("spotlight-on")) {
            stageEl.classList.add("spotlight-on");
          }
          rafPending = false;
        });
      }
    });
    document.addEventListener("mouseleave", () => stageEl.classList.remove("spotlight-on"));
  }

  // 2. Keyboard shortcuts help overlay
  const scOverlay = document.getElementById("shortcutsOverlay");
  const scHint = document.getElementById("shortcutsHint");
  const scClose = document.getElementById("shortcutsClose");

  function openShortcuts() { if (scOverlay) scOverlay.classList.add("open"); }
  function closeShortcuts() { if (scOverlay) scOverlay.classList.remove("open"); }
  function toggleShortcuts() {
    if (!scOverlay) return;
    scOverlay.classList.toggle("open");
  }
  if (scHint) scHint.addEventListener("click", openShortcuts);
  if (scClose) scClose.addEventListener("click", closeShortcuts);
  if (scOverlay) {
    scOverlay.addEventListener("click", (e) => {
      if (e.target === scOverlay) closeShortcuts();
    });
  }

  // 3. Extra keyboard shortcuts (?, T for theme, L for language)
  //    Guard against typing inside inputs/textareas.
  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    const typing = tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable);

    // "?" — toggle shortcuts (Shift+/ on most layouts)
    if ((e.key === "?" ) && !typing) {
      e.preventDefault();
      toggleShortcuts();
      return;
    }
    // Esc — close overlay if open
    if (e.key === "Escape" && scOverlay && scOverlay.classList.contains("open")) {
      closeShortcuts();
      return;
    }
    if (typing) return;
    // T — toggle theme
    if (e.key === "t" || e.key === "T") {
      const themeBtn = document.getElementById("themeToggle");
      if (themeBtn) themeBtn.click();
    }
    // L — toggle language
    if (e.key === "l" || e.key === "L") {
      const cur = getLang();
      setLang(cur === "bn" ? "en" : "bn");
    }
  });

  // Friendly console banner
  console.log(
    "%c HOPE Workshop ",
    "background: #7b8cf5; color: white; font-weight: bold; padding: 4px 8px; border-radius: 4px;",
    "v" + (window.HOPE_CONFIG?.VERSION || "1.0.0")
  );

  // ═══════════════════════════════════════════════════════════════════════
  //  CHARACTER COUNTERS — live "12 / 280" with min/max validation states
  //  Attached to every [data-min][data-max] input/textarea on the eight
  //  fill-in slides (3, 8, 11, 17, 27, 28, 29, 34). Color states tell the
  //  participant whether their answer is too short, healthy, or near max.
  // ═══════════════════════════════════════════════════════════════════════
  (function installCharCounters() {
    const fields = document.querySelectorAll('[data-min][data-max]');
    fields.forEach(el => {
      const min = parseInt(el.getAttribute("data-min") || "7", 10);
      const max = parseInt(el.getAttribute("data-max") || "280", 10);
      const xp  = parseInt(el.getAttribute("data-xp")  || "10", 10);

      // Create counter element AFTER the field. If field is inside .q-card,
      // place the counter in (or alongside) the existing .q-meta row when present.
      const counter = document.createElement("span");
      counter.className = "char-counter";
      counter.setAttribute("data-for", el.id);
      counter.innerHTML = '<span class="cc-num">0</span><span class="cc-slash"> / </span><span class="cc-max">' + max + '</span><span class="cc-xp" title="XP awarded when valid"> · ✦ +' + xp + ' XP</span>';

      // Prefer placing inside an existing q-meta or save-state row
      const qMeta = (el.parentElement || document).querySelector(".q-meta, .share-row");
      if (qMeta) {
        qMeta.appendChild(counter);
      } else {
        el.insertAdjacentElement("afterend", counter);
      }

      function update() {
        const len = (el.value || "").trim().length;
        const numEl = counter.querySelector(".cc-num");
        if (numEl) numEl.textContent = String(len);
        counter.classList.remove("cc-too-short", "cc-ok", "cc-near-max", "cc-empty");
        if (len === 0) counter.classList.add("cc-empty");
        else if (len < min) counter.classList.add("cc-too-short");
        else if (len > max - 20) counter.classList.add("cc-near-max");
        else counter.classList.add("cc-ok");
      }
      el.addEventListener("input", update);
      el.addEventListener("blur",  update);
      update(); // initial state
    });
  })();

  // ═══════════════════════════════════════════════════════════════════════
  //  HopeXP GAMIFICATION LAYER
  //  Live positive-reinforcement system that fires while participants work.
  //  XP triggers are wired into existing element interactions (no need to
  //  modify every handler). Badges unlock at milestones with a sliding card +
  //  optional confetti burst. State persists across reloads via localStorage.
  // ═══════════════════════════════════════════════════════════════════════
  const HXP = (function () {
    const KEY = "hope_xp_v1";
    const ranks = [
      { min: 0,   key: "xp.rank.0", label: "Novice" },
      { min: 25,  key: "xp.rank.1", label: "Explorer" },
      { min: 70,  key: "xp.rank.2", label: "Builder" },
      { min: 140, key: "xp.rank.3", label: "Strategist" },
      { min: 220, key: "xp.rank.4", label: "Architect of Hope" }
    ];
    const BADGES = {
      storyteller:    { color: ["#f57b8c", "#f5b97b"], icon: "✺", xp: 15, nameKey: "xp.badge.storyteller.n",    descKey: "xp.badge.storyteller.d" },
      explorer:       { color: ["#7b8cf5", "#6dd5c5"], icon: "✦", xp: 15, nameKey: "xp.badge.explorer.n",       descKey: "xp.badge.explorer.d" },
      hopeMapper:     { color: ["#6dd5c5", "#a3d977"], icon: "◈", xp: 25, nameKey: "xp.badge.mapper.n",         descKey: "xp.badge.mapper.d" },
      reframer:       { color: ["#c79bf5", "#7b8cf5"], icon: "↻", xp: 20, nameKey: "xp.badge.reframer.n",       descKey: "xp.badge.reframer.d" },
      strategist:     { color: ["#f5b97b", "#f57b8c"], icon: "◆", xp: 30, nameKey: "xp.badge.strategist.n",     descKey: "xp.badge.strategist.d" },
      actionHero:     { color: ["#a3d977", "#6dd5c5"], icon: "★", xp: 35, nameKey: "xp.badge.hero.n",           descKey: "xp.badge.hero.d" },
      architect:      { color: ["#f5b97b", "#c79bf5"], icon: "◉", xp: 50, nameKey: "xp.badge.architect.n",      descKey: "xp.badge.architect.d" }
    };

    // ── Persisted state ──
    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return { xp: 0, badges: [], firedTriggers: [] };
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
    const state = load();

    // ── DOM ──
    const chip = document.getElementById("hopexpChip");
    const numEl = document.getElementById("hopexpNum");
    const rankEl = document.getElementById("hopexpRank");
    const stack = document.getElementById("badgePopupStack");
    const confettiStage = document.getElementById("confettiStage");

    function currentRank() {
      let r = ranks[0];
      for (const t of ranks) if (state.xp >= t.min) r = t;
      return r;
    }
    function render() {
      if (!chip) return;
      chip.hidden = false;
      if (numEl) numEl.textContent = String(state.xp);
      if (rankEl) {
        const r = currentRank();
        rankEl.setAttribute("data-i18n", r.key);
        rankEl.textContent = r.label;            // fallback; applyI18n overrides
      }
      if (typeof window.__applyI18n === "function") window.__applyI18n();
    }
    function flashChip() {
      if (!chip) return;
      chip.classList.add("boost");
      setTimeout(() => chip.classList.remove("boost"), 700);
    }

    // ── Award XP ──
    function award(amount, sourceEl, triggerKey) {
      // De-dupe: each trigger key only fires once per session
      if (triggerKey) {
        if (state.firedTriggers.includes(triggerKey)) return;
        state.firedTriggers.push(triggerKey);
      }
      const beforeRank = currentRank();
      state.xp += amount;
      const afterRank = currentRank();
      save();
      render();
      flashChip();
      showFloater(amount, sourceEl);
      if (afterRank !== beforeRank) {
        // Rank up — small celebration
        burstConfetti(18);
      }
    }

    function showFloater(amount, sourceEl) {
      const el = document.createElement("div");
      el.className = "xp-floater";
      el.textContent = "+" + amount + " XP";
      // Anchor to source if available, else to the chip
      const anchor = (sourceEl && sourceEl.getBoundingClientRect) ? sourceEl : chip;
      if (anchor) {
        const r = anchor.getBoundingClientRect();
        el.style.left = (r.left + r.width / 2 - 24) + "px";
        el.style.top  = (r.top - 6) + "px";
      } else {
        el.style.right = "20px"; el.style.top = "70px";
      }
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1500);
    }

    // ── Unlock a badge ──
    function unlock(id, sourceEl) {
      if (state.badges.includes(id)) return;
      const b = BADGES[id];
      if (!b) return;
      state.badges.push(id);
      save();
      award(b.xp, sourceEl, "badge_xp_" + id);
      showBadge(id);
      burstConfetti(36);
    }

    function showBadge(id) {
      if (!stack) return;
      const b = BADGES[id];
      const card = document.createElement("div");
      card.className = "badge-card";
      card.style.setProperty("--badge-c1", b.color[0]);
      card.style.setProperty("--badge-c2", b.color[1]);
      card.innerHTML =
        '<div class="badge-card-head">' +
          '<div class="badge-icon">' + b.icon + '</div>' +
          '<div class="badge-label" data-i18n="xp.badge.unlocked">Achievement Unlocked</div>' +
          '<div class="badge-xp-pill">+' + b.xp + ' XP</div>' +
        '</div>' +
        '<h4 class="badge-name" data-i18n="' + b.nameKey + '">' + id + '</h4>' +
        '<p class="badge-desc" data-i18n="' + b.descKey + '"></p>';
      stack.appendChild(card);
      if (typeof window.__applyI18n === "function") window.__applyI18n();
      setTimeout(() => {
        card.classList.add("leaving");
        setTimeout(() => card.remove(), 420);
      }, 4800);
    }

    // ── Confetti burst (CSS-only, palette colors) ──
    function burstConfetti(count) {
      if (!confettiStage) return;
      const palette = ["#7b8cf5", "#6dd5c5", "#f5b97b", "#f57b8c", "#a3d977", "#c79bf5"];
      confettiStage.classList.remove("active");
      // force reflow so animation restarts
      void confettiStage.offsetWidth;
      confettiStage.classList.add("active");
      for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        p.className = "confetti-piece";
        const ang1 = Math.random() * Math.PI * 2;
        const dist1 = 80 + Math.random() * 120;
        const cx1 = Math.cos(ang1) * dist1;
        const cy1 = Math.sin(ang1) * dist1 - 40;
        const cx2 = cx1 + (Math.random() - 0.5) * 200;
        const cy2 = cy1 + 200 + Math.random() * 200;
        p.style.setProperty("--cx1", cx1 + "px");
        p.style.setProperty("--cy1", cy1 + "px");
        p.style.setProperty("--cx2", cx2 + "px");
        p.style.setProperty("--cy2", cy2 + "px");
        p.style.background = palette[i % palette.length];
        p.style.animationDelay = (Math.random() * 0.15) + "s";
        confettiStage.appendChild(p);
      }
      setTimeout(() => { confettiStage.innerHTML = ""; }, 2400);
    }

    // ── Wire XP triggers to existing elements ──
    function wireTriggers() {
      // 1) Fill-in fields (textarea + text inputs): award XP on blur ONLY when
      //    content length is in valid range (data-min ≤ len ≤ data-max). Each
      //    field reads its own data-xp value so XP is properly distributed.
      document.querySelectorAll('textarea[data-key], input[data-key][data-min]').forEach(el => {
        el.addEventListener("blur", () => {
          const len = (el.value || "").trim().length;
          const min = parseInt(el.getAttribute("data-min") || "7", 10);
          const max = parseInt(el.getAttribute("data-max") || "280", 10);
          const xp  = parseInt(el.getAttribute("data-xp")  || "10", 10);
          if (len >= min && len <= max) {
            award(xp, el, "field_" + el.id);
          }
        });
      });

      // 2) Selectable cards (struggles + risk chain): +5 per pick
      document.querySelectorAll('.struggle-card').forEach(c => {
        c.addEventListener("click", () => {
          if (c.classList.contains("selected")) {
            award(5, c, "struggle_" + c.getAttribute("data-value"));
          }
        });
      });
      document.querySelectorAll('#riskChain .risk-step').forEach(s => {
        s.addEventListener("click", () => {
          if (s.classList.contains("selected")) {
            award(5, s, "risk_" + s.getAttribute("data-value"));
          }
        });
      });

      // 3) Share button on slide 3 → Storyteller badge
      const shareBtn2 = document.getElementById("shareLoseHopeBtn");
      if (shareBtn2) {
        shareBtn2.addEventListener("click", () => {
          const ta = document.getElementById("lose_hope_answer");
          if (ta && (ta.value || "").trim().length >= 4) {
            unlock("storyteller", shareBtn2);
          }
        });
      }

      // 4) Struggle multi-select → Explorer badge after 3+ picks
      const struggleGrid2 = document.getElementById("struggleGrid");
      if (struggleGrid2) {
        struggleGrid2.addEventListener("click", () => {
          const picked = struggleGrid2.querySelectorAll(".struggle-card.selected").length;
          if (picked >= 3) unlock("explorer", struggleGrid2);
        });
      }

      // 5) Hope Map (map_*) — all 5 fields filled → Hope Mapper
      const mapFields = ["map_goal", "map_path_a", "map_path_b", "map_action"];
      function checkMapper() {
        const allFilled = mapFields.every(id => {
          const el = document.getElementById(id);
          return el && (el.value || "").trim().length >= 3;
        });
        if (allFilled) unlock("hopeMapper", document.getElementById("map_goal"));
      }
      mapFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("blur", checkMapper);
      });

      // 6) Reframing — completing 3 negative→positive pairs → Reframer
      const reframeFields = ["reframe_neg_1","reframe_neg_2","reframe_neg_3","reframe_pos_1","reframe_pos_2","reframe_pos_3"];
      function checkReframer() {
        const allFilled = reframeFields.every(id => {
          const el = document.getElementById(id);
          return el && (el.value || "").trim().length >= 3;
        });
        if (allFilled) unlock("reframer", document.getElementById("reframe_pos_1"));
      }
      reframeFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("blur", checkReframer);
      });

      // 7) Simulation textarea filled → Strategist
      const sim = document.getElementById("simulation_plan");
      if (sim) {
        sim.addEventListener("blur", () => {
          if ((sim.value || "").trim().length >= 20) unlock("strategist", sim);
        });
      }

      // 8) Personal Hope Action Plan complete → Action Hero
      const planFields = ["plan_goal", "plan_barrier", "plan_sol_a", "plan_action"];
      function checkActionHero() {
        const allFilled = planFields.every(id => {
          const el = document.getElementById(id);
          return el && (el.value || "").trim().length >= 3;
        });
        if (allFilled) unlock("actionHero", document.getElementById("plan_action"));
      }
      planFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("blur", checkActionHero);
      });

      // 9) Final submission → Architect of Hope
      const submitBtn = document.getElementById("submitBtn");
      if (submitBtn) {
        submitBtn.addEventListener("click", () => {
          // Defer so submission validation runs first
          setTimeout(() => {
            const status = document.getElementById("submitStatus");
            if (status && (status.classList.contains("success") || /submitted/i.test(status.textContent))) {
              unlock("architect", submitBtn);
            }
          }, 600);
        });
      }
    }

    // Initial render + wire triggers on load
    render();
    if (document.readyState !== "loading") wireTriggers();
    else document.addEventListener("DOMContentLoaded", wireTriggers);

    return { award, unlock, render };
  })();

})();
