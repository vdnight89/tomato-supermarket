// 番茄超市 - shared desktop shell.
//
// Injected into every page. It owns the parts of the product that are the same
// everywhere - navigation, theme, keyboard control, the local shelf - so each
// page only has to render its own content.
//
// Design notes that matter when editing this file:
//
//   * The pages were written for a phone WebView and keep their own local
//     storage helpers. This module deliberately uses `localStorage` directly
//     with its own guard, so it can run before (or entirely without) the page
//     scripts and cannot be broken by their initialisation order.
//   * Storage must never take the UI down. Every read and write is guarded, and
//     a failure degrades to an in-memory map for the lifetime of the page.
//   * The loopback origin carries the session cookie, so plain relative URLs
//     and same-origin `fetch` calls are all that is needed. No token is ever
//     read from JavaScript.

(function () {
    "use strict";

    const THEME_KEY = "novelapi_theme_v4"; // shared with the original pages
    const SHELF_KEY = "fqpc_shelf_v1";
    const PREFS_KEY = "fqpc_prefs_v1";
    const VERSION = "1.0.0";

    const PAGES = {
        "/index.html": { key: "home", chrome: "app", title: "发现" },
        "/": { key: "home", chrome: "app", title: "发现" },
        "/search.html": { key: "search", chrome: "app", title: "搜索" },
        "/library.html": { key: "library", chrome: "app", title: "书架" },
        "/settings.html": { key: "settings", chrome: "app", title: "设置" },
        "/detail.html": { key: "detail", chrome: "app", title: "详情" },
        "/read.html": { key: "read", chrome: "immersive", title: "阅读" },
        "/listen.html": { key: "listen", chrome: "immersive", title: "听书" },
        "/video.html": { key: "video", chrome: "immersive", title: "短剧" },
        "/comic.html": { key: "comic", chrome: "immersive", title: "漫画" },
    };

    const NAV = [
        { href: "/index.html", icon: "fa-compass", label: "发现", page: "home" },
        { href: "/search.html", icon: "fa-magnifying-glass", label: "搜索", page: "search" },
        { href: "/library.html", icon: "fa-book-bookmark", label: "书架", page: "library" },
        { href: "/settings.html", icon: "fa-gear", label: "设置", page: "settings" },
    ];

    const TAB_NAMES = {
        "小说": "read",
        "漫画": "comic",
        "听书": "listen",
        "短剧": "video",
        "漫剧": "video",
    };

    // ------------------------------------------------------------ storage --

    const memory = new Map();

    function readRaw(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (_) {
            return memory.has(key) ? memory.get(key) : null;
        }
    }

    function writeRaw(key, value) {
        try {
            window.localStorage.setItem(key, value);
            memory.delete(key);
        } catch (_) {
            memory.set(key, value);
        }
    }

    function readJSON(key, fallback) {
        const raw = readRaw(key);
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        writeRaw(key, JSON.stringify(value));
    }

    const shelf = {
        data: readJSON(SHELF_KEY, { history: {}, favorites: {} }),

        all() {
            if (!this.data.history || typeof this.data.history !== "object") this.data.history = {};
            if (!this.data.favorites || typeof this.data.favorites !== "object") this.data.favorites = {};
            return this.data;
        },

        key(entry) {
            return `${entry.source || ""}:${entry.tab || ""}:${entry.id || ""}`;
        },

        historyList() {
            return Object.values(this.all().history).sort((a, b) => (b.at || 0) - (a.at || 0));
        },

        favoritesList() {
            return Object.values(this.all().favorites).sort((a, b) => (b.at || 0) - (a.at || 0));
        },

        isFavorite(entry) {
            return Boolean(this.all().favorites[this.key(entry)]);
        },

        /** Records a visit. Existing metadata is kept: the URL knows the id but
         *  not the title, and losing a known title on every revisit would empty
         *  the shelf of everything but ids. */
        touch(entry) {
            if (!entry || !entry.id) return;
            const store = this.all();
            const key = this.key(entry);
            const prev = store.history[key] || {};
            store.history[key] = Object.assign({}, prev, {
                key,
                source: entry.source || prev.source || "番茄",
                id: entry.id,
                tab: entry.tab || prev.tab || "小说",
                title: entry.title || prev.title || "",
                author: entry.author || prev.author || "",
                cover: entry.cover || prev.cover || "",
                chapter: entry.chapter !== undefined ? entry.chapter : prev.chapter,
                chapterTitle: entry.chapterTitle || prev.chapterTitle || "",
                at: Date.now(),
            });
            writeJSON(SHELF_KEY, store);
        },

        /** Adds metadata discovered after the visit was recorded. */
        enrich(entry) {
            if (!entry || !entry.id) return;
            const store = this.all();
            const key = this.key(entry);
            const prev = store.history[key];
            if (!prev) return;
            if (entry.title) prev.title = entry.title;
            if (entry.author) prev.author = entry.author;
            if (entry.cover) prev.cover = entry.cover;
            writeJSON(SHELF_KEY, store);
        },

        toggleFavorite(entry) {
            const store = this.all();
            const key = this.key(entry);
            if (store.favorites[key]) {
                delete store.favorites[key];
                writeJSON(SHELF_KEY, store);
                return false;
            }
            store.favorites[key] = Object.assign({}, entry, { key, at: Date.now() });
            writeJSON(SHELF_KEY, store);
            return true;
        },

        removeFromHistory(entry) {
            const store = this.all();
            delete store.history[this.key(entry)];
            writeJSON(SHELF_KEY, store);
        },

        clear() {
            writeJSON(SHELF_KEY, { history: {}, favorites: {} });
        },
    };

    const prefs = {
        data: Object.assign(
            {
                fontScale: 1,
                lineHeight: 1.9,
                volume: 0.9,
                speed: 1,
                autoplayNext: true,
                theme: "light",
            },
            readJSON(PREFS_KEY, {})
        ),

        get(name) {
            return this.data[name];
        },

        set(name, value) {
            this.data[name] = value;
            writeJSON(PREFS_KEY, this.data);
            applyPrefs();
            document.dispatchEvent(new CustomEvent("fqpc:prefs", { detail: { name, value } }));
        },
    };

    // -------------------------------------------------------------- theme --

    function currentTheme() {
        return readRaw(THEME_KEY) === "dark" ? "dark" : "light";
    }

    function applyTheme(theme) {
        writeRaw(THEME_KEY, theme);
        prefs.set("theme", theme);
        document.body.classList.toggle("dark", theme === "dark");
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", theme === "dark" ? "#0f141b" : "#eef2f6");
    }

    function applyPrefs() {
        const scale = Number(prefs.get("fontScale")) || 1;
        document.documentElement.style.setProperty("--pc-font-scale", String(scale));
    }

    // -------------------------------------------------------------- routes --

    const route = {
        home() {
            return "/index.html";
        },
        search(query) {
            return query ? `/search.html?q=${encodeURIComponent(query)}` : "/search.html";
        },
        detail(source, id, tab) {
            return `/detail.html?source=${encodeURIComponent(source || "番茄")}&book_id=${encodeURIComponent(id)}&tab=${encodeURIComponent(tab || "小说")}`;
        },
        /** Maps a content tab onto the page that can actually play it. 漫剧 is
         *  a series vid and plays through the same chain as 短剧. */
        player(tab, source, bookId, itemId) {
            const target = TAB_NAMES[tab] || "read";
            return `/${target}.html?source=${encodeURIComponent(source || "番茄")}&book_id=${encodeURIComponent(bookId)}&item_id=${encodeURIComponent(itemId || "")}&tab=${encodeURIComponent(tab || "小说")}`;
        },
        /** Where the shelf sends the user back to. */
        resume(entry) {
            if (entry.chapter) return this.player(entry.tab, entry.source, entry.id, entry.chapter);
            return this.detail(entry.source, entry.id, entry.tab);
        },
    };

    // --------------------------------------------------------------- toast --

    let toastEl = null;
    let toastTimer = 0;

    function toast(message, ms) {
        if (!toastEl) {
            toastEl = document.createElement("div");
            toastEl.className = "pc-toast";
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = message;
        toastEl.classList.add("show");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), ms || 2200);
    }

    // -------------------------------------------------------------- chrome --

    function pageInfo() {
        const path = window.location.pathname;
        return PAGES[path] || { key: "other", chrome: "app", title: "番茄超市" };
    }

    function el(tag, className, html) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (html !== undefined) node.innerHTML = html;
        return node;
    }

    let themeButton = null;

    function paintThemeButton() {
        if (!themeButton) return;
        const dark = currentTheme() === "dark";
        themeButton.innerHTML = `<i class="fa-solid fa-${dark ? "sun" : "moon"}"></i>`;
    }

    function buildSidebar(info) {
        const nav = el("nav");
        NAV.forEach((item) => {
            const link = el("a", "pc-nav-item");
            link.href = item.href;
            link.innerHTML = `<i class="fa-solid ${item.icon}"></i><span class="pc-nav-label">${item.label}</span>`;
            if (item.page === info.key) link.classList.add("active");
            nav.appendChild(link);
        });

        const brand = el("div");
        brand.id = "pc-brand";
        brand.innerHTML = `<img src="/assets/favicon.png" alt=""><span id="pc-brand-text">番茄超市</span>`;

        const foot = el("div");
        foot.id = "pc-side-foot";
        foot.textContent = `v${VERSION}`;

        const aside = el("aside");
        aside.id = "pc-sidebar";
        aside.appendChild(brand);
        aside.appendChild(nav);
        aside.appendChild(el("div", "pc-nav-spacer"));
        aside.appendChild(foot);
        return aside;
    }

    function buildTopbar(info) {
        const back = el("button", "pc-icon-btn", '<i class="fa-solid fa-arrow-left"></i>');
        back.type = "button";
        back.title = "返回 (Alt+←)";
        back.addEventListener("click", () => {
            if (window.history.length > 1) window.history.back();
            else window.location.href = route.home();
        });

        const search = el("div");
        search.id = "pc-search";
        search.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>' +
            '<input type="search" placeholder="搜索书名、作者、短剧…" aria-label="搜索">' +
            "<kbd>Ctrl K</kbd>";
        const input = search.querySelector("input");
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            const query = input.value.trim();
            if (!query) return;
            // Already on the search page: drive its own input so the page's
            // own state (tabs, paging, cache) handles the run.
            if (info.key === "search") {
                const pageInput = document.getElementById("queryInput");
                const button = document.getElementById("searchBtn");
                if (pageInput && button) {
                    pageInput.value = query;
                    button.click();
                    return;
                }
            }
            window.location.href = route.search(query);
        });

        const themeBtn = el("button", "pc-icon-btn", '<i class="fa-solid fa-moon"></i>');
        themeBtn.type = "button";
        themeBtn.title = "切换主题 (Ctrl+D)";
        themeBtn.addEventListener("click", () => {
            applyTheme(currentTheme() === "dark" ? "light" : "dark");
            paintThemeButton();
        });
        themeButton = themeBtn;
        paintThemeButton();

        const title = el("div");
        title.id = "pc-title";
        title.textContent = info.title;

        const bar = el("header");
        bar.id = "pc-topbar";
        bar.appendChild(back);
        bar.appendChild(title);
        bar.appendChild(search);
        bar.appendChild(themeBtn);
        return bar;
    }

    function mount(info) {
        const immersive = info.chrome === "immersive";
        document.body.dataset.pcShell = "1";
        document.body.dataset.pcChrome = info.chrome;
        document.body.setAttribute("data-pc-chrome-bar", "shown");

        // The pages that ship their own bar keep it out of the way: the desktop
        // bar carries navigation, search and theme in a fixed place.
        const legacy = document.querySelector(".topbar");
        if (legacy && !immersive) legacy.style.display = "none";

        document.body.prepend(buildSidebar(info));

        // Immersive pages already own their own top bar, docked at the top of
        // the window. A second bar stacked on top of it (this one sat at
        // z-index 55 over their z-index 20) hid the very controls - reader
        // settings, chapter list, theme - that the bar exists to offer. So on
        // those pages the rail is the only chrome this module adds, and the
        // page's own bar is revealed through the `fqpc:chrome-reveal` event.
        if (!immersive) document.body.prepend(buildTopbar(info));

        if (immersive) wireImmersive();
    }

    /** Reading, listening and playback should own the window: the rail fades
     *  out while the pointer is still, and the page brings back its own bar
     *  when the pointer returns to the top edge. */
    function wireImmersive() {
        let timer = 0;
        const hide = () => {
            document.body.dataset.pcRail = "off";
        };
        const reveal = () => {
            document.body.dataset.pcRail = "on";
            window.clearTimeout(timer);
            timer = window.setTimeout(hide, 2600);
            document.dispatchEvent(new CustomEvent("fqpc:chrome-reveal"));
        };
        document.addEventListener("mousemove", (event) => {
            if (event.clientY < 90) reveal();
        });
        document.addEventListener("mouseleave", hide);
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") reveal();
        }, true);
        reveal();
    }

    /** Opens the page's own settings panel. The button is marked explicitly by
     *  each immersive page rather than guessed from the toolbar, because those
     *  toolbars carry unrelated buttons next to it. */
    function openPageSettings() {
        const button = document.querySelector("[data-pc-settings]");
        if (!button) return false;
        button.click();
        return true;
    }

    // ----------------------------------------------------------- shortcuts --

    function isTyping(target) {
        if (!target) return false;
        const tag = target.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    }

    function focusSearch() {
        const pageInput = document.getElementById("queryInput");
        if (pageInput) {
            pageInput.focus();
            pageInput.select();
            return;
        }
        window.location.href = route.search("");
    }

    function wireShortcuts() {
        document.addEventListener("keydown", (event) => {
            const ctrl = event.ctrlKey || event.metaKey;

            if (event.key === "F11") {
                event.preventDefault();
                const root = document.documentElement;
                if (document.fullscreenElement) document.exitFullscreen();
                else if (root.requestFullscreen) root.requestFullscreen();
                return;
            }
            if (event.altKey && event.key === "ArrowLeft") {
                event.preventDefault();
                window.history.back();
                return;
            }
            if (event.altKey && event.key === "ArrowRight") {
                event.preventDefault();
                window.history.forward();
                return;
            }
            if (event.key === "Escape" && isTyping(event.target)) {
                event.target.blur();
                return;
            }
            // Immersive pages hide their own bar; `S` reaches the controls that
            // live on it without hunting for them with the pointer.
            if (!ctrl && !event.altKey && !isTyping(event.target) &&
                (event.key === "s" || event.key === "S")) {
                if (openPageSettings()) event.preventDefault();
                return;
            }
            if (!ctrl) return;

            const key = event.key.toLowerCase();
            if (key === "k" || key === "f") {
                event.preventDefault();
                focusSearch();
            } else if (key === "l") {
                event.preventDefault();
                window.location.href = "/library.html";
            } else if (key === ",") {
                event.preventDefault();
                window.location.href = "/settings.html";
            } else if (key === "d" && !event.shiftKey) {
                event.preventDefault();
                applyTheme(currentTheme() === "dark" ? "light" : "dark");
                paintThemeButton();
            }
        });
    }

    /** Records the visit as soon as the page knows which work is open. */
    function autoTrack() {
        const params = new URLSearchParams(window.location.search);
        const id = params.get("book_id") || params.get("item_id");
        if (!id) return;
        shelf.touch({
            source: params.get("source") || "番茄",
            id: params.get("book_id") || id,
            tab: params.get("tab") || "小说",
            chapter: params.get("item_id") || undefined,
        });
    }

    // ---------------------------------------------------------------- boot --

    function boot() {
        const info = pageInfo();
        document.body.classList.toggle("dark", currentTheme() === "dark");
        applyPrefs();
        mount(info);
        wireShortcuts();
        autoTrack();

        // A `?q=` deep link (the top bar search, or Ctrl+K from a reader) runs
        // the search page's own handler once it has wired its input.
        const query = new URLSearchParams(window.location.search).get("q");
        if (query && info.key === "search") {
            const start = () => {
                const input = document.getElementById("queryInput");
                if (!input) return false;
                input.value = query;
                const button = document.getElementById("searchBtn");
                if (button) button.click();
                return true;
            };
            let tries = 0;
            const tick = window.setInterval(() => {
                if (start() || ++tries > 40) window.clearInterval(tick);
            }, 100);
        }
    }

    window.FQPC = Object.freeze({
        version: VERSION,
        shelf,
        prefs,
        route,
        toast,
        track: (entry) => shelf.touch(entry),
        enrich: (entry) => shelf.enrich(entry),
        theme: currentTheme,
        setTheme: applyTheme,
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
