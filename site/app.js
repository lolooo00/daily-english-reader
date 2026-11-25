// Daily Reader front end: reader page, archive page, read/skip memory, image export UI.

const $ = (sel) => document.querySelector(sel);
const VERSION = new URL(import.meta.url).search;

/* ---------- read / skip memory (this browser only) ---------- */

const STORE_KEY = "daily-reader:v2:status";

const store = (() => {
  let cache = null;
  const load = () => {
    if (cache) return cache;
    try {
      cache = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
      cache = {};
    }
    return cache;
  };
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(cache));
    } catch {
      /* private mode or storage blocked: keep it in memory for this visit */
    }
  };
  return {
    reload: () => (cache = null),
    get: (id) => load()[id]?.s || null,
    set(id, status) {
      load();
      if (status) cache[id] = { s: status, t: Date.now() };
      else delete cache[id];
      save();
    },
  };
})();

function todayIn(timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shortDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/* ---------- reader ---------- */

function initReader() {
  const data = JSON.parse($("#issue-data").textContent);
  const articles = data.articles;
  if (articles.length === 0) {
    $("#empty").hidden = false;
    return;
  }

  const el = {
    tabs: $("#tabs"),
    progress: $("#progress"),
    banner: $("#banner"),
    article: $("#article"),
    category: $("#category"),
    source: $("#source"),
    author: $("#author"),
    title: $("#title"),
    stats: $("#stats"),
    body: $("#body"),
    end: $("#end"),
    actions: $("#actions"),
    read: $("#read-btn"),
    skip: $("#skip-btn"),
    next: $("#next-btn"),
    original: $("#original-link"),
    exportBtn: $("#export-btn"),
  };
  el.article.hidden = false;
  el.actions.hidden = false;

  const statusOf = (a) => store.get(a.id);
  const pending = () => articles.filter((a) => !statusOf(a));
  let index = 0;
  let shownAt = 0;

  // Tab labels: add a number when a category appears twice (fallback days).
  const seenCats = {};
  const tabLabels = articles.map((a) => {
    seenCats[a.category] = (seenCats[a.category] || 0) + 1;
    return seenCats[a.category] > 1 ? `${a.categoryShort} ${seenCats[a.category]}` : a.categoryShort;
  });

  function renderBanner() {
    el.banner.innerHTML = "";
    const banner = document.createElement("p");
    if (data.isLatest) {
      const today = todayIn(data.timeZone);
      if (data.date < today) {
        banner.className = "banner";
        banner.textContent = `No new issue since ${shortDate(data.date)}. The daily job may have failed. `;
        if (data.actionsUrl) {
          const link = document.createElement("a");
          link.href = data.actionsUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Check GitHub Actions ↗";
          banner.append(link);
        }
        el.banner.append(banner);
        return;
      }
    } else {
      banner.className = "banner banner-info";
      banner.append(`From the archive · `);
      const link = document.createElement("a");
      link.href = "../index.html";
      link.textContent = "Go to today's issue →";
      banner.append(link);
      el.banner.append(banner);
      return;
    }
    if (pending().length === 0) {
      banner.className = "banner banner-info";
      banner.textContent = "All caught up for today.";
      el.banner.append(banner);
    }
  }

  function renderTabs() {
    el.tabs.innerHTML = "";
    articles.forEach((a, i) => {
      const status = statusOf(a);
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `tab${status === "read" ? " is-read" : ""}${status === "skipped" ? " is-skipped" : ""}`;
      tab.setAttribute("aria-current", String(i === index));
      tab.title = a.title;
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = tabLabels[i];
      tab.append(label);
      if (status === "read") {
        const mark = document.createElement("span");
        mark.className = "tab-state";
        mark.textContent = "✓";
        mark.setAttribute("aria-label", "read");
        tab.append(mark);
      } else if (status === "skipped") {
        tab.setAttribute("aria-label", `${tabLabels[i]} (skipped)`);
      }
      tab.addEventListener("click", () => show(i));
      el.tabs.append(tab);
    });
    const done = articles.filter((a) => statusOf(a) === "read").length;
    el.progress.textContent = `${done} of ${articles.length} read`;
  }

  function renderButtons() {
    const status = statusOf(articles[index]);
    el.read.textContent = status === "read" ? "✓ Read" : "Mark as read";
    el.read.setAttribute("aria-pressed", String(status === "read"));
    el.skip.textContent = status === "skipped" ? "Skipped · undo" : "Skip";
    el.skip.setAttribute("aria-pressed", String(status === "skipped"));
    el.skip.disabled = status === "read";
    el.next.disabled = articles.length < 2;
  }

  function refresh() {
    renderTabs();
    renderButtons();
    renderBanner();
  }

  function show(i, { scroll = true } = {}) {
    index = (i + articles.length) % articles.length;
    const a = articles[index];
    el.category.textContent = a.categoryLabel;
    el.source.textContent = a.source;
    el.author.innerHTML = "";
    if (a.author) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "·";
      el.author.append(sep, a.author);
    }
    el.title.textContent = a.title;
    el.stats.textContent = `${a.wordCount.toLocaleString("en-US")} words · ${a.minutes} min read`;
    el.body.innerHTML = a.content; // sanitized at build time (whitelisted tags, http(s) links only)
    el.original.href = a.url;
    document.title = `${a.title} · ${data.siteTitle}`;
    history.replaceState(null, "", `#${a.id}`);
    shownAt = Date.now();
    refresh();
    if (scroll) window.scrollTo({ top: 0 });
  }

  function nextIndex() {
    for (let step = 1; step < articles.length; step++) {
      const j = (index + step) % articles.length;
      if (!statusOf(articles[j])) return j;
    }
    return index + 1;
  }

  el.read.addEventListener("click", () => {
    const a = articles[index];
    store.set(a.id, statusOf(a) === "read" ? null : "read");
    refresh();
  });

  el.skip.addEventListener("click", () => {
    const a = articles[index];
    if (statusOf(a) === "skipped") {
      store.set(a.id, null);
      refresh();
      return;
    }
    store.set(a.id, "skipped");
    if (pending().length > 0) show(nextIndex());
    else refresh();
  });

  el.next.addEventListener("click", () => show(nextIndex()));

  // Reaching the end of an article after at least 8 seconds on it counts as read.
  new IntersectionObserver((entries) => {
    const a = articles[index];
    if (entries.some((e) => e.isIntersecting) && !statusOf(a) && Date.now() - shownAt > 8_000) {
      store.set(a.id, "read");
      refresh();
    }
  }).observe(el.end);

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest("input, textarea, dialog")) return;
    if (e.key === "ArrowRight") show(index + 1);
    if (e.key === "ArrowLeft") show(index - 1);
  });

  el.exportBtn.addEventListener("click", () => openExport(articles[index], data));

  const fromHash = articles.findIndex((a) => `#${a.id}` === location.hash);
  const firstPending = articles.findIndex((a) => !statusOf(a));
  show(fromHash >= 0 ? fromHash : Math.max(0, firstPending), { scroll: false });
}

/* ---------- image export ---------- */

let exportModule = null;

async function openExport(article, data) {
  const dialog = $("#export-dialog");
  const status = $("#export-status");
  const pagesEl = $("#export-pages");
  const save = $("#export-save");
  const options = { theme: "light", size: "m" };
  let files = [];
  let urls = [];
  let job = 0;

  const clear = () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    files = [];
    pagesEl.innerHTML = "";
  };

  const touch = matchMedia("(pointer: coarse)").matches;

  async function render() {
    const mine = ++job;
    save.disabled = true;
    status.textContent = "Rendering pages…";
    clear();
    try {
      exportModule ||= await import(`./export.js${VERSION}`);
      const blobs = await exportModule.renderArticleImages(article, {
        ...options,
        dateLabel: shortDate(data.date) + `, ${data.date.slice(0, 4)}`,
        siteTitle: data.siteTitle,
      });
      if (mine !== job) return;
      const stem = `daily-reader-${data.date}-${article.category}`;
      files = blobs.map((b, i) => new File([b], `${stem}-${String(i + 1).padStart(2, "0")}.png`, { type: "image/png" }));
      for (const file of files) {
        const url = URL.createObjectURL(file);
        urls.push(url);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        const img = document.createElement("img");
        img.src = url;
        img.alt = `Page ${urls.length} of ${files.length}`;
        img.loading = "lazy";
        link.append(img);
        pagesEl.append(link);
      }
      status.textContent = `${files.length} pages · 1080 × 1920 · ${touch ? "long-press a page to save it" : "click a page to download it"}`;
      save.textContent = `Save all ${files.length}`;
      save.disabled = false;
    } catch (err) {
      console.error(err);
      if (mine === job) status.textContent = "Could not render images in this browser.";
    }
  }

  function bindSegmented(group, key) {
    group.onclick = (e) => {
      const btn = e.target.closest("button[data-value]");
      if (!btn || options[key] === btn.dataset.value) return;
      options[key] = btn.dataset.value;
      group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
      render();
    };
    group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === options[key])));
  }

  bindSegmented($("#export-theme"), "theme");
  bindSegmented($("#export-size"), "size");

  save.onclick = async () => {
    if (!files.length) return;
    if (touch && navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files, title: article.title });
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
      }
    }
    for (const file of files) {
      const a = document.createElement("a");
      a.href = urls[files.indexOf(file)];
      a.download = file.name;
      document.body.append(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  $("#export-close").onclick = () => dialog.close();
  dialog.onclose = () => {
    job++;
    clear();
  };
  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.close();
  };

  dialog.showModal();
  render();
}

/* ---------- archive ---------- */

async function initArchive() {
  const config = JSON.parse($("#archive-config").textContent);
  const params = new URLSearchParams(location.search);
  const filter = {
    q: params.get("q") || "",
    c: params.get("c") || "",
    unread: params.get("unread") === "1",
  };
  const q = $("#q");
  const unread = $("#unread");
  const chips = $("#chips");
  const list = $("#list");
  const count = $("#count");
  q.value = filter.q;
  unread.checked = filter.unread;

  const labels = Object.fromEntries(config.categories.map((c) => [c.id, c.label]));
  for (const cat of [{ id: "", label: "All" }, ...config.categories]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.value = cat.id;
    chip.textContent = cat.label;
    chips.append(chip);
  }

  let entries = [];
  try {
    const res = await fetch(`archive.json${VERSION}`);
    entries = await res.json();
  } catch {
    count.textContent = "Could not load the archive.";
    return;
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (filter.q) p.set("q", filter.q);
    if (filter.c) p.set("c", filter.c);
    if (filter.unread) p.set("unread", "1");
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  function render() {
    chips.querySelectorAll(".chip").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.value === filter.c)));
    const terms = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = entries.filter((e) => {
      if (filter.c && e.category !== filter.c) return false;
      if (filter.unread && store.get(e.id)) return false;
      const hay = `${e.title} ${e.source}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });

    count.textContent =
      shown.length === entries.length ? `${entries.length} articles` : `${shown.length} of ${entries.length} articles`;
    list.innerHTML = "";
    if (shown.length === 0) {
      const empty = document.createElement("p");
      empty.className = "archive-empty";
      empty.textContent = entries.length ? "Nothing matches these filters." : "No articles yet.";
      list.append(empty);
      return;
    }

    let group = null;
    let month = "";
    for (const e of shown) {
      const m = e.date.slice(0, 7);
      if (m !== month) {
        month = m;
        group = document.createElement("section");
        group.className = "month-group";
        const label = document.createElement("h2");
        label.className = "month-label";
        label.textContent = new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", timeZone: "UTC" });
        group.append(label);
        list.append(group);
      }
      const status = store.get(e.id);
      const a = document.createElement("a");
      a.className = `entry${status ? ` is-${status}` : ""}`;
      a.href = `issues/${e.date}.html#${e.id}`;
      const day = document.createElement("span");
      day.className = "entry-day";
      day.textContent = String(Number(e.date.slice(8, 10)));
      const main = document.createElement("span");
      const title = document.createElement("span");
      title.className = "entry-title";
      title.textContent = e.title;
      const meta = document.createElement("span");
      meta.className = "entry-meta";
      meta.textContent = `${labels[e.category] || e.category} · ${e.source} · ${e.minutes} min`;
      main.append(title, meta);
      const state = document.createElement("span");
      state.className = "entry-state";
      state.textContent = status === "read" ? "✓ Read" : status === "skipped" ? "Skipped" : "";
      a.append(day, main, state);
      group.append(a);
    }
  }

  let timer;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filter.q = q.value.trim();
      syncUrl();
      render();
    }, 120);
  });
  chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filter.c = chip.dataset.value;
    syncUrl();
    render();
  });
  unread.addEventListener("change", () => {
    filter.unread = unread.checked;
    syncUrl();
    render();
  });
  // Coming back from an article (bfcache) should show fresh read marks.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    store.reload();
    render();
  });
  render();
}

if (document.body.dataset.page === "reader") initReader();
if (document.body.dataset.page === "archive") initArchive();
